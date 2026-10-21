import { EventEmitter } from 'node:events';
import { claimsInBlock, claimsInTx, type ClusterTx, parseTx, type TxClaim } from '@bitmap-battle/core';
import type { Bitmaps, Judged } from './bitmaps.ts';
import { log } from './log.ts';
import type { Rpc } from './rpc.ts';

export type PoolTx = {
  txid: string;
  claims: TxClaim[];
  fee: number;
  vsize: number;
  effFee: number;
  effVsize: number;
  seen: number;
};

export type BlockInfo = { height: number; hash: string; time: number; seenAt: number; claims: Judged[]; sizes: number[] };

type MempoolEntry = {
  vsize: number;
  time: number;
  ancestorsize: number;
  chunkweight?: number;
  fees: { base: number; modified: number; ancestor: number; chunk?: number };
};

const BATCH = 500;
const RECENT_BLOCKS = 12;
const BLOCK_WEIGHT = 3_996_000;
const MARK_HEX = '6f7264';

const sats = (btc: number) => Math.round(btc * 1e8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Watcher extends EventEmitter {
  tip = { height: -1, hash: '', time: 0, seenAt: 0 };
  syncing = true;
  mempoolLoaded = false;
  readonly pool = new Map<string, PoolTx>();
  readonly blocks: BlockInfo[] = [];
  rates = { nextBlock: 0, minRelay: 0, incremental: 0 };
  private readonly known = new Set<string>();
  private ratesAt = 0;
  private stopped = false;

  constructor(
    private readonly rpc: Rpc,
    private readonly bitmaps: Bitmaps,
    private readonly pollMs: number,
  ) {
    super();
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const started = Date.now();
      try {
        await this.step();
      } catch (e) {
        log(`watcher: ${(e as Error).message}`);
      }
      await sleep(Math.max(200, this.pollMs - (Date.now() - started)));
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async step(): Promise<void> {
    const moved = await this.followChain();
    await this.followMempool();
    await this.refreshFees();
    if (moved || Date.now() - this.ratesAt > 10_000) await this.refreshRates();
    this.emit('change');
  }

  private async hashAt(height: number): Promise<string | null> {
    try {
      return await this.rpc.call<string>('getblockhash', height);
    } catch {
      return null;
    }
  }

  private async readBlock(height: number) {
    const hash = await this.rpc.call<string>('getblockhash', height);
    const raw = await this.rpc.block(hash);
    const time = new DataView(raw.buffer, raw.byteOffset + 68, 4).getUint32(0, true);
    return { hash, time, ...claimsInBlock(raw, height) };
  }

  private remember(info: BlockInfo): void {
    this.blocks.push(info);
    if (this.blocks.length > RECENT_BLOCKS) this.blocks.shift();
  }

  private async followChain(): Promise<boolean> {
    const best = await this.rpc.call<string>('getbestblockhash');
    if (best === this.tip.hash) return false;
    const { height, time } = await this.rpc.call<{ height: number; time: number }>('getblockheader', best);
    const startup = this.tip.height < 0;
    this.bitmaps.start(Math.max(0, height - 5));

    let from = this.bitmaps.scannedTo + 1;
    while (from > 0 && this.bitmaps.hashes.has(from - 1) && (await this.hashAt(from - 1)) !== this.bitmaps.hashes.get(from - 1)) from--;
    if (from <= this.bitmaps.scannedTo) {
      log(`reorg: blocks from ${from} replaced`);
      this.bitmaps.undo(from);
      while (this.blocks.length && this.blocks[this.blocks.length - 1].height >= from) this.blocks.pop();
    }

    if (startup) {
      for (let h = Math.max(0, height - RECENT_BLOCKS + 1); h < Math.min(from, height + 1); h++) {
        const b = await this.readBlock(h);
        const claims = b.claims.map((c) => {
          const holder = this.bitmaps.claimed(c.n);
          return { ...c, valid: holder === undefined ? null : holder !== null && holder.inscription === c.inscription };
        });
        this.remember({ height: h, hash: b.hash, time: b.time, seenAt: b.time * 1000, claims, sizes: b.sizes });
      }
    }

    const catchingUp = height - from > 2;
    if (catchingUp) log(`scanning blocks ${from.toLocaleString()} to ${height.toLocaleString()} for bitmap claims`);
    for (let h = from; h <= height; h++) {
      const b = await this.readBlock(h);
      const judged = this.bitmaps.apply(h, b.hash, b.claims, !catchingUp || h === height);
      if (height - h < RECENT_BLOCKS) {
        const info: BlockInfo = { height: h, hash: b.hash, time: b.time, seenAt: startup || catchingUp ? b.time * 1000 : Date.now(), claims: judged, sizes: b.sizes };
        this.remember(info);
        if (!catchingUp) this.emit('block', info);
      }
      if (catchingUp && (h % 100 === 0 || h === height)) log(`  scanned ${h.toLocaleString()}`);
    }
    const last = this.blocks.at(-1);
    this.tip = { height, hash: best, time, seenAt: last?.height === height ? last.seenAt : time * 1000 };
    this.syncing = false;
    return true;
  }

  private async followMempool(): Promise<void> {
    const txids = await this.rpc.call<string[]>('getrawmempool');
    const now = new Set(txids);
    for (const t of this.known) {
      if (!now.has(t)) {
        this.known.delete(t);
        this.pool.delete(t);
      }
    }
    const fresh = txids.filter((t) => !this.known.has(t));
    if (!this.mempoolLoaded && fresh.length > BATCH) log(`reading ${fresh.length.toLocaleString()} mempool transactions`);
    for (let i = 0; i < fresh.length; i += BATCH) {
      const chunk = fresh.slice(i, i + BATCH);
      const raws = await this.rpc.batch<string>('getrawtransaction', chunk.map((t) => [t]));
      chunk.forEach((txid, k) => {
        const hex = raws[k];
        if (hex === null) return;
        this.known.add(txid);
        if (!hex.includes(MARK_HEX)) return;
        try {
          const tx = parseTx(Buffer.from(hex, 'hex'));
          const claims = claimsInTx(tx);
          if (claims.length) {
            this.pool.set(txid, { txid, claims, fee: 0, vsize: Math.ceil(tx.weight / 4), effFee: 0, effVsize: 0, seen: Date.now() });
          }
        } catch (e) {
          log(`could not read ${txid}: ${(e as Error).message}`);
        }
      });
    }
    if (!this.mempoolLoaded) {
      this.mempoolLoaded = true;
      log(`mempool: ${txids.length.toLocaleString()} transactions, ${this.pool.size} with bitmap claims`);
    }
  }

  private async refreshFees(): Promise<void> {
    const txids = [...this.pool.keys()];
    const entries = await this.rpc.batch<MempoolEntry>('getmempoolentry', txids.map((t) => [t]));
    txids.forEach((txid, i) => {
      const e = entries[i];
      const p = this.pool.get(txid)!;
      if (!e) {
        this.pool.delete(txid);
        this.known.delete(txid);
        return;
      }
      p.fee = sats(e.fees.base);
      p.vsize = e.vsize;
      p.seen = e.time * 1000;
      if (e.fees.chunk !== undefined && e.chunkweight) {
        p.effFee = sats(e.fees.chunk);
        p.effVsize = e.chunkweight / 4;
      } else {
        p.effFee = sats(e.fees.ancestor);
        p.effVsize = e.ancestorsize;
      }
    });
  }

  // The transaction's cluster in the node's mining order, empty when it is not in the mempool.
  async cluster(txid: string): Promise<ClusterTx[]> {
    let chunks: { txs: string[] }[];
    try {
      chunks = (await this.rpc.call<{ chunks: { txs: string[] }[] }>('getmempoolcluster', txid)).chunks;
    } catch {
      return [];
    }
    const order = chunks.flatMap((c) => c.txs);
    const entries = await this.rpc.batch<MempoolEntry>('getmempoolentry', order.map((t) => [t]));
    if (entries.some((e) => e === null)) return [];
    return order.map((t, i) => ({ txid: t, fee: sats(entries[i]!.fees.modified), vsize: entries[i]!.vsize }));
  }

  private async refreshRates(): Promise<void> {
    const info = await this.rpc.call<{ mempoolminfee: number; minrelaytxfee: number; incrementalrelayfee: number }>('getmempoolinfo');
    const minRelay = Math.max(info.mempoolminfee, info.minrelaytxfee) * 1e5;
    let nextBlock = minRelay;
    try {
      const diagram = await this.rpc.call<{ weight: number; fee: number }[]>('getmempoolfeeratediagram');
      for (let i = 1; i < diagram.length; i++) {
        if (diagram[i].weight >= BLOCK_WEIGHT) {
          const a = diagram[i - 1];
          const b = diagram[i];
          nextBlock = Math.max(minRelay, ((b.fee - a.fee) * 1e8) / ((b.weight - a.weight) / 4));
          break;
        }
      }
    } catch {
      const e = await this.rpc.call<{ feerate?: number }>('estimatesmartfee', 1).catch(() => ({}) as { feerate?: number });
      if (e.feerate) nextBlock = e.feerate * 1e5;
    }
    const round = (x: number) => Math.round(x * 1000) / 1000;
    this.rates = { nextBlock: round(nextBlock), minRelay: round(minRelay), incremental: round(info.incrementalrelayfee * 1e5) };
    this.ratesAt = Date.now();
  }
}

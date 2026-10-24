import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { checkGhostBundle, type GhostBundle, type GhostClaim, type GhostRefund, type Network, replacementFee } from '@bitmap-battle/core';
import type { Bitmaps } from './bitmaps.ts';
import { log } from './log.ts';
import type { PrivatePool } from './private.ts';
import type { Rpc } from './rpc.ts';
import { tagOf } from './seats.ts';
import type { Watcher } from './watcher.ts';

// Ghost runs: a player's claims, signed in their browser for every number of the run, sent here so the chase goes
// on with the page closed. Each block the claim for the next number goes to the private pool, where it replaces the
// last one because they spend the same deposit; the server picks among the signed fee rungs and nothing else. One
// run at a time, so the players of this server never bid against each other unseen.

type Sent = { n: number; rung: number; txid: string; fee: number; vsize: number; rate: number; at: number };

export type RunState = 'waiting' | 'chasing' | 'won' | 'lost' | 'refunded' | 'gone';

type Run = {
  id: string;
  player: string;
  bundle: GhostBundle;
  state: RunState;
  stopped: boolean;
  sent: Sent[];
  refund: { txid: string; fee: number; rate: number; at: number } | null;
  note: string;
  winner: string | null;
  block: number | null;
  created: number;
};

export type RunView = {
  id: string;
  state: RunState;
  stopped: boolean;
  first: number;
  count: number;
  start: number;
  extra: number;
  deposit: { txid: string; vout: number; amount: number };
  sent: Sent[];
  refund: Run['refund'];
  note: string;
  winner: string | null;
  block: number | null;
};

type Deps = { rpc: Rpc; watcher: Watcher; bitmaps: Bitmaps; pool: PrivatePool | null; network: Network };

const SEAT_LIFE = 15 * 60_000;
const KEEP = 50;
const OPEN: RunState[] = ['waiting', 'chasing'];

export class GhostRuns {
  private runs: Run[] = [];
  private seat: { player: string; since: number } | null = null;
  private busy = false;
  private again = false;
  // The newest tip heard of: the quick tip watch reports it before the watcher has read the block.
  private height = -1;

  constructor(
    private readonly file: string,
    private readonly d: Deps,
  ) {
    if (existsSync(file)) this.runs = JSON.parse(readFileSync(file, 'utf8')) as Run[];
  }

  get enabled(): boolean {
    return this.d.pool !== null;
  }

  get poolName(): string | null {
    return this.d.pool?.name ?? null;
  }

  floor(): Promise<number> {
    if (!this.d.pool) throw new Error('this server has no private pool');
    return this.d.pool.floor();
  }

  private save(): void {
    const text = JSON.stringify(this.runs.slice(-KEEP));
    try {
      writeFileSync(`${this.file}.tmp`, text);
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      writeFileSync(this.file, text);
    }
  }

  private active(): Run | null {
    return this.runs.find((r) => OPEN.includes(r.state)) ?? null;
  }

  // Whether someone holds the ghost seat: a run in progress, or a player getting their deposit ready.
  taken(player?: string): boolean {
    const run = this.active();
    if (run) return run.player !== player;
    if (this.seat && Date.now() - this.seat.since > SEAT_LIFE) this.seat = null;
    return this.seat !== null && this.seat.player !== player;
  }

  reserve(player: string): boolean {
    if (!this.enabled || this.taken(player)) return false;
    if (!this.active()) this.seat = { player, since: Date.now() };
    return true;
  }

  release(player: string): void {
    if (this.seat?.player === player) this.seat = null;
  }

  async start(player: string, id: string, bundle: GhostBundle): Promise<RunView> {
    if (!this.enabled) throw new Error('this server has no private pool');
    if (this.taken(player)) throw new Error('another ghost run is already chasing on this server');
    if (this.runs.some((r) => r.id === id)) throw new Error('this run has already started');
    const problem = checkGhostBundle(bundle, this.d.network);
    if (problem) throw new Error(problem);
    const out = await this.d.rpc.call<{ value: number } | null>('gettxout', bundle.coin.txid, bundle.coin.vout, true);
    if (!out || Math.round(out.value * 1e8) !== bundle.coin.amount) throw new Error('the deposit is not there, or holds another amount');
    if (bundle.first + bundle.count - 1 <= this.d.watcher.tip.height) throw new Error('every number of this run is already past');
    const run: Run = { id, player, bundle, state: 'waiting', stopped: false, sent: [], refund: null, note: '', winner: null, block: null, created: Date.now() };
    this.runs.push(run);
    this.seat = null;
    this.save();
    log(`👻 ghost run ${tagOf(player)} for ${bundle.first.toLocaleString()}-${(bundle.first + bundle.count - 1).toLocaleString()} from ${bundle.start} sat/vB`);
    void this.step();
    return this.view(run);
  }

  stop(player: string, id: string): RunView {
    const run = this.runs.find((r) => r.id === id && r.player === player);
    if (!run) throw new Error('no such ghost run');
    if (OPEN.includes(run.state)) run.stopped = true;
    this.save();
    void this.step();
    return this.view(run);
  }

  get(player: string, id: string): RunView | null {
    const run = this.runs.find((r) => r.id === id && r.player === player);
    return run ? this.view(run) : null;
  }

  private view(r: Run): RunView {
    const { first, count, start, extra, coin } = r.bundle;
    return { id: r.id, state: r.state, stopped: r.stopped, first, count, start, extra, deposit: coin, sent: r.sent, refund: r.refund, note: r.note, winner: r.winner, block: r.block };
  }

  // Runs on every new tip and every block read; overlapping calls fold into one more pass.
  async step(height = -1): Promise<void> {
    this.height = Math.max(this.height, height);
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        const run = this.active();
        if (run) await this.advance(run);
      } while (this.again);
    } catch (e) {
      log(`ghost run: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async advance(run: Run): Promise<void> {
    const { rpc, watcher } = this.d;
    const b = run.bundle;
    const deposit = await rpc.call<{ confirmations?: number }>('getrawtransaction', b.coin.txid, true).catch(() => null);
    if (!deposit) {
      if (Date.now() - run.created > 6 * 3600_000) this.finish(run, 'gone', 'the deposit never reached the network');
      return;
    }
    if (!deposit.confirmations) {
      if (run.stopped) await this.takeBack(run);
      return;
    }
    const unspent = await rpc.call<object | null>('gettxout', b.coin.txid, b.coin.vout, false);
    if (!unspent) return this.settle(run);
    if (run.state === 'waiting') {
      run.state = 'chasing';
      this.save();
    }

    const tip = Math.max(watcher.tip.height, this.height);
    const n = tip + 1;
    const last = b.first + b.count - 1;
    if (run.stopped || n > last) return this.takeBack(run);
    if (n < b.first) return;

    const prev = run.sent.at(-1) ?? null;
    let floor: number;
    try {
      floor = await this.d.pool!.floor();
    } catch (e) {
      run.note = `could not read the private floor: ${(e as Error).message}`;
      floor = prev?.rate ?? b.start;
    }
    const mine = new Set(run.sent.map((s) => s.txid));
    let top = 0;
    for (const p of watcher.pool.values()) {
      if (mine.has(p.txid) || !p.effVsize || !p.claims.some((c) => c.n === n)) continue;
      top = Math.max(top, p.effFee / p.effVsize);
    }
    const incremental = Math.max(0.1, watcher.rates.incremental);
    const want = Math.max(floor, top + 0.01);
    if (prev?.n === n && prev.rate >= want) return;
    const rungs = b.claims.filter((c) => c.n === n).sort((x, y) => x.rung - y.rung);
    const usable = rungs.filter((c) => c.rate >= floor && c.fee >= replacementFee(prev, c.vsize, incremental));
    const pick = usable.find((c) => c.rate >= want) ?? usable.at(-1);
    if (!pick) {
      run.note = `the private floor is ${floor} sat/vB, above every fee you signed for ${n.toLocaleString()}`;
      return this.takeBack(run);
    }
    if (prev?.txid === pick.txid) return;
    if (!(await this.send(run, pick, usable))) return;
    if (n === last) await this.takeBack(run);
  }

  // Sends a claim to the private pool. When the pool wants a higher fee than expected (its replacement step may be
  // larger than ours), it climbs the signed rungs until one is taken.
  private async send(run: Run, pick: GhostClaim, usable: GhostClaim[]): Promise<boolean> {
    for (const c of usable.filter((x) => x.rung >= pick.rung)) {
      try {
        await this.d.pool!.submit(c.hex);
        run.sent.push({ n: c.n, rung: c.rung, txid: c.txid, fee: c.fee, vsize: c.vsize, rate: c.rate, at: Date.now() });
        run.note = '';
        this.save();
        log(`👻 claim for ${c.n.toLocaleString()}.bitmap waits at ${this.d.pool!.name}: ${c.rate} sat/vB, ${c.fee} sats`);
        return true;
      } catch (e) {
        const reason = (e as Error).message;
        run.note = `${this.d.pool!.name} refused the claim for ${c.n.toLocaleString()}: ${reason}`;
        this.save();
        if (!/fee/i.test(reason)) return false;
      }
    }
    return false;
  }

  // The deposit back to the player in public, at the next-block rate. It races the last claim waiting in the private
  // pool, which can still win if that pool mines first; each block it is raised while it waits.
  private async takeBack(run: Run): Promise<void> {
    const r = this.d.watcher.rates;
    const want = Math.max(r.nextBlock, r.minRelay) + 0.1;
    const offers = [...run.bundle.refunds].sort((x, y) => x.rate - y.rate);
    const pick: GhostRefund | undefined = offers.find((x) => x.rate >= want) ?? offers.at(-1);
    if (!pick || (run.refund && run.refund.rate >= pick.rate)) return;
    try {
      await this.d.rpc.call('sendrawtransaction', pick.hex);
      run.refund = { txid: pick.txid, fee: pick.fee, rate: pick.rate, at: Date.now() };
      log(`👻 ghost run ${tagOf(run.player)} ends: refund ${pick.txid.slice(0, 10)}… at ${pick.rate} sat/vB`);
    } catch (e) {
      run.note = `could not send the refund yet: ${(e as Error).message}`;
    }
    this.save();
  }

  // The deposit was spent in a block: whatever spent it decides how the run ended.
  private async settle(run: Run): Promise<void> {
    for (const s of [...run.sent].reverse()) {
      const tx = await this.d.rpc.call<{ confirmations?: number; blockhash?: string }>('getrawtransaction', s.txid, true).catch(() => null);
      if (!tx?.confirmations || !tx.blockhash) continue;
      const { height } = await this.d.rpc.call<{ height: number }>('getblockheader', tx.blockhash);
      // The quick tip watch can get here before the block is read: wait for it, so the bitmap's owner is known.
      if (this.d.bitmaps.scannedTo < height) return;
      const holder = this.d.bitmaps.claimed(s.n);
      if (holder === undefined) return;
      run.block = height;
      run.winner = holder?.inscription ?? null;
      const won = holder?.inscription === `${s.txid}i0`;
      return this.finish(run, won ? 'won' : 'lost', won ? '' : `the claim for ${s.n.toLocaleString()} was mined, but another claim came first`);
    }
    if (run.refund) {
      const tx = await this.d.rpc.call<{ confirmations?: number }>('getrawtransaction', run.refund.txid, true).catch(() => null);
      if (tx?.confirmations) return this.finish(run, 'refunded', '');
    }
    return this.finish(run, 'lost', 'the deposit was spent by a transaction this run did not send');
  }

  private finish(run: Run, state: RunState, note: string): void {
    run.state = state;
    run.note = note;
    this.save();
    log(`👻 ghost run ${tagOf(run.player)}: ${state}${note ? ` (${note})` : ''}`);
  }
}

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Built,
  buildReveal,
  chunkRate,
  type Coin,
  commitFor,
  feeForRate,
  newSecret,
  POSTAGE,
  replacementFee,
  type RevealParams,
  toHex,
} from '@bitmap-battle/core';
import { log } from './log.ts';
import type { PrivatePool } from './private.ts';
import type { Rpc } from './rpc.ts';
import type { Watcher } from './watcher.ts';

// Regtest only: a play-money wallet standing in for Xverse, block mining, and a rival bot that fights the way
// the real bitmap bot does (claims a few seconds after each block, raises when outbid, up to its maximum).

type Account = { address: string; publicKey: string };
type RivalCoin = { n: number; secret: Uint8Array; coin: Coin; reveal: Built | null; outbidAt: number | null };

const WALLET = 'bb-dev';
const RIVAL_BUDGET = 50_000;
const FAUCET = 1_000_000;

type Unspent = { txid: string; vout: number; amount: number; address?: string; confirmations: number; spendable: boolean };
type Held = { txid: string; hex: string; outpoint: string; fee: number; vsize: number; locktime: number };
type Decoded = { txid: string; vsize: number; locktime: number; vin: { txid: string; vout: number }[]; vout: { value: number }[] };

export class Dev {
  accounts!: { payment: Account; ordinals: Account };
  tipJar = '';
  rival = { enabled: false, maxRate: 5, step: 0.3, delayMs: 4000, reactMs: 3000 };
  automine = 0;
  private miner = '';
  private rivalAddresses = { postage: '', change: '' };
  private readonly coins = new Map<number, RivalCoin>();
  private mineTimer: NodeJS.Timeout | null = null;
  private busy = false;
  // A stand-in for MARA Slipstream: transactions held out of the public mempool, replaced by fee the way a node does,
  // and mined only by "MARA blocks". The private rival claims every block through it at a fixed rate, like the
  // ghost bot does on mainnet.
  privateFloor = 2;
  privateRival = { enabled: false, rate: 3.1, claimed: 0 };
  private readonly held = new Map<string, Held>();
  private readonly maraBlocks = new Set<string>();
  private privateRivalAt = -1;
  private readonly privateCoins = new Map<number, { secret: Uint8Array; coin: Coin }>();

  readonly pool: PrivatePool = {
    name: 'the regtest private pool',
    floor: async () => this.privateFloor,
    submit: async (hex) => {
      await this.hold(hex);
    },
  };

  constructor(
    private readonly node: Rpc,
    private readonly wallet: Rpc,
    private readonly watcher: Watcher,
    private readonly dataDir: string,
  ) {}

  async init(): Promise<void> {
    const loaded = await this.node.call<string[]>('listwallets');
    if (!loaded.includes(WALLET)) {
      await this.node.call('loadwallet', WALLET).catch(() => this.node.call('createwallet', WALLET));
    }
    const file = join(this.dataDir, 'dev-accounts.json');
    if (!existsSync(file)) {
      const account = async (label: string, type: string): Promise<Account> => {
        const address = await this.wallet.call<string>('getnewaddress', label, type);
        const info = await this.wallet.call<{ pubkey?: string; witness_program?: string }>('getaddressinfo', address);
        return { address, publicKey: info.pubkey ?? info.witness_program ?? '' };
      };
      const saved = {
        payment: await account('player payment', 'bech32'),
        ordinals: await account('player ordinals', 'bech32m'),
        miner: await this.wallet.call<string>('getnewaddress', 'miner', 'bech32'),
        rivalPostage: await this.wallet.call<string>('getnewaddress', 'rival', 'bech32m'),
        rivalChange: await this.wallet.call<string>('getnewaddress', 'rival change', 'bech32'),
      };
      writeFileSync(file, JSON.stringify(saved, null, 1));
    }
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (!saved.tipJar) {
      saved.tipJar = await this.wallet.call<string>('getnewaddress', 'tip jar', 'bech32');
      writeFileSync(file, JSON.stringify(saved, null, 1));
    }
    this.tipJar = saved.tipJar;
    this.accounts = { payment: saved.payment, ordinals: saved.ordinals };
    this.miner = saved.miner;
    this.rivalAddresses = { postage: saved.rivalPostage, change: saved.rivalChange };
    const height = await this.node.call<number>('getblockcount');
    if (height < 150) await this.mine(150 - height);
    setInterval(() => void this.tick(), 1000);
  }

  // Like Xverse: the player pays only from the payment address, and the change goes back to it.
  async send(address: string, amount: number): Promise<string> {
    return this.spend('player', address, amount);
  }

  // Play money for the player: a confirmed coin on the payment address, from the bank.
  async faucet(amount = FAUCET): Promise<string> {
    const txid = await this.spend('bank', this.accounts.payment.address, amount);
    await this.mine(1);
    return txid;
  }

  // The player's coins and the bank's (everything else in the wallet: mined coins, the rival's change) never mix.
  private async spend(from: 'player' | 'bank', address: string, amount: number): Promise<string> {
    const player = this.accounts.payment.address;
    const coins = (await this.wallet.call<Unspent[]>('listunspent', from === 'player' ? 0 : 1, 9_999_999))
      .filter((c) => c.spendable && (from === 'player' ? c.address === player : c.address !== player && c.address !== this.accounts.ordinals.address))
      .sort((a, b) => b.amount - a.amount);
    const inputs: { txid: string; vout: number }[] = [];
    let total = 0;
    for (const c of coins) {
      inputs.push({ txid: c.txid, vout: c.vout });
      total += Math.round(c.amount * 1e8);
      if (total >= amount + 20_000) break;
    }
    if (total < amount + 1_000) throw new Error(from === 'player' ? 'Insufficient balance' : 'The test bank is empty: mine a few blocks.');
    const result = await this.wallet.call<{ txid: string }>('send', [{ [address]: amount / 1e8 }], null, 'unset', 2, {
      inputs,
      add_inputs: false,
      change_address: from === 'player' ? player : this.miner,
    });
    return result.txid;
  }

  async utxos(address: string): Promise<{ value: number; confirmed: boolean }[]> {
    const coins = await this.wallet.call<{ amount: number; confirmations: number }[]>('listunspent', 0, 9_999_999, [address]);
    return coins.map((c) => ({ value: Math.round(c.amount * 1e8), confirmed: c.confirmations > 0 }));
  }

  async mine(blocks = 1): Promise<string[]> {
    return this.node.call<string[]>('generatetoaddress', blocks, this.miner);
  }

  async broadcast(hex: string): Promise<string> {
    return this.node.call<string>('sendrawtransaction', hex);
  }

  setAutomine(seconds: number): void {
    if (this.mineTimer) clearInterval(this.mineTimer);
    this.mineTimer = null;
    this.automine = seconds > 0 ? Math.max(10, seconds) : 0;
    if (this.automine) this.mineTimer = setInterval(() => void this.mine().catch(() => {}), this.automine * 1000);
  }

  status() {
    return {
      accounts: this.accounts,
      rival: this.rival,
      automine: this.automine,
      private: { floor: this.privateFloor, held: this.held.size, rival: this.privateRival },
    };
  }

  // The pool of a block mined here: only the coinbase of a real block names it.
  poolOf(hash: string): string | null {
    return this.maraBlocks.has(hash) ? 'MARA Pool' : null;
  }

  private async hold(hex: string): Promise<string> {
    const tx = await this.node.call<Decoded>('decoderawtransaction', hex);
    const [input] = tx.vin;
    const outpoint = `${input.txid}:${input.vout}`;
    const prev = await this.node.call<{ value: number } | null>('gettxout', input.txid, input.vout, true);
    if (!prev) throw new Error('bad-txns-inputs-missingorspent');
    const fee = Math.round(prev.value * 1e8) - tx.vout.reduce((s, o) => s + Math.round(o.value * 1e8), 0);
    if (fee / tx.vsize < this.privateFloor) throw new Error(`fee rate ${(fee / tx.vsize).toFixed(2)} is below the private floor of ${this.privateFloor}`);
    const [check] = await this.node.call<{ allowed: boolean; 'reject-reason'?: string }[]>('testmempoolaccept', [hex]);
    if (!check.allowed) throw new Error(check['reject-reason'] ?? 'rejected');
    const old = this.held.get(outpoint);
    if (old && old.txid !== tx.txid && fee < replacementFee(old, tx.vsize, Math.max(0.1, this.watcher.rates.incremental))) {
      throw new Error(`insufficient fee, rejecting replacement ${tx.txid}`);
    }
    this.held.set(outpoint, { txid: tx.txid, hex, outpoint, fee, vsize: tx.vsize, locktime: tx.locktime });
    return tx.txid;
  }

  // A block from the private pool: the public mempool and the held transactions, best fee rate first, the way a pool
  // fills its template. A held transaction takes the place of a public one spending the same coin when it pays more.
  async mineMara(): Promise<string> {
    const height = (await this.node.call<number>('getblockcount')) + 1;
    type Template = { transactions: { data: string; txid: string; fee: number; weight: number; depends: number[] }[] };
    const tpl = await this.node.call<Template>('getblocktemplate', { rules: ['segwit'] });
    type Item = { hex: string; txid: string; fee: number; rate: number; spends: string[]; parents: string[] };
    const items: Item[] = [];
    for (const t of tpl.transactions) {
      const d = await this.node.call<Decoded>('decoderawtransaction', t.data);
      items.push({
        hex: t.data,
        txid: t.txid,
        fee: t.fee,
        rate: t.fee / (t.weight / 4),
        spends: d.vin.map((i) => `${i.txid}:${i.vout}`),
        parents: t.depends.map((k) => tpl.transactions[k - 1].txid),
      });
    }
    for (const h of [...this.held.values()]) {
      if (h.locktime >= height) continue;
      const [txid, vout] = h.outpoint.split(':');
      const spender = items.find((i) => i.spends.includes(h.outpoint));
      if (spender) {
        if (spender.fee >= h.fee) continue;
        const gone = new Set([spender.txid]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const i of items) {
            if (!gone.has(i.txid) && i.parents.some((p) => gone.has(p))) {
              gone.add(i.txid);
              grew = true;
            }
          }
        }
        for (let k = items.length - 1; k >= 0; k--) if (gone.has(items[k].txid)) items.splice(k, 1);
      } else if (!(await this.node.call<object | null>('gettxout', txid, Number(vout), true))) {
        this.held.delete(h.outpoint);
        continue;
      }
      items.push({ hex: h.hex, txid: h.txid, fee: h.fee, rate: h.fee / h.vsize, spends: [h.outpoint], parents: items.some((i) => i.txid === txid) ? [txid] : [] });
    }
    const ordered: Item[] = [];
    const placed = new Set<string>();
    const left = [...items];
    while (left.length) {
      const ready = left.filter((i) => i.parents.every((p) => placed.has(p))).sort((a, b) => b.rate - a.rate);
      if (!ready.length) break;
      ordered.push(ready[0]);
      placed.add(ready[0].txid);
      left.splice(left.indexOf(ready[0]), 1);
    }
    const { hash } = await this.node.call<{ hash: string }>('generateblock', this.miner, ordered.map((i) => i.hex));
    this.maraBlocks.add(hash);
    for (const h of [...this.held.values()]) if (placed.has(h.txid)) this.held.delete(h.outpoint);
    const held = ordered.filter((i) => !tpl.transactions.some((t) => t.txid === i.txid)).length;
    log(`MARA block ${height}: ${ordered.length} transactions, ${held} of them private`);
    return hash;
  }

  // The private rival, like the ghost bot on mainnet: each block it funds a fresh coin for the number after next, and
  // claims the next number at a fixed rate from the coin it funded a block ago, never raising.
  private async privateClaim(): Promise<void> {
    const n = this.watcher.tip.height + 1;
    if (n === this.privateRivalAt) return;
    this.privateRivalAt = n;
    for (const k of this.privateCoins.keys()) if (k < n) this.privateCoins.delete(k);
    const ready = this.privateCoins.get(n);
    if (!this.privateCoins.has(n + 1)) {
      const secret = newSecret();
      const commit = commitFor(secret, n + 1, 'regtest');
      const txid = await this.spend('bank', commit.address, RIVAL_BUDGET);
      const tx = await this.node.call<{ vout: { n: number; scriptPubKey: { hex: string } }[] }>('getrawtransaction', txid, 1);
      const vout = tx.vout.find((o) => o.scriptPubKey.hex === toHex(commit.script))!.n;
      this.privateCoins.set(n + 1, { secret, coin: { txid, vout, amount: RIVAL_BUDGET } });
    }
    if (!ready) return;
    const params: RevealParams = {
      secret: ready.secret,
      n,
      coin: ready.coin,
      postageAddress: this.rivalAddresses.postage,
      changeAddress: this.rivalAddresses.change,
      network: 'regtest',
    };
    const built = buildReveal(params, Math.ceil(this.privateRival.rate * buildReveal(params, 0, false).vsize));
    await this.hold(built.hex);
    this.privateRival.claimed = n;
    log(`private rival claimed ${n}.bitmap at ${this.privateRival.rate} sat/vB`);
  }

  private async fund(n: number): Promise<void> {
    const secret = newSecret();
    const commit = commitFor(secret, n, 'regtest');
    const txid = await this.spend('bank', commit.address, RIVAL_BUDGET);
    const tx = await this.node.call<{ vout: { n: number; scriptPubKey: { hex: string } }[] }>('getrawtransaction', txid, 1);
    const vout = tx.vout.find((o) => o.scriptPubKey.hex === toHex(commit.script))!.n;
    this.coins.set(n, { n, secret, coin: { txid, vout, amount: RIVAL_BUDGET }, reveal: null, outbidAt: null });
  }

  private async claim(c: RivalCoin, target: number): Promise<void> {
    const params: RevealParams = {
      secret: c.secret,
      n: c.n,
      coin: c.coin,
      postageAddress: this.rivalAddresses.postage,
      changeAddress: this.rivalAddresses.change,
      network: 'regtest',
    };
    const slot = c.reveal?.txid ?? 'claim';
    const cluster = await this.watcher.cluster(c.reveal?.txid ?? c.coin.txid);
    const { vsize } = buildReveal(params, 0, false);
    const { minRelay, incremental } = this.watcher.rates;
    const least = c.reveal ? c.reveal.fee + Math.ceil(incremental * vsize) : Math.ceil(minRelay * vsize);
    const fee = feeForRate(target, least, c.coin.amount - POSTAGE, (f) => {
      const b = buildReveal(params, f, false);
      return chunkRate(cluster, slot, b.fee, b.vsize);
    });
    if (fee === null) return;
    const built = buildReveal(params, fee);
    await this.broadcast(built.hex);
    log(`rival ${c.reveal ? 'raised' : 'claimed'} ${c.n}.bitmap at ${target.toFixed(2)} sat/vB`);
    c.reveal = built;
  }

  private async tick(): Promise<void> {
    if (this.busy || this.watcher.syncing) return;
    if (this.privateRival.enabled) await this.privateClaim().catch((e) => log(`private rival: ${(e as Error).message}`));
    if (!this.rival.enabled) return;
    this.busy = true;
    try {
      const live = this.watcher.tip.height + 1;
      for (const n of this.coins.keys()) if (n < live) this.coins.delete(n);
      for (const n of [live, live + 1]) if (!this.coins.has(n)) await this.fund(n);
      const c = this.coins.get(live)!;
      let top: number | null = null;
      for (const p of this.watcher.pool.values()) {
        if (p.txid === c.reveal?.txid || !p.effVsize || !p.claims.some((x) => x.n === live)) continue;
        top = Math.max(top ?? 0, p.effFee / p.effVsize);
      }
      const { maxRate, step } = this.rival;
      if (!c.reveal) {
        if (Date.now() - this.watcher.tip.seenAt < this.rival.delayMs) return;
        const base = Math.max(this.watcher.rates.nextBlock, this.watcher.rates.minRelay) + 0.2;
        const target = top === null ? base : Math.max(base, top + step);
        if (target <= maxRate) await this.claim(c, target);
        return;
      }
      const mine = this.watcher.pool.get(c.reveal.txid);
      if (!mine || !mine.effVsize) return;
      if (top !== null && top >= mine.effFee / mine.effVsize - 1e-9) {
        c.outbidAt ??= Date.now();
        if (Date.now() - c.outbidAt < this.rival.reactMs || top + step > maxRate) return;
        await this.claim(c, top + step);
        c.outbidAt = null;
      } else {
        c.outbidAt = null;
      }
    } catch (e) {
      log(`rival: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}

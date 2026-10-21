import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Built, buildReveal, chunkRate, type Coin, commitFor, feeForRate, newSecret, POSTAGE, type RevealParams, toHex } from '@bitmap-battle/core';
import { log } from './log.ts';
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
    return { accounts: this.accounts, rival: this.rival, automine: this.automine };
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
    if (!this.rival.enabled || this.busy || this.watcher.syncing) return;
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

// End-to-end battles on the regtest server (npm run regtest first): a win against the rival bot with raises, a
// loss, and a deposit taken back while its claim waits. Every transaction goes through the node's own checks.
// Usage: npx tsx scripts/e2e-regtest.ts [http://127.0.0.1:8788]
import assert from 'node:assert/strict';
import {
  type Built,
  buildRefund,
  buildReveal,
  chunkRate,
  type ClusterTx,
  type Coin,
  commitFor,
  feeForRate,
  newSecret,
  POSTAGE,
  type RevealParams,
  toHex,
} from '@bitmap-battle/core';

const base = process.argv[2] ?? 'http://127.0.0.1:8788';
const player = 'e2e-player-0123456789abcdef';

type Claim = { txid: string; eff: number };
type State = {
  tip: { height: number };
  rates: { nextBlock: number; minRelay: number; incremental: number };
  tables: { n: number; kind: string; claims: Claim[]; seat: string | null }[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${body.error}`);
  return body as T;
}
async function post<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${body.error}`);
  return body as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = () => get<State>('/api/state');
async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function nextBlock(): Promise<number> {
  const before = (await state()).tip.height;
  await post('/dev/mine', { blocks: 1 });
  return until('the server to see the block', async () => {
    const s = await state();
    return s.tip.height > before && s.tip.height;
  });
}

const { accounts } = await get<{ accounts: { payment: { address: string }; ordinals: { address: string } } }>('/dev/status');
const funded = (await state()).tip.height;
await post('/dev/faucet', {});
await until('the faucet block', async () => (await state()).tip.height > funded);

class Player {
  secret = newSecret();
  coin!: Coin;
  claims: Built[] = [];
  constructor(readonly n: number) {}

  async deposit(amount: number): Promise<void> {
    const commit = commitFor(this.secret, this.n, 'regtest');
    const { txid } = await post<{ txid: string }>('/dev/send', { address: commit.address, amount });
    const tx = await until('the deposit', () => get<{ outputs: { n: number; value: number; script: string }[] }>(`/api/tx/${txid}`).catch(() => null));
    const out = tx.outputs.find((o) => o.script === toHex(commit.script))!;
    this.coin = { txid, vout: out.n, amount: out.value };
  }

  params(): RevealParams {
    return { secret: this.secret, n: this.n, coin: this.coin, postageAddress: accounts.ordinals.address, changeAddress: accounts.payment.address, network: 'regtest' };
  }

  // The same pricing as the app: the lowest fee whose chunk rate reaches the target.
  async bid(target: number): Promise<Built> {
    const s = await state();
    const last = this.claims.at(-1);
    const slot = last?.txid ?? 'claim';
    let { cluster } = await get<{ cluster: ClusterTx[] }>(`/api/cluster/${last?.txid ?? this.coin.txid}`);
    if (last && !cluster.some((t) => t.txid === last.txid)) cluster = (await get<{ cluster: ClusterTx[] }>(`/api/cluster/${this.coin.txid}`)).cluster;
    const p = this.params();
    const { vsize } = buildReveal(p, 0, false);
    const least = last ? last.fee + Math.ceil(s.rates.incremental * vsize) + 1 : Math.ceil(s.rates.minRelay * vsize) + 1;
    const fee = feeForRate(target, least, this.coin.amount - POSTAGE, (f) => {
      const t = buildReveal(p, f, false);
      return chunkRate(cluster, slot, t.fee, t.vsize);
    });
    assert.ok(fee !== null, `budget cannot reach ${target}`);
    const built = buildReveal(p, fee);
    await post('/dev/broadcast', { hex: built.hex });
    this.claims.push(built);
    await until('the claim in the table', async () => (await state()).tables.find((t) => t.n === this.n)?.claims.some((c) => c.txid === built.txid));
    return built;
  }

  async view(): Promise<{ mine: Claim; top: number | null }> {
    const t = (await state()).tables.find((x) => x.n === this.n)!;
    const mine = t.claims.find((c) => c.txid === this.claims.at(-1)!.txid)!;
    const rivals = t.claims.filter((c) => !this.claims.some((m) => m.txid === c.txid));
    return { mine, top: rivals.length ? Math.max(...rivals.map((c) => c.eff)) : null };
  }
}

let s = await state();
const n1 = s.tip.height + 1;
console.log(`battle 1: ${n1}.bitmap against the rival bot (max 3 sat/vB)`);
await post('/api/seat', { n: n1, player });
await post('/dev/rival', { enabled: true, maxRate: 3 });
const p1 = new Player(n1);
await p1.deposit(30_000);
console.log('  deposit in, waiting for the rival to claim');
await until('the rival claim', async () => (await state()).tables.find((t) => t.n === n1)!.claims.length > 0);
let v = { top: Math.max(...(await state()).tables.find((t) => t.n === n1)!.claims.map((c) => c.eff)) };
// Like the app: 0.01 sat/vB above the best rival and above the next-block line, rounded up.
const raiseTo = (top: number, r: State['rates']) => Math.ceil(Math.max(r.nextBlock, r.minRelay, top) * 100 + 1 - 1e-6) / 100;
let built = await p1.bid(raiseTo(v.top, (await state()).rates));
console.log(`  MINT at ${(built.fee / built.vsize).toFixed(2)} sat/vB (own rate), fee ${built.fee}`);
for (let round = 0; round < 24; round++) {
  await sleep(4500);
  const now = await p1.view();
  console.log(`  me ${now.mine.eff} vs top rival ${now.top}`);
  if (now.top === null || now.mine.eff > now.top) {
    if (round >= 2) break;
    continue;
  }
  built = await p1.bid(raiseTo(now.top, (await state()).rates));
  const after = await p1.view();
  console.log(`  RAISE to ${after.mine.eff} (rival ${now.top}, +${(after.mine.eff - now.top).toFixed(2)})`);
}
const final = await p1.view();
assert.ok(final.top === null || final.mine.eff > final.top, 'player should lead before the block');
const h1 = await nextBlock();
const r1 = await until('the bitmap result', async () => {
  const r = await get<{ claimed: { inscription: string } | null | 'unknown' }>(`/api/bitmap/${n1}`);
  return r.claimed && r.claimed !== 'unknown' ? r.claimed : null;
});
assert.equal(r1.inscription, `${p1.claims.at(-1)!.txid}i0`);
console.log(`  WON ${n1}.bitmap in block ${h1} with ${r1.inscription.slice(0, 16)}… after ${p1.claims.length} bids`);

s = await state();
const n2 = s.tip.height + 1;
console.log(`battle 2: ${n2}.bitmap, the rival goes to 20 sat/vB and the player stops`);
await post('/dev/rival', { enabled: true, maxRate: 20 });
const p2 = new Player(n2);
await p2.deposit(10_000);
await until('the rival claim', async () => (await state()).tables.find((t) => t.n === n2)!.claims.length > 0);
v = { top: Math.max(...(await state()).tables.find((t) => t.n === n2)!.claims.map((c) => c.eff)) };
await p2.bid(Math.round((v.top + 0.1) * 100) / 100);
await until('the rival to outbid', async () => {
  const x = await p2.view();
  return x.top !== null && x.top > x.mine.eff;
});
console.log('  outbid by the rival; mining');
await nextBlock();
const r2 = await until('the bitmap result', async () => {
  const r = await get<{ claimed: { inscription: string } | null | 'unknown' }>(`/api/bitmap/${n2}`);
  return r.claimed && r.claimed !== 'unknown' ? r.claimed : null;
});
assert.ok(!p2.claims.some((c) => r2.inscription.startsWith(c.txid)), 'the rival should win');
console.log(`  LOST ${n2}.bitmap to ${r2.inscription.slice(0, 16)}… as expected`);

await post('/dev/rival', { enabled: false });
s = await state();
const n3 = s.tip.height + 1;
console.log(`battle 3: ${n3}.bitmap, claim then leave before the block`);
const p3 = new Player(n3);
await p3.deposit(20_000);
const claim3 = await p3.bid(Math.max(s.rates.nextBlock, s.rates.minRelay) + 0.1);
const spend = await get<{ unspent: boolean; spender: string | null }>(`/api/outspend/${p3.coin.txid}/${p3.coin.vout}`);
assert.equal(spend.spender, claim3.txid);
const refundParams = { secret: p3.secret, n: n3, coin: p3.coin, toAddress: accounts.payment.address, network: 'regtest' as const };
const { vsize: rv } = buildRefund(refundParams, 0, false);
const refund = buildRefund(refundParams, claim3.fee + Math.ceil(s.rates.incremental * rv) + 1);
await post('/dev/broadcast', { hex: refund.hex });
const after = await get<{ unspent: boolean; spender: string | null }>(`/api/outspend/${p3.coin.txid}/${p3.coin.vout}`);
assert.equal(after.spender, refund.txid);
await nextBlock();
const r3 = await get<{ claimed: unknown }>(`/api/bitmap/${n3}`);
assert.equal(r3.claimed, null);
const tx = await get<{ confirmations: number; outputs: { value: number }[] }>(`/api/tx/${refund.txid}`);
assert.ok(tx.confirmations >= 1);
console.log(`  LEFT: ${tx.outputs[0].value} of 20000 sats back (fee ${refund.fee}), ${n3}.bitmap still unclaimed`);

const p4 = new Player(n3);
await p4.deposit(8_000);
const plain = buildRefund({ ...refundParams, secret: p4.secret, coin: p4.coin }, 200);
await post('/dev/broadcast', { hex: plain.hex });
console.log('battle 4: an unused deposit taken back by the key path: ok');
console.log(`\nraw reveal of the won battle (for ord decode):\n${p1.claims.at(-1)!.hex}`);

// End-to-end ghost runs on the regtest server (npm run regtest first), against its stand-in for a private pool: a run
// that climbs block after block and wins in a MARA block, a run stopped with its refund, runs forwarded to later
// tries, and runs against a private rival that pays 3.10 sat/vB every block.
// Usage: npx tsx scripts/e2e-ghost.ts [http://127.0.0.1:8788]
import assert from 'node:assert/strict';
import { commitTree, type GhostPlan, ghostBundle, ghostDeposit, ghostRate, newSecret, toHex } from '@bitmap-battle/core';

const base = process.argv[2] ?? 'http://127.0.0.1:8788';
const player = `e2e-ghost-${Date.now().toString(36)}-0123456789`;

type Run = { state: string; stopped: boolean; skip: number; sent: { n: number; rate: number; fee: number; txid: string }[]; refund: { txid: string } | null; note: string; winner: string | null };
type State = { tip: { height: number }; results: { height: number; pool: string | null; claims: { n: number; txid: string; owner: string | null; ghost: boolean; valid: boolean | null }[] }[] };

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
async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function block(kind: 'normal' | 'mara'): Promise<number> {
  const before = (await state()).tip.height;
  await post(kind === 'mara' ? '/dev/mine-mara' : '/dev/mine', { blocks: 1 });
  return until('the server to see the block', async () => {
    const s = await state();
    return s.tip.height > before && s.tip.height;
  });
}

const { accounts } = await get<{ accounts: { payment: { address: string }; ordinals: { address: string } } }>('/dev/status');
const ordinals = accounts.ordinals.address;
const payment = accounts.payment.address;
await post('/dev/private', { floor: 2, rival: false });
await post('/dev/rival', { enabled: false });
await post('/dev/faucet', {});
await sleep(1500);

// Deposits a run like the browser does, signs its bundle and hands it to the server.
async function startRun(start: number, extra: number, count: number) {
  const tip = (await state()).tip.height;
  const plan: GhostPlan = { first: tip + 2, count, start, extra };
  const secret = newSecret();
  const tree = commitTree(secret, plan.first, plan.count, 'regtest');
  const amount = ghostDeposit(plan, 'regtest', ordinals, payment);
  await post('/api/ghost/seat', { player });
  const { txid } = await post<{ txid: string }>('/dev/send', { address: tree.address, amount });
  const tx = await until('the deposit', () => get<{ outputs: { n: number; value: number; script: string }[] }>(`/api/tx/${txid}`).catch(() => null));
  const out = tx.outputs.find((o) => o.script === toHex(tree.script))!;
  const coin = { txid, vout: out.n, amount: out.value };
  const bundle = ghostBundle({ ...plan, secret, network: 'regtest', coin, ordinals, payment, refundRates: [1, 2, 4, 8, 16] });
  const id = `run-${Date.now().toString(36)}`;
  await post('/api/ghost/start', { player, id, bundle });
  const view = () => get<Run>(`/api/ghost/run/${id}?player=${player}`);
  // Signs the claims from number n on again at the rates of try `to` onward, like the page's FORWARD.
  const forward = (n: number, to: number, who = player) =>
    post<Run>('/api/ghost/forward', {
      player: who,
      id,
      bundle: ghostBundle({ ...plan, secret, network: 'regtest', coin, ordinals, payment, refundRates: [], skip: to - (n - plan.first + 1), from: n }),
    });
  return { id, plan, view, forward, claims: bundle.claims.length };
}

const sent = async (view: () => Promise<Run>, k: number) => until(`claim ${k} at the private pool`, async () => ((await view()).sent.length >= k ? view() : null));

console.log('run 1: climbs block after block, the floor jumps, then a MARA block');
{
  const r = await startRun(3.2, 2, 6);
  console.log(`  ${r.claims} claims signed for ${r.plan.first}-${r.plan.first + 5}`);
  await block('normal');
  let v = await sent(r.view, 1);
  assert.equal(v.sent[0].n, r.plan.first);
  console.log(`  claim for ${v.sent[0].n} held at ${v.sent[0].rate} sat/vB`);
  await block('normal');
  v = await sent(r.view, 2);
  assert.equal(v.sent[1].n, r.plan.first + 1);
  assert.ok(v.sent[1].fee > v.sent[0].fee);
  console.log(`  a normal pool mined the block: replaced by the claim for ${v.sent[1].n} at ${v.sent[1].rate}`);
  await post('/dev/private', { floor: 4 });
  await block('normal');
  v = await sent(r.view, 3);
  assert.ok(v.sent[2].rate >= 4, `rate ${v.sent[2].rate} should clear the floor of 4`);
  console.log(`  the private floor rose to 4: claim for ${v.sent[2].n} took a higher rung, ${v.sent[2].rate}`);
  await post('/dev/private', { floor: 2 });
  const h = await block('mara');
  v = await until('the win', async () => ((await r.view()).state === 'won' ? r.view() : null));
  assert.equal(v.winner, `${v.sent.at(-1)!.txid}i0`);
  const result = (await state()).results.find((x) => x.height === h)!;
  const ours = result.claims.find((c) => c.txid === v.sent.at(-1)!.txid)!;
  assert.equal(result.pool, 'MARA Pool');
  assert.equal(ours.owner, ordinals);
  assert.ok(ours.ghost, 'a claim that came out of a private pool marks its owner as a ghost');
  console.log(`  WON ${h}.bitmap in a MARA block after ${v.sent.length} claims; only the last one paid: ${v.sent.at(-1)!.fee} sats`);
}

console.log('run 2: stopped, the refund wins on a normal block');
{
  const r = await startRun(3.2, 1, 6);
  await block('normal');
  await sent(r.view, 1);
  await post('/api/ghost/stop', { player, id: r.id });
  await until('the refund to go out', async () => (await r.view()).refund);
  await block('normal');
  const v = await until('the refund to confirm', async () => ((await r.view()).state === 'refunded' ? r.view() : null));
  console.log(`  refunded after ${v.sent.length} claim: ${v.refund!.txid.slice(0, 10)}…`);
}

console.log('run 3: forwarded to later tries, then a MARA block');
{
  const r = await startRun(3.2, 1, 8);
  await block('normal');
  let v = await sent(r.view, 1);
  const n = v.sent[0].n;
  assert.equal(n, r.plan.first);
  await r.forward(n, 4);
  v = await sent(r.view, 2);
  assert.equal(v.skip, 3);
  assert.equal(v.sent[1].n, n, 'a forward replaces the claim for the same number');
  assert.ok(Math.abs(v.sent[1].rate - ghostRate(3.2, 3, 0)) < 0.02, `try 4 pays ${v.sent[1].rate}`);
  console.log(`  try 1 → 4 on ${n}: ${v.sent[0].rate} → ${v.sent[1].rate} sat/vB`);
  await assert.rejects(r.forward(n, 3), /only goes forward/);
  await assert.rejects(r.forward(n, 6, `${player}-x`), /no such ghost run/);
  await block('normal');
  v = await sent(r.view, 3);
  assert.equal(v.sent[2].n, n + 1);
  assert.ok(Math.abs(v.sent[2].rate - ghostRate(3.2, 4, 0)) < 0.02, `try 5 pays ${v.sent[2].rate}`);
  console.log(`  the next block is try 5: ${v.sent[2].rate} sat/vB`);
  await r.forward(n + 1, 8);
  v = await until('the last try and the refund', async () => {
    const x = await r.view();
    return x.sent.length >= 4 && x.refund ? x : null;
  });
  assert.ok(Math.abs(v.sent[3].rate - ghostRate(3.2, 7, 0)) < 0.02, `try 8 pays ${v.sent[3].rate}`);
  console.log(`  try 5 → 8, the last: ${v.sent[3].rate} sat/vB, and the refund races it`);
  await block('mara');
  v = await until('the win', async () => ((await r.view()).state === 'won' ? r.view() : null));
  assert.equal(v.winner, `${v.sent.at(-1)!.txid}i0`);
  console.log(`  WON ${n + 1}.bitmap at the rate of try 8, ${r.plan.count - 2} blocks before the run would have ended`);
}

console.log('run 4: forwarded to the last try, a normal block takes the refund');
{
  const r = await startRun(3.2, 0, 6);
  await block('normal');
  const n = (await sent(r.view, 1)).sent[0].n;
  await r.forward(n, 6);
  await until('the refund to go out', async () => (await r.view()).refund);
  await block('normal');
  const v = await until('the refund to confirm', async () => ((await r.view()).state === 'refunded' ? r.view() : null));
  console.log(`  refunded after try 6 of 6, at the first number: ${v.sent.length} claims sent`);
}

// The rival funds each claim a block ahead, so it is on before the run starts; the run's first claim pays its start
// rate: 3.00 loses to the rival's 3.10, 3.20 beats it.
for (const [start, expect] of [
  [3.0, 'lost'],
  [3.2, 'won'],
] as const) {
  console.log(`run from ${start} against the private rival at 3.10: ${expect}`);
  await post('/dev/private', { rival: true });
  await sleep(2500);
  await block('normal');
  await sleep(2500);
  const r = await startRun(start, 0, 4);
  await block('normal');
  const target = (await sent(r.view, 1)).sent[0].n;
  await until('the rival claim', async () => ((await get<{ private: { rival: { claimed: number } } }>('/dev/status')).private.rival.claimed === target ? true : null));
  await post('/dev/private', { rival: false });
  await block('mara');
  const v = await until('the outcome', async () => {
    const x = await r.view();
    return x.state === 'won' || x.state === 'lost' ? x : null;
  });
  assert.equal(v.state, expect, v.note);
  console.log(`  ${v.state} at ${v.sent.at(-1)!.rate} sat/vB${v.note ? `: ${v.note}` : ''}`);
}

console.log('\nall ghost runs behaved');

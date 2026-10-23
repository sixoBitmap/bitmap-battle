// End-to-end ghost runs on the regtest server (npm run regtest first), against its stand-in for a private pool: a run
// that climbs block after block and wins in a MARA block, a run stopped with its refund, and runs against a private
// rival that pays 3.10 sat/vB every block.
// Usage: npx tsx scripts/e2e-ghost.ts [http://127.0.0.1:8788]
import assert from 'node:assert/strict';
import { commitTree, fromHex, type GhostPlan, ghostBundle, ghostDeposit, newSecret, toHex } from '@bitmap-battle/core';

const base = process.argv[2] ?? 'http://127.0.0.1:8788';
const player = `e2e-ghost-${Date.now().toString(36)}-0123456789`;

type Run = { state: string; stopped: boolean; sent: { n: number; rate: number; fee: number; txid: string }[]; refund: { txid: string } | null; note: string; winner: string | null };
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
  const bundle = ghostBundle({ ...plan, secret, network: 'regtest', coin: { txid, vout: out.n, amount: out.value }, ordinals, payment, refundRates: [1, 2, 4, 8, 16] });
  const id = `run-${Date.now().toString(36)}`;
  await post('/api/ghost/start', { player, id, bundle });
  const view = () => get<Run>(`/api/ghost/run/${id}?player=${player}`);
  return { id, plan, view, claims: bundle.claims.length };
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

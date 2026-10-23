import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schnorr } from '@noble/curves/secp256k1.js';
import { SigHash, Transaction } from '@scure/btc-signer';
import {
  buildRefund,
  buildReveal,
  checkGhostBundle,
  claimsInTx,
  commitFor,
  commitTree,
  fromHex,
  GHOST_RUNG,
  ghostBundle,
  ghostDeposit,
  ghostDepths,
  ghostRungs,
  parseTx,
  replacementFee,
} from '../src/index.ts';

const secret = fromHex('01'.repeat(32));
const payment = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const ordinals = commitFor(fromHex('02'.repeat(32)), 1, 'regtest').address;
const stranger = commitFor(fromHex('03'.repeat(32)), 1, 'regtest').address;
const plan = { first: 1000, count: 24, start: 5, extra: 3 };

test('ghost trees are complete, the first numbers shallowest', () => {
  for (let k = 1; k <= 64; k++) {
    const d = ghostDepths(k);
    assert.equal(d.length, k);
    assert.equal(
      d.reduce((s, x) => s + 2 ** -x, 0),
      1,
    );
    assert.equal(Math.max(...d), Math.ceil(Math.log2(k)));
    for (let i = 1; i < k; i++) assert.ok(d[i] >= d[i - 1]);
  }
  assert.throws(() => ghostDepths(0));
  assert.throws(() => ghostDepths(65));
});

test('a ghost deposit address never changes', () => {
  assert.equal(commitTree(secret, 1000, 24, 'regtest').address, 'bcrt1ptgf5rpc4y7zyfg4csgpw70fs369pw88f6t0mpdsrsrkpcptwwskq5vscdu');
  assert.equal(commitTree(secret, 972_820, 24, 'mainnet').address, 'bc1p6edjl64hqslvv7p86zqcxy9awuwhnlp60t6umtdy95juhemwmnmq8d9ta5');
  assert.notEqual(commitTree(secret, 1000, 24, 'regtest').address, commitFor(secret, 1000, 'regtest').address);
});

test('every leaf claims its own number, signed for that leaf, not mineable before its block', () => {
  const tree = commitTree(secret, plan.first, plan.count, 'regtest');
  const depths = ghostDepths(plan.count);
  const coin = { txid: 'aa'.repeat(32), vout: 1, amount: 20_000 };
  const single = buildReveal({ secret, n: 1000, coin, postageAddress: ordinals, changeAddress: payment, network: 'regtest' }, 0, false).vsize;
  for (let i = 0; i < plan.count; i++) {
    const n = plan.first + i;
    const leaf = tree.leaf(n);
    assert.equal(leaf.controlBlock.length, 33 + 32 * depths[i]);
    const built = buildReveal({ secret, n, coin, postageAddress: ordinals, changeAddress: payment, network: 'regtest', commit: leaf }, 1500);
    const tx = parseTx(fromHex(built.hex));
    assert.equal(tx.locktime, n - 1);
    assert.deepEqual(
      claimsInTx(tx).map((c) => c.n),
      [n],
    );
    assert.ok(Math.abs(built.vsize - (single + 8 * depths[i])) <= 1);
    const signed = Transaction.fromRaw(fromHex(built.hex), { allowUnknownOutputs: true });
    const msg = signed.preimageWitnessV1(0, [tree.script], SigHash.DEFAULT, [BigInt(coin.amount)], undefined, leaf.leaf, 0xc0);
    assert.ok(schnorr.verify(tx.witnesses[0][0], msg, tree.internalKey));
  }
  assert.throws(() => tree.leaf(plan.first + plan.count));
  const refund = buildRefund({ secret, n: plan.first, coin, toAddress: payment, network: 'regtest', commit: tree }, 200);
  assert.equal(parseTx(fromHex(refund.hex)).witnesses[0].length, 1);
});

test('the fee ladder covers every number and each next claim can replace the last', () => {
  const amount = ghostDeposit(plan, 'regtest', ordinals, payment);
  const coin = { txid: 'bb'.repeat(32), vout: 0, amount };
  const b = ghostBundle({ ...plan, secret, network: 'regtest', coin, ordinals, payment, refundRates: [1, 2, 4] });
  const rungs = ghostRungs(plan.extra);
  assert.equal(rungs, plan.extra / GHOST_RUNG + 1);
  assert.equal(b.claims.length, plan.count * rungs);
  assert.equal(b.refunds.length, 3);
  for (let r = 0; r < rungs; r++) {
    const line = b.claims.filter((c) => c.rung === r);
    for (let i = 1; i < line.length; i++) {
      assert.ok(line[i].fee >= replacementFee(line[i - 1], line[i].vsize, 0.1), `rung ${r}, number ${line[i].n}`);
      assert.ok(line[i].rate >= line[i - 1].rate);
    }
  }
  const atFirst = b.claims.filter((c) => c.n === plan.first);
  assert.ok(atFirst[0].rate >= plan.start && atFirst[0].rate < plan.start + 0.05);
  for (let r = 1; r < atFirst.length; r++) assert.ok(atFirst[r].fee > atFirst[r - 1].fee);
  assert.equal(replacementFee(null, 200, 0.1), 0);
  assert.equal(replacementFee({ fee: 1000, vsize: 200 }, 208, 0.1), 1040 + 21 + 1);
});

test('a server only takes bundles that pay the player and claim the right numbers', () => {
  const coin = { txid: 'cc'.repeat(32), vout: 2, amount: ghostDeposit(plan, 'regtest', ordinals, payment) };
  const make = (o = ordinals, p = payment) => ghostBundle({ ...plan, secret, network: 'regtest', coin, ordinals: o, payment: p, refundRates: [1, 2] });
  const good = make();
  assert.equal(checkGhostBundle(good, 'regtest'), null);
  const robbed = { ...good, claims: [make(stranger).claims[0], ...good.claims.slice(1)] };
  assert.match(checkGhostBundle(robbed, 'regtest')!, /does not send the bitmap/);
  const renamed = { ...good, claims: good.claims.map((c, i) => (i === good.claims.length - 1 ? { ...c, n: plan.first } : c)) };
  assert.match(checkGhostBundle(renamed, 'regtest')!, /before its block|something else/);
  const drained = { ...good, refunds: [make(ordinals, stranger).refunds[0]] };
  assert.match(checkGhostBundle(drained, 'regtest')!, /pays someone else/);
  const elsewhere = { ...good, coin: { ...coin, vout: 3 } };
  assert.match(checkGhostBundle(elsewhere, 'regtest')!, /spends something else/);
});

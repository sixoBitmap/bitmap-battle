import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { base64 } from '@scure/base';
import { p2sh, p2wpkh, Transaction } from '@scure/btc-signer';
import { btcNetwork, commitFor, depositPsbt, finishPsbt, fromHex, toHex } from '../src/index.ts';

const key = fromHex('11'.repeat(32));
const pub = secp256k1.getPublicKey(key, true);
const net = btcNetwork('regtest');
const to = commitFor(fromHex('02'.repeat(32)), 1, 'regtest').address;
const coins = [
  { txid: 'aa'.repeat(32), vout: 0, value: 4_000 },
  { txid: 'bb'.repeat(32), vout: 1, value: 20_000 },
  { txid: 'cc'.repeat(32), vout: 2, value: 600 },
];

// Signs a planned deposit the way the wallet would, and returns the finished transaction.
function signed(psbt: string) {
  const tx = Transaction.fromPSBT(base64.decode(psbt));
  tx.sign(key);
  tx.finalize();
  return tx;
}

for (const [name, address] of [
  ['Native SegWit', p2wpkh(pub, net).address!],
  ['Nested SegWit', p2sh(p2wpkh(pub, net), net).address!],
] as const) {
  test(`a deposit at the chosen rate from ${name}`, () => {
    for (const rate of [1, 2.5]) {
      const plan = depositPsbt({ coins, to, amount: 3_571, payer: { address, publicKey: toHex(pub) }, rate, network: 'regtest' });
      const tx = signed(plan.psbt);
      assert.equal(plan.inputs, 1, 'the largest coin alone covers it');
      assert.equal(tx.inputsLength, 1);
      assert.equal(tx.getOutput(0).amount, 3_571n);
      assert.equal(Number(tx.getOutput(1).amount), plan.change);
      assert.equal(20_000 - 3_571 - plan.change, plan.fee);
      assert.ok(tx.vsize <= plan.vsize, `estimated ${plan.vsize} vB, signed ${tx.vsize} vB`);
      assert.ok(plan.fee / tx.vsize >= rate, `paid ${(plan.fee / tx.vsize).toFixed(2)} sat/vB for ${rate}`);
      assert.ok(plan.fee / tx.vsize < rate + 0.1, `no more than a hair above ${rate}`);
    }
  });
}

test('a deposit uses more coins when one is not enough, and refuses when all are not', () => {
  const address = p2wpkh(pub, net).address!;
  const plan = depositPsbt({ coins, to, amount: 22_000, payer: { address, publicKey: toHex(pub) }, rate: 1, network: 'regtest' });
  assert.equal(plan.inputs, 2);
  assert.equal(signed(plan.psbt).inputsLength, 2);
  assert.throws(() => depositPsbt({ coins, to, amount: 25_000, payer: { address, publicKey: toHex(pub) }, rate: 1, network: 'regtest' }), /Not enough/);
});

test('a wallet-signed deposit that was not broadcast can be finished here', () => {
  const address = p2wpkh(pub, net).address!;
  const plan = depositPsbt({ coins, to, amount: 3_571, payer: { address, publicKey: toHex(pub) }, rate: 1, network: 'regtest' });
  const tx = Transaction.fromPSBT(base64.decode(plan.psbt));
  tx.sign(key);
  const done = finishPsbt(base64.encode(tx.toPSBT()));
  assert.equal(done.txid, signed(plan.psbt).id);
});

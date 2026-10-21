import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Transaction } from '@scure/btc-signer';
import {
  bitmapScript,
  buildRefund,
  buildReveal,
  chunkRate,
  claimNumber,
  claimsInTx,
  commitFor,
  dustLimit,
  envelopes,
  feeForRate,
  fromHex,
  LEGACY_CONTENT_TYPE,
  outputScript,
  parseTx,
  utf8,
  type Envelope,
} from '../src/index.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as {
  height: number;
  claims: { txid: string; hex: string }[];
};

const secret = fromHex('0101010101010101010101010101010101010101010101010101010101010101');
const coin = { txid: 'aa'.repeat(32), vout: 1, amount: 20_000 };
const payment = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const ordinals = commitFor(fromHex('02'.repeat(32)), 1, 'regtest').address;

function envelope(contentType: string | null, body: string, extra: [number, Uint8Array][] = []): Envelope {
  const tags = new Map<number, Uint8Array[]>();
  if (contentType !== null) tags.set(1, [utf8(contentType)]);
  for (const [tag, value] of extra) tags.set(tag, [value]);
  return { tags, body: utf8(body), pushnum: false, incomplete: false, duplicate: false, unknownEven: false };
}

test('real mainnet claims are found with their number and key', () => {
  const [winner, bot] = fixtures.claims.map((c) => parseTx(fromHex(c.hex)));
  assert.equal(winner.txid(), fixtures.claims[0].txid);
  const claims = claimsInTx(winner);
  assert.deepEqual([claims[0].n, claims[0].index, claims[0].key?.slice(0, 8)], [fixtures.height, 0, '9fbd8412']);
  assert.deepEqual(
    claims.map((c) => c.n),
    claims.map((_, i) => fixtures.height + i),
  );
  assert.equal(bot.txid(), fixtures.claims[1].txid);
  assert.deepEqual(
    claimsInTx(bot).map((c) => [c.n, c.key?.slice(0, 8)]),
    [[fixtures.height, '7dd6a85f']],
  );
});

test('claim rules follow bitmap_index.py', () => {
  assert.equal(claimNumber(envelope('text/plain;charset=utf-8', '840000.bitmap')), 840000);
  assert.equal(claimNumber(envelope('TEXT/PLAIN', '0.bitmap')), 0);
  assert.equal(claimNumber(envelope('text/plain', '99999999.bitmap')), 99999999);
  assert.equal(claimNumber(envelope('text/plain', '01.bitmap')), null);
  assert.equal(claimNumber(envelope('text/plain', ' 1.bitmap')), null);
  assert.equal(claimNumber(envelope('text/plain', '1.bitmap\n')), null);
  assert.equal(claimNumber(envelope('text/plain', '1.Bitmap')), null);
  assert.equal(claimNumber(envelope('text/plain', '100000000.bitmap')), null);
  assert.equal(claimNumber(envelope('text/html', '1.bitmap')), null);
  assert.equal(claimNumber(envelope(null, '1.bitmap')), null);
  assert.equal(claimNumber(envelope('text/plain', '1.bitmap', [[9, utf8('br')]])), null);
});

test('the claim script is a standard envelope', () => {
  const script = bitmapScript(new Uint8Array(32).fill(7), 972518);
  const [env] = envelopes(script);
  assert.equal(new TextDecoder().decode(env.body), '972518.bitmap');
  assert.equal(new TextDecoder().decode(env.tags.get(1)![0]), 'text/plain');
  assert.equal(env.pushnum || env.incomplete || env.duplicate || env.unknownEven, false);
  assert.equal(claimNumber(env), 972518);
});

test('a reveal claims its bitmap, pays postage first and keeps locktime n-1', () => {
  const built = buildReveal({ secret, n: 500, coin, postageAddress: ordinals, changeAddress: payment, network: 'regtest' }, 400);
  const tx = Transaction.fromRaw(fromHex(built.hex), { allowUnknownOutputs: true });
  assert.equal(tx.id, built.txid);
  assert.equal(tx.lockTime, 499);
  assert.equal(tx.getInput(0).sequence, 0xfffffffd);
  assert.equal(tx.getOutput(0).amount, 546n);
  assert.equal(tx.getOutput(1).amount, BigInt(20_000 - 546 - 400));
  assert.equal(built.fee, 400);
  const parsed = parseTx(fromHex(built.hex));
  assert.equal(parsed.txid(), built.txid);
  assert.equal(Math.ceil(parsed.weight / 4), built.vsize);
  assert.deepEqual(claimsInTx(parsed).map((c) => [c.n, c.index, c.vin]), [[500, 0, 0]]);
  const unsigned = buildReveal({ secret, n: 500, coin, postageAddress: ordinals, changeAddress: payment, network: 'regtest' }, 400, false);
  assert.equal(unsigned.vsize, built.vsize);
});

test('a reveal drops change below dust and pays it as fee', () => {
  const small = { ...coin, amount: 546 + 400 + 200 };
  const built = buildReveal({ secret, n: 500, coin: small, postageAddress: ordinals, changeAddress: payment, network: 'regtest' }, 400);
  assert.equal(built.change, 0);
  assert.equal(built.fee, 600);
  assert.throws(() => buildReveal({ secret, n: 500, coin: small, postageAddress: ordinals, changeAddress: payment, network: 'regtest' }, 700));
});

test('a refund spends the commit by the key path', () => {
  const built = buildRefund({ secret, n: 500, coin, toAddress: payment, network: 'regtest' }, 300);
  const tx = Transaction.fromRaw(fromHex(built.hex), { allowUnknownOutputs: true });
  assert.equal(tx.getInput(0).finalScriptWitness?.length, 1);
  assert.equal(tx.getOutput(0).amount, BigInt(20_000 - 300));
  assert.equal(claimsInTx(parseTx(fromHex(built.hex))).length, 0);
  assert.equal(buildRefund({ secret, n: 500, coin, toAddress: payment, network: 'regtest' }, 300, false).vsize, built.vsize);
});

test('commit addresses depend on key, number and network', () => {
  const a = commitFor(secret, 500, 'regtest');
  assert.match(a.address, /^bcrt1p/);
  assert.notEqual(commitFor(secret, 501, 'regtest').address, a.address);
  assert.match(commitFor(secret, 500, 'mainnet').address, /^bc1p/);
  assert.deepEqual(outputScript(a.address, 'regtest'), a.script);
});

test('deposits made with the old content type stay spendable', () => {
  const legacy = commitFor(secret, 500, 'regtest', LEGACY_CONTENT_TYPE);
  assert.notEqual(legacy.address, commitFor(secret, 500, 'regtest').address);
  const reveal = buildReveal({ secret, n: 500, coin, postageAddress: ordinals, changeAddress: payment, network: 'regtest', contentType: LEGACY_CONTENT_TYPE }, 400);
  const [env] = envelopes(parseTx(fromHex(reveal.hex)).witnesses[0][1]);
  assert.equal(new TextDecoder().decode(env.tags.get(1)![0]), LEGACY_CONTENT_TYPE);
  assert.equal(claimNumber(env), 500);
  const shorter = buildReveal({ secret, n: 500, coin, postageAddress: ordinals, changeAddress: payment, network: 'regtest' }, 400);
  assert.equal(parseTx(fromHex(reveal.hex)).weight - parseTx(fromHex(shorter.hex)).weight, 14);
});

test('dust limits match Bitcoin Core', () => {
  assert.equal(dustLimit(outputScript(payment, 'regtest')), 294);
  assert.equal(dustLimit(outputScript(ordinals, 'regtest')), 330);
  assert.equal(dustLimit(outputScript('3P14159f73E4gFr7JterCCQh9QjiTjiZrG', 'mainnet')), 540);
  assert.equal(dustLimit(outputScript('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'mainnet')), 546);
});

test('chunk rate counts a low-paying parent', () => {
  assert.equal(chunkRate([], 'r', 300, 150), 2);
  const parent = { txid: 'c', fee: 150, vsize: 150 };
  assert.equal(chunkRate([parent], 'r', 450, 150), 2);
  assert.equal(chunkRate([parent], 'r', 100, 150), 100 / 150);
  assert.equal(chunkRate([parent, { txid: 'r', fee: 450, vsize: 150 }], 'r', 750, 150), 3);
});

test('fee search finds the lowest fee reaching a rate', () => {
  const rate = (fee: number) => chunkRate([{ txid: 'c', fee: 150, vsize: 150 }], 'r', fee, 150);
  assert.equal(feeForRate(2, 15, 10_000, rate), 450);
  assert.equal(feeForRate(2, 600, 10_000, rate), 600);
  assert.equal(feeForRate(80, 15, 10_000, rate), null);
});

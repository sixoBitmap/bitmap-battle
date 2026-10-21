import { schnorr } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { Address, NETWORK, OutScript, p2tr, SigHash, TaprootControlBlock, TEST_NETWORK, Transaction } from '@scure/btc-signer';
import { concatBytes, utf8 } from './bytes.ts';

export type Network = 'mainnet' | 'testnet' | 'testnet4' | 'signet' | 'regtest';

export const CONTENT_TYPE = 'text/plain';
// Claims made before the shorter content type: their deposit addresses commit to it, so they keep it.
export const LEGACY_CONTENT_TYPE = 'text/plain;charset=utf-8';
export const POSTAGE = 546;
export const RBF_SEQUENCE = 0xfffffffd;
const LEAF_VERSION = 0xc0;

export function btcNetwork(network: Network) {
  if (network === 'mainnet') return NETWORK;
  if (network === 'regtest') return { ...TEST_NETWORK, bech32: 'bcrt' };
  return TEST_NETWORK;
}

export function newSecret(): Uint8Array {
  return schnorr.utils.randomSecretKey();
}

export function bitmapScript(pubkey: Uint8Array, n: number, type = CONTENT_TYPE): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0 || n > 99_999_999) throw new Error(`not a bitmap number: ${n}`);
  if (pubkey.length !== 32) throw new Error('x-only public key expected');
  const body = utf8(`${n}.bitmap`);
  const contentType = utf8(type);
  return concatBytes(
    Uint8Array.of(0x20),
    pubkey,
    Uint8Array.of(0xac, 0x00, 0x63, 0x03),
    utf8('ord'),
    Uint8Array.of(0x01, 0x01, contentType.length),
    contentType,
    Uint8Array.of(0x00, body.length),
    body,
    Uint8Array.of(0x68),
  );
}

export type Commit = {
  address: string;
  script: Uint8Array;
  leaf: Uint8Array;
  controlBlock: Uint8Array;
  internalKey: Uint8Array;
  merkleRoot: Uint8Array;
};

export function commitFor(secret: Uint8Array, n: number, network: Network, type = CONTENT_TYPE): Commit {
  const internalKey = schnorr.getPublicKey(secret);
  const leaf = bitmapScript(internalKey, n, type);
  const payment = p2tr(internalKey, { script: leaf }, btcNetwork(network), true);
  const [controlBlock] = payment.tapLeafScript![0];
  return {
    address: payment.address,
    script: payment.script,
    leaf,
    controlBlock: TaprootControlBlock.encode(controlBlock),
    internalKey,
    merkleRoot: payment.tapMerkleRoot,
  };
}

export function outputScript(address: string, network: Network): Uint8Array {
  return OutScript.encode(Address(btcNetwork(network)).decode(address));
}

// Bitcoin Core's dust threshold at its default dust relay fee of 3 sat/vB.
export function dustLimit(script: Uint8Array): number {
  const outputSize = 8 + 1 + script.length;
  const witness = (script[0] === 0x00 || (script[0] >= 0x51 && script[0] <= 0x60)) && script.length >= 4 && script.length <= 42;
  return (outputSize + (witness ? 67 : 148)) * 3;
}

export type Coin = { txid: string; vout: number; amount: number };

export type Built = { hex: string; txid: string; vsize: number; fee: number; change: number };

export type RevealParams = {
  secret: Uint8Array;
  n: number;
  coin: Coin;
  postageAddress: string;
  changeAddress: string;
  network: Network;
  postage?: number;
  contentType?: string;
};

function finish(tx: Transaction, coin: Coin, change: number): Built {
  let out = 0n;
  for (let i = 0; i < tx.outputsLength; i++) out += tx.getOutput(i).amount ?? 0n;
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize, fee: coin.amount - Number(out), change };
}

// The claim of n.bitmap: the inscription on the first sat of output 0 (postage to the ordinals address), the rest
// back to the payment address. Locktime n-1 keeps it out of any block before n, where the claim would not count.
export function buildReveal(p: RevealParams, fee: number, sign = true): Built {
  const network = btcNetwork(p.network);
  const commit = commitFor(p.secret, p.n, p.network, p.contentType);
  const postage = p.postage ?? POSTAGE;
  const tx = new Transaction({ version: 2, lockTime: Math.max(0, p.n - 1), allowUnknownOutputs: true });
  tx.addInput({
    txid: p.coin.txid,
    index: p.coin.vout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: { script: commit.script, amount: BigInt(p.coin.amount) },
  });
  tx.addOutputAddress(p.postageAddress, BigInt(postage), network);
  const changeScript = outputScript(p.changeAddress, p.network);
  let change = p.coin.amount - postage - fee;
  if (change < 0) throw new Error('the budget cannot pay this fee');
  if (change >= dustLimit(changeScript)) tx.addOutput({ script: changeScript, amount: BigInt(change) });
  else change = 0;
  const signature = sign
    ? schnorr.sign(
        tx.preimageWitnessV1(0, [commit.script], SigHash.DEFAULT, [BigInt(p.coin.amount)], undefined, commit.leaf, LEAF_VERSION),
        p.secret,
        randomBytes(32),
      )
    : new Uint8Array(64);
  tx.updateInput(0, { finalScriptWitness: [signature, commit.leaf, commit.controlBlock] }, true);
  return finish(tx, p.coin, change);
}

export type RefundParams = { secret: Uint8Array; n: number; coin: Coin; toAddress: string; network: Network; contentType?: string };

// Takes the whole coin back by the key path: nothing is inscribed.
export function buildRefund(p: RefundParams, fee: number, sign = true): Built {
  const commit = commitFor(p.secret, p.n, p.network, p.contentType);
  const tx = new Transaction({ version: 2, lockTime: 0 });
  tx.addInput({
    txid: p.coin.txid,
    index: p.coin.vout,
    sequence: RBF_SEQUENCE,
    witnessUtxo: { script: commit.script, amount: BigInt(p.coin.amount) },
    tapInternalKey: commit.internalKey,
    tapMerkleRoot: commit.merkleRoot,
  });
  const toScript = outputScript(p.toAddress, p.network);
  const amount = p.coin.amount - fee;
  if (amount < dustLimit(toScript)) throw new Error('too little left to take back after the fee');
  tx.addOutput({ script: toScript, amount: BigInt(amount) });
  if (sign) {
    tx.signIdx(p.secret, 0, undefined, randomBytes(32));
    tx.finalizeIdx(0);
  } else {
    tx.updateInput(0, { finalScriptWitness: [new Uint8Array(64)] }, true);
  }
  return finish(tx, p.coin, amount);
}

export type ClusterTx = { txid: string; fee: number; vsize: number };

// The rate miners rank a transaction at: its chunk's fee rate, the cluster cut into chunks in the node's order
// (as bitmap explorer's claims.py does). A transaction not yet in the cluster is added as its last member.
export function chunkRate(cluster: ClusterTx[], slot: string, fee: number, vsize: number): number {
  const list = cluster.some((t) => t.txid === slot) ? cluster : [...cluster, { txid: slot, fee, vsize }];
  const chunks: { fee: number; vsize: number; has: boolean }[] = [];
  for (const t of list) {
    const has = t.txid === slot;
    chunks.push({ fee: has ? fee : t.fee, vsize: has ? vsize : t.vsize, has });
    while (chunks.length > 1) {
      const last = chunks[chunks.length - 1];
      const prev = chunks[chunks.length - 2];
      if (last.fee * prev.vsize <= prev.fee * last.vsize) break;
      chunks.pop();
      prev.fee += last.fee;
      prev.vsize += last.vsize;
      prev.has ||= last.has;
    }
  }
  const mine = chunks.find((c) => c.has)!;
  return mine.fee / mine.vsize;
}

// The lowest fee in [least, most] whose rank reaches target, or null when even most falls short.
export function feeForRate(target: number, least: number, most: number, rateAt: (fee: number) => number): number | null {
  if (least > most || rateAt(most) < target) return null;
  if (rateAt(least) >= target) return least;
  let lo = least;
  let hi = most;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (rateAt(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

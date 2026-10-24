import { schnorr } from '@noble/curves/secp256k1.js';
import { p2tr, TaprootControlBlock } from '@scure/btc-signer';
import { claimsInTx } from './bitmap.ts';
import { equal, fromHex, toHex } from './bytes.ts';
import {
  bitmapScript,
  btcNetwork,
  buildRefund,
  buildReveal,
  type Coin,
  CONTENT_TYPE,
  dustLimit,
  type LeafCommit,
  type Network,
  outputScript,
  POSTAGE,
  type RevealParams,
} from './claim.ts';
import { parseTx } from './rawtx.ts';

// A ghost run chases the newest bitmap block after block from one deposit. The deposit's Taproot tree holds one claim
// leaf per number; each block the claim for the next number replaces the last one in a private mempool, so only the
// claim that finally gets mined pays a fee.

export const GHOST_MAX_LEAVES = 64;
// Each next number's claim pays this much more (sat/vB): a replacement must beat the claim it replaces by the
// incremental relay fee (0.1) for its own size, and never at a lower rate.
export const GHOST_CLIMB = 0.12;
// The steps a run may climb above that base when the private floor or a public claim asks for more (sat/vB).
export const GHOST_RUNG = 0.5;

const round2 = (x: number) => Math.round(x * 100) / 100;

// Leaf depths of a complete tree, the first (likeliest) numbers shallowest: each level costs 8 vB on a claim.
export function ghostDepths(count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > GHOST_MAX_LEAVES) throw new Error(`a ghost run chases 1 to ${GHOST_MAX_LEAVES} numbers`);
  if (count === 1) return [0];
  const d = Math.ceil(Math.log2(count));
  const shallow = 2 ** d - count;
  return Array.from({ length: count }, (_, i) => (i < shallow ? d - 1 : d));
}

type Node = { script: Uint8Array } | Node[];

// The tree as explicit pairs rather than the library's weight sort, so the deposit address of a run never changes.
function tree(leaves: Uint8Array[]): Node {
  if (leaves.length === 1) return { script: leaves[0] };
  const d = Math.ceil(Math.log2(leaves.length));
  const shallow = 2 ** d - leaves.length;
  let level: Node[] = [];
  let i = 0;
  for (let slot = 0; slot < 2 ** (d - 1); slot++) {
    if (slot < shallow) {
      level.push({ script: leaves[i++] });
    } else {
      level.push([{ script: leaves[i] }, { script: leaves[i + 1] }]);
      i += 2;
    }
  }
  while (level.length > 1) {
    const next: Node[] = [];
    for (let k = 0; k < level.length; k += 2) next.push([level[k], level[k + 1]]);
    level = next;
  }
  return level[0];
}

export type GhostCommit = {
  address: string;
  script: Uint8Array;
  internalKey: Uint8Array;
  merkleRoot: Uint8Array;
  first: number;
  count: number;
  leaf(n: number): LeafCommit;
};

export function commitTree(secret: Uint8Array, first: number, count: number, network: Network, type = CONTENT_TYPE): GhostCommit {
  ghostDepths(count);
  const internalKey = schnorr.getPublicKey(secret);
  const leaves = Array.from({ length: count }, (_, i) => bitmapScript(internalKey, first + i, type));
  const payment = p2tr(internalKey, tree(leaves) as Parameters<typeof p2tr>[1], btcNetwork(network), true);
  const blocks = new Map<string, Uint8Array>();
  for (const [cb, s] of payment.tapLeafScript!) blocks.set(toHex(s.subarray(0, -1)), TaprootControlBlock.encode(cb));
  return {
    address: payment.address!,
    script: payment.script,
    internalKey,
    merkleRoot: payment.tapMerkleRoot,
    first,
    count,
    leaf(n) {
      const i = n - first;
      if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`${n} is not one of this run's numbers`);
      return { script: payment.script, leaf: leaves[i], controlBlock: blocks.get(toHex(leaves[i]))! };
    },
  };
}

// The rate of a claim: the run's start, the climb for the i-th number, and the rung above it.
export const ghostRate = (start: number, i: number, rung: number) => round2(start + i * GHOST_CLIMB + rung * GHOST_RUNG);

export const ghostRungs = (extra: number) => Math.max(1, Math.floor(extra / GHOST_RUNG + 1e-9) + 1);

// The i-th number of a run is its try i+1, and pays that try's rate. A player can forward the run to a later try:
// every number from then on pays the rate of a try that many further on, and the run ends that many blocks sooner.
export const ghostTry = (b: GhostPlan & { skip?: number }, n: number) => n - b.first + 1 + (b.skip ?? 0);

export const ghostLast = (b: GhostPlan & { skip?: number }) => b.first + b.count - 1 - (b.skip ?? 0);

// The least a transaction must pay to replace `prev` in a mempool: the incremental relay fee for its own size on
// top, at no lower fee rate.
export function replacementFee(prev: { fee: number; vsize: number } | null, vsize: number, incremental: number): number {
  if (!prev) return 0;
  const keepRate = Math.ceil((prev.fee * vsize) / prev.vsize);
  return Math.max(prev.fee, keepRate) + Math.ceil(incremental * vsize) + 1;
}

export type GhostClaim = { n: number; rung: number; rate: number; fee: number; vsize: number; txid: string; hex: string };
export type GhostRefund = { rate: number; fee: number; vsize: number; txid: string; hex: string };

export type GhostPlan = { first: number; count: number; start: number; extra: number };

export type GhostBundle = GhostPlan & {
  // Tries forwarded so far (none when absent).
  skip?: number;
  coin: Coin;
  ordinals: string;
  payment: string;
  claims: GhostClaim[];
  refunds: GhostRefund[];
};

const SIZER = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

// The deposit a run needs: postage plus its dearest claim (last number, top rung, deepest leaf), plus a little so
// the change of most claims stays above dust.
export function ghostDeposit(plan: GhostPlan, network: Network, ordinals: string, payment: string): number {
  const commit = commitTree(SIZER, plan.first, plan.count, network);
  const last = plan.first + plan.count - 1;
  const coin = { txid: '00'.repeat(32), vout: 0, amount: 10_000_000 };
  const vsize = buildReveal({ secret: SIZER, n: last, coin, postageAddress: ordinals, changeAddress: payment, network, commit: commit.leaf(last) }, 0, false).vsize;
  const top = ghostRate(plan.start, plan.count - 1, ghostRungs(plan.extra) - 1);
  return POSTAGE + Math.ceil(top * vsize) + dustLimit(outputScript(payment, network));
}

// What a run costs, to the sat, for these addresses. A win pays the fee of one claim: `first` if the first number
// wins, `last` if the last one does, `most` when every rise was used; no win pays one refund of `refundSize` vB.
export type GhostCosts = { deposit: number; first: number; last: number; most: number; refundSize: number };

export function ghostCosts(plan: GhostPlan, network: Network, ordinals: string, payment: string): GhostCosts {
  const commit = commitTree(SIZER, plan.first, plan.count, network);
  const coin = { txid: '00'.repeat(32), vout: 0, amount: 10_000_000 };
  const size = (n: number) =>
    buildReveal({ secret: SIZER, n, coin, postageAddress: ordinals, changeAddress: payment, network, commit: commit.leaf(n) }, 0, false).vsize;
  const last = plan.first + plan.count - 1;
  return {
    deposit: ghostDeposit(plan, network, ordinals, payment),
    first: Math.ceil(ghostRate(plan.start, 0, 0) * size(plan.first)),
    last: Math.ceil(ghostRate(plan.start, plan.count - 1, 0) * size(last)),
    most: Math.ceil(ghostRate(plan.start, plan.count - 1, ghostRungs(plan.extra) - 1) * size(last)),
    refundSize: buildRefund({ secret: SIZER, n: plan.first, coin, toAddress: payment, network, commit }, 0, false).vsize,
  };
}

// Every claim and refund of a run, signed once with the run's key: the browser hands these to the server, which
// sends the right one each block and can neither change them nor pay anyone else. A forward signs the claims again
// from the number `from` on, at the rates of the tries forwarded to.
export function ghostBundle(p: GhostPlan & {
  secret: Uint8Array;
  network: Network;
  coin: Coin;
  ordinals: string;
  payment: string;
  refundRates: number[];
  skip?: number;
  from?: number;
}): GhostBundle {
  const commit = commitTree(p.secret, p.first, p.count, p.network);
  const rungs = ghostRungs(p.extra);
  const skip = p.skip ?? 0;
  const claims: GhostClaim[] = [];
  for (let n = Math.max(p.first, p.from ?? p.first); n <= ghostLast(p); n++) {
    const params: RevealParams = { secret: p.secret, n, coin: p.coin, postageAddress: p.ordinals, changeAddress: p.payment, network: p.network, commit: commit.leaf(n) };
    const vsize = buildReveal(params, 0, false).vsize;
    for (let r = 0; r < rungs; r++) {
      const fee = Math.ceil(ghostRate(p.start, ghostTry(p, n) - 1, r) * vsize);
      if (p.coin.amount - POSTAGE - fee < 0) break;
      const built = buildReveal(params, fee);
      claims.push({ n, rung: r, rate: round2(built.fee / built.vsize), fee: built.fee, vsize: built.vsize, txid: built.txid, hex: built.hex });
    }
  }
  const refunds: GhostRefund[] = [];
  const back = { secret: p.secret, n: p.first, coin: p.coin, toAddress: p.payment, network: p.network, commit };
  const size = buildRefund(back, 0, false).vsize;
  for (const rate of p.refundRates) {
    const fee = Math.ceil(rate * size);
    if (p.coin.amount - fee < dustLimit(outputScript(p.payment, p.network))) continue;
    const built = buildRefund(back, fee);
    refunds.push({ rate: round2(built.fee / built.vsize), fee: built.fee, vsize: built.vsize, txid: built.txid, hex: built.hex });
  }
  return { first: p.first, count: p.count, start: p.start, extra: p.extra, skip, coin: p.coin, ordinals: p.ordinals, payment: p.payment, claims, refunds };
}

// What a server checks before it agrees to send a run's transactions: each spends only the deposit, pays only the
// player's own addresses, and each claim is the claim of its number, not mineable before that block, paying at least
// the rate of its try.
export function checkGhostBundle(b: GhostBundle, network: Network): string | null {
  ghostDepths(b.count);
  const skip = b.skip ?? 0;
  if (!Number.isInteger(skip) || skip < 0 || skip >= b.count) return 'no such try';
  if (!b.claims.length) return 'no claims';
  const ordinals = outputScript(b.ordinals, network);
  const payment = outputScript(b.payment, network);
  const spendsDeposit = (ins: { txid: string; vout: number }[]) => ins.length === 1 && ins[0].txid === b.coin.txid && ins[0].vout === b.coin.vout;
  for (const c of b.claims) {
    const tx = parseTx(fromHex(c.hex));
    if (tx.txid() !== c.txid) return `claim ${c.txid} does not match its hex`;
    if (!spendsDeposit(tx.inputs)) return `claim for ${c.n} spends something else`;
    if (c.n < b.first || c.n > ghostLast(b)) return `claim for ${c.n} is outside the run`;
    if (tx.locktime !== c.n - 1) return `claim for ${c.n} could be mined before its block`;
    const [postage, change, ...rest] = tx.outputs;
    if (!postage || !equal(postage.script, ordinals) || postage.value !== POSTAGE) return `claim for ${c.n} does not send the bitmap to the player`;
    if (rest.length || (change && !equal(change.script, payment))) return `claim for ${c.n} pays someone else`;
    const fee = b.coin.amount - tx.outputs.reduce((s, o) => s + o.value, 0);
    if (fee !== c.fee || Math.ceil(tx.weight / 4) !== c.vsize) return `claim for ${c.n} misstates its fee or size`;
    if (!Number.isInteger(c.rung) || c.rung < 0 || fee < Math.ceil(ghostRate(b.start, ghostTry(b, c.n) - 1, c.rung) * c.vsize)) return `claim for ${c.n} pays less than its try`;
    const claims = claimsInTx(tx);
    if (claims.length !== 1 || claims[0].n !== c.n || claims[0].vin !== 0) return `claim for ${c.n} inscribes something else`;
  }
  for (const r of b.refunds) {
    const tx = parseTx(fromHex(r.hex));
    if (tx.txid() !== r.txid || !spendsDeposit(tx.inputs)) return `refund ${r.txid} spends something else`;
    if (tx.outputs.length !== 1 || !equal(tx.outputs[0].script, payment)) return `refund ${r.txid} pays someone else`;
    if (b.coin.amount - tx.outputs[0].value !== r.fee) return `refund ${r.txid} misstates its fee`;
  }
  return null;
}

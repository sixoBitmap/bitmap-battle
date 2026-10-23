import {
  type Built,
  buildRefund,
  buildReveal,
  chunkRate,
  type ClusterTx,
  type Coin,
  CONTENT_TYPE,
  commitFor,
  commitTree,
  feeForRate,
  fromHex,
  ghostBundle,
  ghostDeposit,
  type GhostPlan,
  LEGACY_CONTENT_TYPE,
  type Network,
  newSecret,
  type RevealParams,
  toHex,
} from '@bitmap-battle/core';
import { api, type Config, type GhostRunView, type Rates, type TableView } from './api.ts';
import { broadcast } from './broadcast.ts';
import { player } from './player.ts';
import { store } from './store.ts';
import { deposit as walletDeposit, type Wallet } from './wallet.ts';

// n: the number a ghost run's claim was for (a ghost run claims a new one every block).
export type Sent = { txid: string; hex: string; fee: number; vsize: number; rate: number; at: number; n?: number };

export type Battle = {
  id: string;
  network: Network;
  n: number;
  secret: string;
  payment: string;
  ordinals: string;
  budget: number;
  commitAddress: string;
  contentType?: string;
  deposit: { txid: string; vout: number | null; amount: number } | null;
  claims: Sent[];
  refund: Sent | null;
  outcome: 'won' | 'lost' | 'left' | null;
  // A ghost run: claims for every number from first, sent through the server's private pool.
  ghost?: GhostPlan & { started: boolean };
  winner: string | null;
  created: number;
};

export const battles = store<Battle[]>([], 'bb.battles');

const update = (id: string, patch: Partial<Battle> | ((b: Battle) => Partial<Battle>)) =>
  battles.set((all) => all.map((b) => (b.id === id ? { ...b, ...(typeof patch === 'function' ? patch(b) : patch) } : b)));

const find = (id: string) => {
  const b = battles.get().find((x) => x.id === id);
  if (!b) throw new Error('battle not found');
  return b;
};

export const current = (all: Battle[], n: number) => all.find((b) => b.n === n && b.outcome === null && !b.ghost) ?? null;

export const isActive = (b: Battle) => b.outcome === null;

export const lastClaim = (b: Battle) => b.claims.at(-1) ?? null;

const step = (rates: Rates) => Math.max(0.1, rates.incremental);
// The smallest lead that still ranks first: rival rates come rounded to 0.01, so this always lands strictly above them.
const TICK = 0.01;
const up = (x: number) => Math.ceil(x * 100 - 1e-6) / 100;

export function join(n: number, budget: number, w: Wallet, cfg: Config): Battle {
  if (current(battles.get(), n)) throw new Error('You are already in this battle.');
  const secret = newSecret();
  const b: Battle = {
    id: `${n}-${Date.now().toString(36)}`,
    network: cfg.network,
    n,
    secret: toHex(secret),
    payment: w.payment.address,
    ordinals: w.ordinals.address,
    budget,
    commitAddress: commitFor(secret, n, cfg.network).address,
    contentType: CONTENT_TYPE,
    deposit: null,
    claims: [],
    refund: null,
    outcome: null,
    winner: null,
    created: Date.now(),
  };
  battles.set((all) => [b, ...all]);
  return b;
}

// The battle is saved with its key before the wallet opens, so a closed tab never strands a deposit.
export async function fund(id: string, w: Wallet): Promise<void> {
  const b = find(id);
  const txid = await walletDeposit(w, b.commitAddress, b.budget);
  update(id, { deposit: { txid, vout: null, amount: b.budget } });
  if (!b.ghost) void api.funded(b.n, player, txid);
}

export function rebudget(id: string, budget: number): void {
  if (find(id).deposit) throw new Error('This battle is already funded.');
  update(id, { budget });
}

export async function locateDeposit(id: string): Promise<boolean> {
  const b = find(id);
  if (!b.deposit) return false;
  if (b.deposit.vout !== null) return true;
  const tx = await api.tx(b.deposit.txid);
  if (!tx) return false;
  const script = toHex(commitOf(b).script);
  const out = tx.outputs.find((o) => o.script === script);
  if (!out) throw new Error('That transaction does not pay this battle.');
  update(id, { deposit: { txid: b.deposit.txid, vout: out.n, amount: out.value } });
  return true;
}

export function remove(id: string): void {
  const b = find(id);
  if (b.deposit) throw new Error('This battle holds a deposit: take it back first.');
  battles.set((all) => all.filter((x) => x.id !== id));
  void (b.ghost ? api.ghostRelease(player) : api.release(b.n, player));
}

function coinOf(b: Battle): Coin {
  if (!b.deposit || b.deposit.vout === null) throw new Error('The deposit has not arrived yet.');
  return { txid: b.deposit.txid, vout: b.deposit.vout, amount: b.deposit.amount };
}

// Battles from before the shorter content type have none recorded; their deposit address commits to the old one.
const typeOf = (b: Battle) => b.contentType ?? LEGACY_CONTENT_TYPE;

// The deposit address of a battle: one number, or a ghost run's tree of numbers.
function commitOf(b: Battle) {
  const secret = fromHex(b.secret);
  return b.ghost ? commitTree(secret, b.ghost.first, b.ghost.count, b.network) : commitFor(secret, b.n, b.network, typeOf(b));
}

function revealParams(b: Battle, cfg: Config): RevealParams {
  return {
    secret: fromHex(b.secret),
    n: b.n,
    coin: coinOf(b),
    postageAddress: b.ordinals,
    changeAddress: b.payment,
    network: b.network,
    postage: cfg.postage,
    contentType: typeOf(b),
  };
}

export type Quote =
  | { ok: true; target: number; rate: number; fee: number; vsize: number; extra: number; top: number | null; built: (sign: boolean) => Built }
  | { ok: false; reason: string; top: number | null; best: number };

// What a claim costs right now: just above the best rival (or the next block's edge when nobody bids), counting
// the deposit when it still waits for a block, as miners do.
export async function quote(id: string, table: TableView, rates: Rates, cfg: Config): Promise<Quote> {
  const b = find(id);
  const params = revealParams(b, cfg);
  const last = lastClaim(b);
  const slot = last?.txid ?? 'claim';
  let cluster: ClusterTx[] = await api.cluster(last?.txid ?? params.coin.txid);
  if (last && !cluster.some((t) => t.txid === last.txid)) cluster = await api.cluster(params.coin.txid);
  const rateAt = (fee: number) => {
    const t = buildReveal(params, fee, false);
    return chunkRate(cluster, slot, t.fee, t.vsize);
  };
  const mine = new Set(b.claims.map((c) => c.txid));
  const rivals = table.claims.filter((c) => !mine.has(c.txid));
  const top = rivals.length ? Math.max(...rivals.map((c) => c.eff)) : null;
  const { vsize } = buildReveal(params, 0, false);
  const least = last ? last.fee + Math.ceil(rates.incremental * vsize) + 1 : Math.ceil(rates.minRelay * vsize) + 1;
  const most = params.coin.amount - cfg.postage;
  // Just above the best rival and just above the line for the next block; replacing your own last claim
  // costs at least the relay increment on top of its fee, which `least` already demands.
  const floor = Math.max(rates.nextBlock, rates.minRelay) + TICK;
  const target = up(Math.max(floor, top === null ? 0 : top + TICK));
  const fee = feeForRate(target, Math.min(least, most), most, rateAt);
  if (fee === null) return { ok: false, reason: 'Your budget cannot go that high.', top, best: rateAt(most) };
  const t = buildReveal(params, fee, false);
  return {
    ok: true,
    target,
    rate: rateAt(fee),
    fee: t.fee,
    vsize: t.vsize,
    extra: t.fee - (last?.fee ?? 0),
    top,
    built: (sign) => buildReveal(params, fee, sign),
  };
}

export async function claim(id: string, q: Extract<Quote, { ok: true }>, cfg: Config): Promise<Sent> {
  const built = q.built(true);
  await broadcast(built.hex, built.txid, cfg);
  const sent: Sent = { txid: built.txid, hex: built.hex, fee: built.fee, vsize: built.vsize, rate: q.rate, at: Date.now() };
  update(id, (b) => ({ claims: [...b.claims, sent] }));
  return sent;
}

// The claim waiting in the mempool, if any: the last one sent, or whatever spends the deposit now.
async function pending(b: Battle): Promise<{ txid: string; fee: number } | null> {
  if (!b.deposit || b.deposit.vout === null) return null;
  const spend = await api.outspend(b.deposit.txid, b.deposit.vout);
  if (spend.unspent || !spend.spender) return null;
  const known = b.claims.find((c) => c.txid === spend.spender);
  if (known) return known;
  const tx = await api.tx(spend.spender);
  return tx?.inMempool && tx.fee !== null ? { txid: tx.txid, fee: tx.fee } : null;
}

export type Takeback = { ok: true; fee: number; back: number; replaces: string | null } | { ok: false; reason: string };

// Taking the deposit back (Leave, or after a lost battle): a key-path spend to the payment address, replacing a
// claim still waiting in the mempool, so nothing is inscribed.
export async function quoteTakeback(id: string, rates: Rates): Promise<Takeback> {
  const b = find(id);
  if (!b.deposit || b.deposit.vout === null) return { ok: false, reason: 'There is no deposit to take back.' };
  const spend = await api.outspend(b.deposit.txid, b.deposit.vout);
  const waiting = await pending(b);
  if (!spend.unspent && !waiting) return { ok: false, reason: 'The deposit is already spent.' };
  const params = { secret: fromHex(b.secret), n: b.n, coin: coinOf(b), toAddress: b.payment, network: b.network, contentType: typeOf(b), commit: commitOf(b) };
  const { vsize } = buildRefund(params, 0, false);
  const wanted = Math.ceil((Math.max(rates.nextBlock, rates.minRelay) + step(rates)) * vsize);
  const fee = Math.max(wanted, waiting ? waiting.fee + Math.ceil(rates.incremental * vsize) + 1 : 0);
  const back = b.deposit.amount - fee;
  if (back < 294) return { ok: false, reason: 'Too little is left to take back after the network fee.' };
  return { ok: true, fee, back, replaces: waiting?.txid ?? null };
}

export async function takeBack(id: string, fee: number, cfg: Config): Promise<void> {
  const b = find(id);
  const built = buildRefund(
    { secret: fromHex(b.secret), n: b.n, coin: coinOf(b), toAddress: b.payment, network: b.network, contentType: typeOf(b), commit: commitOf(b) },
    fee,
  );
  await broadcast(built.hex, built.txid, cfg);
  const sent: Sent = { txid: built.txid, hex: built.hex, fee: built.fee, vsize: built.vsize, rate: built.fee / built.vsize, at: Date.now() };
  update(id, (x) => ({ refund: sent, outcome: x.outcome ?? 'left' }));
  void api.release(b.n, player);
}

// Looks up who holds the bitmap now and closes the battle when it is decided.
export async function settle(id: string): Promise<Battle['outcome']> {
  const b = find(id);
  if (b.outcome) return b.outcome;
  const info = await api.bitmap(b.n);
  if (!info.claimed || info.claimed === 'unknown') return null;
  const winner = info.claimed.inscription;
  const won = b.claims.some((c) => winner.startsWith(c.txid));
  if (!b.deposit) {
    battles.set((all) => all.filter((x) => x.id !== id));
    void api.release(b.n, player);
    return null;
  }
  update(id, { outcome: won ? 'won' : 'lost', winner });
  void api.release(b.n, player);
  return won ? 'won' : 'lost';
}

// Whether the deposit (or a losing claim still waiting) can be taken back.
export async function recoverable(id: string): Promise<boolean> {
  const b = find(id);
  if (!b.deposit || b.deposit.vout === null || b.outcome === 'won') return false;
  const spend = await api.outspend(b.deposit.txid, b.deposit.vout);
  if (spend.unspent) return true;
  if (!spend.spender || b.refund?.txid === spend.spender) return false;
  const tx = await api.tx(spend.spender);
  return Boolean(tx?.inMempool);
}

export function backup(b: Battle): string {
  return JSON.stringify({ app: 'bitmap-battle', version: 1, ...b }, null, 2);
}

export function restore(text: string): Battle {
  const data = JSON.parse(text);
  if (data.app !== 'bitmap-battle' || typeof data.secret !== 'string' || typeof data.n !== 'number') throw new Error('This is not a Bitmap Battle backup.');
  const { app: _app, version: _version, ...b } = data;
  const battle = b as Battle;
  if (commitOf(battle).address !== battle.commitAddress) {
    throw new Error('The backup does not match its own deposit address.');
  }
  battles.set((all) => [battle, ...all.filter((x) => x.id !== battle.id)]);
  return battle;
}

// Ghost runs: one deposit chases the newest bitmap for `count` blocks. The browser signs a claim for every number and
// fee rung, and the server sends the right one to the private pool each block, so the page can be closed.

export const GHOST_REFUNDS = [1, 2, 4, 8, 16];

export function ghostPlan(tip: number, start: number, extra: number, count: number): GhostPlan {
  return { first: tip + 2, count, start, extra };
}

export const ghostBudget = (plan: GhostPlan, w: Wallet, cfg: Config) => ghostDeposit(plan, cfg.network, w.ordinals.address, w.payment.address);

export function joinGhost(plan: GhostPlan, w: Wallet, cfg: Config): Battle {
  if (battles.get().some((b) => b.ghost && b.outcome === null)) throw new Error('You already have a ghost run.');
  const secret = newSecret();
  const b: Battle = {
    id: `ghost-${Date.now().toString(36)}`,
    network: cfg.network,
    n: plan.first,
    secret: toHex(secret),
    payment: w.payment.address,
    ordinals: w.ordinals.address,
    budget: ghostBudget(plan, w, cfg),
    commitAddress: commitTree(secret, plan.first, plan.count, cfg.network).address,
    contentType: CONTENT_TYPE,
    deposit: null,
    claims: [],
    refund: null,
    outcome: null,
    winner: null,
    created: Date.now(),
    ghost: { ...plan, started: false },
  };
  battles.set((all) => [b, ...all]);
  return b;
}

// Signs every claim and refund of the run and hands them to the server, which starts the chase.
export async function startGhost(id: string): Promise<void> {
  const b = find(id);
  if (!b.ghost || b.ghost.started) return;
  const bundle = ghostBundle({
    ...b.ghost,
    secret: fromHex(b.secret),
    network: b.network,
    coin: coinOf(b),
    ordinals: b.ordinals,
    payment: b.payment,
    refundRates: GHOST_REFUNDS,
  });
  await api.ghostStart(player, b.id, bundle);
  update(id, (x) => ({ ghost: { ...x.ghost!, started: true } }));
}

export const stopGhost = (id: string) => api.ghostStop(player, id);

// The server's view of the run, copied into the battle: the claims it sent, the refund, and how it ended.
export async function syncGhost(id: string): Promise<GhostRunView | null> {
  const b = find(id);
  if (!b.ghost?.started) return null;
  const run = await api.ghostRun(player, b.id).catch(() => null);
  if (!run) return null;
  const outcome = run.state === 'won' ? 'won' : run.state === 'lost' || run.state === 'gone' ? 'lost' : run.state === 'refunded' ? 'left' : null;
  update(id, {
    claims: run.sent.map((s) => ({ txid: s.txid, hex: '', fee: s.fee, vsize: s.vsize, rate: s.rate, at: s.at, n: s.n })),
    refund: run.refund ? { txid: run.refund.txid, hex: '', fee: run.refund.fee, vsize: 0, rate: run.refund.rate, at: run.refund.at } : null,
    outcome,
    winner: run.winner,
    n: run.sent.at(-1)?.n ?? b.n,
  });
  return run;
}

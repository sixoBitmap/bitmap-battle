import type { Network } from '@bitmap-battle/core';
import type { Bitmaps } from './bitmaps.ts';
import type { Seats } from './seats.ts';
import type { Watcher } from './watcher.ts';

export type ClaimView = { txid: string; index: number; rate: number; eff: number; fee: number; vsize: number; key: string | null; seen: number };
export type TableView = { n: number; kind: 'live' | 'next' | 'open'; claims: ClaimView[]; seat: string | null; hot: boolean };
export type ResultView = {
  height: number;
  hash: string;
  time: number;
  seenAt: number;
  claims: { n: number; inscription: string; txid: string; position: number; valid: boolean | null; key: string | null }[];
};
export type PublicState = {
  network: Network;
  syncing: boolean;
  tip: { height: number; hash: string; time: number; seenAt: number };
  rates: { nextBlock: number; minRelay: number; incremental: number };
  tables: TableView[];
  results: ResultView[];
  now: number;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildState(network: Network, watcher: Watcher, bitmaps: Bitmaps, seats: Seats): PublicState {
  const tip = watcher.tip.height;
  const byNumber = new Map<number, ClaimView[]>();
  for (const p of watcher.pool.values()) {
    if (!p.effVsize) continue;
    for (const c of p.claims) {
      if (c.n > tip + 1) continue;
      const list = byNumber.get(c.n) ?? [];
      list.push({
        txid: p.txid,
        index: c.index,
        rate: round2(p.fee / p.vsize),
        eff: round2(p.effFee / p.effVsize),
        fee: p.fee,
        vsize: p.vsize,
        key: c.key?.slice(0, 8) ?? null,
        seen: p.seen,
      });
      byNumber.set(c.n, list);
    }
  }
  const table = (n: number, kind: TableView['kind']): TableView => {
    const claims = (byNumber.get(n) ?? []).sort((a, b) => b.eff - a.eff || a.seen - b.seen);
    return { n, kind, claims, seat: seats.holder(n), hot: claims.length >= 2 };
  };
  const tables = [table(tip + 1, 'live'), table(tip + 2, 'next')];
  const open = new Set([...byNumber.keys(), ...seats.numbers()].filter((n) => n <= tip && bitmaps.claimed(n) === null));
  for (const n of [...open].sort((a, b) => b - a)) tables.push(table(n, 'open'));
  return {
    network,
    syncing: watcher.syncing || !watcher.mempoolLoaded,
    tip: watcher.tip,
    rates: watcher.rates,
    tables,
    results: watcher.blocks
      .slice(-12)
      .reverse()
      .map((b) => ({
        height: b.height,
        hash: b.hash,
        time: b.time,
        seenAt: b.seenAt,
        claims: b.claims.map((c) => ({ n: c.n, inscription: c.inscription, txid: c.txid, position: c.position, valid: c.valid, key: c.key?.slice(0, 8) ?? null })),
      })),
    now: Date.now(),
  };
}

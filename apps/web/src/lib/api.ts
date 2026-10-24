import type { ClusterTx, GhostBundle, Network } from '@bitmap-battle/core';

export type Config = {
  network: Network;
  postage: number;
  broadcast: string[];
  vapidKey: string;
  dev: boolean;
  tipAddress: string | null;
  tipAmounts: number[];
  // The private pool ghost runs go through, or null when this server has none.
  privatePool: string | null;
};

// max: the highest rate the claim can raise to with the coins it already spends (sat/vB), null when unknown.
export type ClaimView = {
  txid: string;
  index: number;
  rate: number;
  eff: number;
  fee: number;
  vsize: number;
  key: string | null;
  owner: string | null;
  ghost: boolean;
  max: number | null;
  seen: number;
};
export type ResultClaim = {
  n: number;
  inscription: string;
  txid: string;
  position: number;
  valid: boolean | null;
  key: string | null;
  owner: string | null;
  ghost: boolean;
  unseen: boolean | null;
};
export type TableView = { n: number; kind: 'live' | 'next' | 'open'; claims: ClaimView[]; seat: string | null; hot: boolean };
export type ResultView = {
  height: number;
  hash: string;
  time: number;
  seenAt: number;
  pool: string | null;
  claims: ResultClaim[];
};
export type Rates = { nextBlock: number; minRelay: number; incremental: number };
export type PublicState = {
  network: Network;
  syncing: boolean;
  tip: { height: number; hash: string; time: number; seenAt: number };
  rates: Rates;
  tables: TableView[];
  results: ResultView[];
  ghostRun: boolean;
  now: number;
};

export type TxInfo = {
  txid: string;
  hex: string;
  vsize: number;
  inMempool: boolean;
  fee: number | null;
  confirmations: number;
  height: number | null;
  outputs: { n: number; value: number; script: string; address: string | null }[];
};
export type BattleClaim = {
  txid: string;
  inscription: string;
  block: number;
  pool: string | null;
  owner: string | null;
  ghost: boolean;
  unseen: boolean | null;
  position: number;
  valid: boolean | null;
  key: string | null;
  fee: number | null;
  vsize: number;
  rate: number | null;
};
// try: the claim's try in the run; why: what made it climb above that try's rate (Can rise), if it did.
export type GhostSent = { n: number; rung: number; txid: string; fee: number; vsize: number; rate: number; at: number; try?: number; why?: string };
export type GhostRunView = {
  id: string;
  state: 'waiting' | 'chasing' | 'won' | 'lost' | 'refunded' | 'gone';
  stopped: boolean;
  first: number;
  count: number;
  start: number;
  extra: number;
  // Tries forwarded so far.
  skip: number;
  deposit: { txid: string; vout: number; amount: number };
  sent: GhostSent[];
  refund: { txid: string; fee: number; rate: number; at: number } | null;
  note: string;
  winner: string | null;
  block: number | null;
};
// A bitmap a ghost minted in a private pool's block (n: the newest number its claim won there), and its fee rate.
export type PoolMint = { n: number; height: number; owner: string | null; txid: string; rate: number | null };
// A private pool's newest block and whether a ghost minted in it, with its latest ghost mints (oldest first); height
// and ghost are null until a block of the pool is seen.
export type PoolStatus = { pool: string; height: number | null; ghost: boolean | null; wins: PoolMint[] };
export type PrivateInfo = { pool: string | null; floor: number | null; pools: PoolStatus[] };
export type Outspend = { unspent: boolean; spender: string | null; confirmations: number | null };
export type BitmapInfo = { n: number; claimed: { inscription: string; height: number } | null | 'unknown'; scannedTo: number };

async function reply<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

export const get = <T>(path: string) => fetch(path, { cache: 'no-store' }).then((r) => reply<T>(r));

export const post = <T>(path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => reply<T>(r));

export const api = {
  config: () => get<Config>('/api/config'),
  state: () => get<PublicState>('/api/state'),
  tx: (txid: string) => get<TxInfo>(`/api/tx/${txid}`).catch(() => null),
  cluster: (txid: string) => get<{ cluster: ClusterTx[] }>(`/api/cluster/${txid}`).then((r) => r.cluster),
  outspend: (txid: string, vout: number) => get<Outspend>(`/api/outspend/${txid}/${vout}`),
  bitmap: (n: number) => get<BitmapInfo>(`/api/bitmap/${n}`),
  unclaimed: () => get<{ numbers: number[] }>('/api/unclaimed').then((r) => r.numbers),
  battle: (height: number) => get<{ claims: BattleClaim[] }>(`/api/block/${height}/battle`).then((r) => r.claims),
  sizes: (height: number) => get<{ sizes: number[] }>(`/api/block/${height}/sizes`).then((r) => r.sizes),
  seat: (n: number, player: string) => post<{ ok: boolean }>('/api/seat', { n, player }),
  release: (n: number, player: string) => post<{ ok: boolean }>('/api/seat/release', { n, player }).catch(() => null),
  funded: (n: number, player: string, txid: string) => post<{ ok: boolean }>('/api/seat/funded', { n, player, txid }).catch(() => null),
  privateInfo: () => get<PrivateInfo>('/api/private'),
  ghostSeat: (player: string) => post<{ ok: boolean }>('/api/ghost/seat', { player }),
  ghostRelease: (player: string) => post<{ ok: boolean }>('/api/ghost/release', { player }).catch(() => null),
  ghostStart: (player: string, id: string, bundle: GhostBundle) => post<GhostRunView>('/api/ghost/start', { player, id, bundle }),
  ghostForward: (player: string, id: string, bundle: GhostBundle) => post<GhostRunView>('/api/ghost/forward', { player, id, bundle }),
  ghostStop: (player: string, id: string) => post<GhostRunView>('/api/ghost/stop', { player, id }),
  ghostRun: (player: string, id: string) => get<GhostRunView>(`/api/ghost/run/${id}?player=${player}`),
};

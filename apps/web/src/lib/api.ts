import type { ClusterTx, Network } from '@bitmap-battle/core';

export type Config = {
  network: Network;
  postage: number;
  broadcast: string[];
  vapidKey: string;
  dev: boolean;
  tipAddress: string | null;
  tipAmounts: number[];
};

export type ClaimView = { txid: string; index: number; rate: number; eff: number; fee: number; vsize: number; key: string | null; seen: number };
export type TableView = { n: number; kind: 'live' | 'next' | 'open'; claims: ClaimView[]; seat: string | null; hot: boolean };
export type ResultView = {
  height: number;
  hash: string;
  time: number;
  seenAt: number;
  claims: { n: number; inscription: string; txid: string; position: number; valid: boolean | null; key: string | null }[];
};
export type Rates = { nextBlock: number; minRelay: number; incremental: number };
export type PublicState = {
  network: Network;
  syncing: boolean;
  tip: { height: number; hash: string; time: number; seenAt: number };
  rates: Rates;
  tables: TableView[];
  results: ResultView[];
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
  position: number;
  valid: boolean | null;
  key: string | null;
  fee: number | null;
  vsize: number;
  rate: number | null;
};
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
};

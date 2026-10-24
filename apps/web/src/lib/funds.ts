import { type Config, get, type Rates } from './api.ts';
import { addressKind, type Wallet } from './wallet.ts';

export type Utxo = { value: number; confirmed: boolean; txid?: string; vout?: number };

export type Funds = {
  confirmed: number;
  pending: number;
  reserve: number;
  spendable: number;
  minimum: number;
  options: { share: number; amount: number }[];
};

const MEMPOOL_API: Record<string, string> = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
  testnet4: 'https://mempool.space/testnet4/api',
  signet: 'https://mempool.space/signet/api',
};

const INPUT_VSIZE: Record<string, number> = { 'Native SegWit': 69, 'Nested SegWit': 91, Taproot: 58, Legacy: 148 };

// Coins this small may carry an inscription; the wallet can refuse to spend them, so they never count.
const SMALL_COIN = 1000;

// The payment address's coins and the network's fastest fee rate. The node has no address index, so this asks a
// public explorer, the same one claims are broadcast through.
export async function readCoins(address: string, cfg: Config): Promise<{ utxos: Utxo[]; fastest: number }> {
  if (cfg.dev) return { utxos: await get<Utxo[]>(`/dev/utxos/${address}`), fastest: 0 };
  const base = MEMPOOL_API[cfg.network];
  const [utxos, fees] = await Promise.all([
    fetch(`${base}/address/${address}/utxo`).then((r) => {
      if (!r.ok) throw new Error('could not read the balance');
      return r.json() as Promise<{ txid: string; vout: number; value: number; status: { confirmed: boolean } }[]>;
    }),
    fetch(`${base}/v1/fees/recommended`)
      .then((r) => (r.ok ? (r.json() as Promise<{ fastestFee: number }>) : { fastestFee: 0 }))
      .catch(() => ({ fastestFee: 0 })),
  ]);
  return { utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, confirmed: u.status.confirmed })), fastest: fees.fastestFee };
}

// The coins a deposit may spend: confirmed, and not so small that they could carry an inscription.
export function spendable(utxos: Utxo[]): { txid: string; vout: number; value: number }[] {
  return utxos.filter((u) => u.confirmed && u.value > SMALL_COIN && u.txid).map((u) => ({ txid: u.txid!, vout: u.vout!, value: u.value }));
}

const roundDown = (x: number) => {
  const step = x >= 1_000_000 ? 10_000 : x >= 100_000 ? 1_000 : 100;
  return Math.floor(x / step) * step;
};

// Four budgets the wallet can always pay: a quarter, half, three quarters and all of what the confirmed coins
// hold after the deposit's own fee. That fee is kept back generously, because the wallet chooses its rate.
export function planBudgets(w: Wallet, coins: { utxos: Utxo[]; fastest: number }, rates: Rates, postage: number): Funds {
  const usable = coins.utxos.filter((u) => u.confirmed && u.value > SMALL_COIN);
  const confirmed = usable.reduce((s, u) => s + u.value, 0);
  const pending = coins.utxos.filter((u) => !u.confirmed).reduce((s, u) => s + u.value, 0);
  const feeRate = Math.max(rates.nextBlock, coins.fastest, 1) * 1.5 + 1;
  const vsize = 11 + usable.length * (INPUT_VSIZE[addressKind(w.payment)] ?? 148) + 43 + 43;
  const reserve = Math.ceil(feeRate * vsize);
  const spendable = Math.max(0, confirmed - reserve);
  const minimum = Math.max(1500, postage + Math.ceil(180 * Math.max(rates.nextBlock, 1) * 3));
  const options = [25, 50, 75, 100]
    .map((share) => ({ share, amount: roundDown((spendable * share) / 100) }))
    .filter((o, i, all) => o.amount >= minimum && all.findIndex((x) => x.amount === o.amount) === i);
  return { confirmed, pending, reserve, spendable, minimum, options };
}

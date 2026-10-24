import { depositPsbt, finishPsbt, type SpendCoin } from '@bitmap-battle/core';
import { type Config, get, post } from './api.ts';
import { broadcast } from './broadcast.ts';
import { store } from './store.ts';

export type Account = { address: string; publicKey: string; addressType?: string };
export type Wallet = { kind: 'xverse' | 'test'; network: string; payment: Account; ordinals: Account };

export const wallet = store<Wallet | null>(null, 'bb.wallet');

const NETWORK_NAMES: Record<string, string> = { mainnet: 'Mainnet', testnet: 'Testnet', testnet4: 'Testnet4', signet: 'Signet', regtest: 'Regtest' };

const TYPE_NAMES: Record<string, string> = { p2wpkh: 'Native SegWit', p2sh: 'Nested SegWit', p2tr: 'Taproot', p2pkh: 'Legacy', p2wsh: 'SegWit script' };

export function addressKind(a: Account): string {
  if (a.addressType && TYPE_NAMES[a.addressType]) return TYPE_NAMES[a.addressType];
  if (/^(bc1q|tb1q|bcrt1q)/.test(a.address)) return 'Native SegWit';
  if (/^(bc1p|tb1p|bcrt1p)/.test(a.address)) return 'Taproot';
  if (/^[23]/.test(a.address)) return 'Nested SegWit';
  return 'Bitcoin';
}

export const hasXverse = () => Boolean(window.XverseProviders?.BitcoinProvider ?? window.BitcoinProvider);

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Opens this page inside the Xverse app's browser, where the wallet can sign.
export const openInXverse = () => `https://connect.xverse.app/browser?url=${encodeURIComponent(location.href)}`;

export async function connect(cfg: Config): Promise<Wallet> {
  if (cfg.dev) {
    const s = await get<{ accounts: { payment: Account; ordinals: Account } }>('/dev/status');
    const w: Wallet = { kind: 'test', network: cfg.network, ...s.accounts };
    wallet.set(w);
    return w;
  }
  if (!hasXverse()) throw new Error('Xverse was not found in this browser.');
  const { request, AddressPurpose } = await import('@sats-connect/core');
  const res = await request('getAccounts', {
    purposes: [AddressPurpose.Payment, AddressPurpose.Ordinals],
    message: 'Bitmap Battle deposits from your payment address and sends won bitmaps to your ordinals address.',
  });
  if (res.status !== 'success') throw new Error(res.error?.message || 'Xverse did not connect.');
  const payment = res.result.find((a) => a.purpose === AddressPurpose.Payment);
  const ordinals = res.result.find((a) => a.purpose === AddressPurpose.Ordinals);
  if (!payment || !ordinals) throw new Error('Xverse did not share a payment and an ordinals address.');
  const net = await request('wallet_getNetwork', null).catch(() => null);
  if (net?.status === 'success' && net.result.bitcoin.name !== NETWORK_NAMES[cfg.network]) {
    throw new Error(`Xverse is on ${net.result.bitcoin.name}. Switch it to ${NETWORK_NAMES[cfg.network]} and connect again.`);
  }
  const w: Wallet = {
    kind: 'xverse',
    network: cfg.network,
    payment: { address: payment.address, publicKey: payment.publicKey, addressType: payment.addressType },
    ordinals: { address: ordinals.address, publicKey: ordinals.publicKey, addressType: ordinals.addressType },
  };
  wallet.set(w);
  return w;
}

export const disconnect = () => wallet.set(null);

// A deposit at the fee rate the player picked: the app builds it from the payment address's coins, and the wallet
// only signs it. The app still never sees the wallet's keys.
export async function depositAt(w: Wallet, address: string, amount: number, rate: number, coins: SpendCoin[], cfg: Config): Promise<string> {
  if (w.kind === 'test') return (await post<{ txid: string }>('/dev/send', { address, amount, feeRate: rate })).txid;
  const plan = depositPsbt({ coins, to: address, amount, payer: w.payment, rate, network: cfg.network });
  const { request } = await import('@sats-connect/core');
  const res = await request('signPsbt', {
    psbt: plan.psbt,
    signInputs: { [w.payment.address]: Array.from({ length: plan.inputs }, (_, i) => i) },
    broadcast: true,
  });
  if (res.status !== 'success') throw new Error(res.error?.message || 'The deposit was cancelled.');
  if (res.result.txid) return res.result.txid;
  const done = finishPsbt(res.result.psbt);
  await broadcast(done.hex, done.txid, cfg);
  return done.txid;
}

// The wallet sends the deposit itself: the app never sees its keys.
export async function deposit(w: Wallet, address: string, amount: number): Promise<string> {
  if (w.kind === 'test') return (await post<{ txid: string }>('/dev/send', { address, amount })).txid;
  const { request } = await import('@sats-connect/core');
  const res = await request('sendTransfer', { recipients: [{ address, amount }] });
  if (res.status === 'success') return res.result.txid;
  const message = res.error?.message || 'The deposit was cancelled.';
  if (/insufficient|not enough|balance/i.test(message)) {
    throw new Error(
      `Xverse pays from your ${addressKind(w.payment)} address ${w.payment.address.slice(0, 8)}…, and it does not hold enough for this amount plus the network fee. ` +
        'Pick a smaller amount, add BTC to that address, or switch Xverse (Settings > Advanced > Preferred Bitcoin Address) to the SegWit type that holds your BTC and connect again.',
    );
  }
  throw new Error(message);
}

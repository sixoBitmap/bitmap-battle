import { type Config, post } from './api.ts';

function friendly(message: string): string {
  if (/insufficient fee|rejecting replacement|replacement-adds-unconfirmed/i.test(message)) return 'Someone moved at the same moment. Tap again.';
  if (/non-final/i.test(message)) return 'Too early: this battle has not started yet.';
  if (/missingorspent|missing-inputs|bad-txns-inputs/i.test(message)) return 'Your deposit is not on the network yet, or it was already used.';
  if (/mempool min fee not met|min relay fee not met/i.test(message)) return 'The fee is too low for the network right now.';
  if (/txn-already-known|already in block chain|txn-already-in-mempool/i.test(message)) return '';
  return message.replace(/^sendrawtransaction RPC error: /, '').slice(0, 200);
}

// Sends a signed transaction straight from this browser to public relays. The app's server never broadcasts.
export async function broadcast(hex: string, txid: string, cfg: Config): Promise<void> {
  if (cfg.broadcast[0] === 'dev') {
    try {
      await post('/dev/broadcast', { hex });
      return;
    } catch (e) {
      const text = friendly((e as Error).message);
      if (text) throw new Error(text);
      return;
    }
  }
  const attempts = await Promise.allSettled(
    cfg.broadcast.map(async (url) => {
      const res = await fetch(url, { method: 'POST', body: hex, headers: { 'content-type': 'text/plain' } });
      const text = (await res.text()).trim();
      if (!res.ok) throw new Error(text);
      return text;
    }),
  );
  if (attempts.some((a) => a.status === 'fulfilled' && a.value === txid)) return;
  const reasons = attempts.map((a) => (a.status === 'rejected' ? friendly(String((a.reason as Error).message ?? a.reason)) : ''));
  if (reasons.some((r) => r === '')) return;
  throw new Error(reasons[0] || 'No relay accepted the transaction.');
}

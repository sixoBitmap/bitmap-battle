import { useEffect, useState } from 'react';
import type { Config } from './api.ts';
import { serverNow } from './live.ts';
import { readCoins } from './funds.ts';
import type { Wallet } from './wallet.ts';

export type Coins = Awaited<ReturnType<typeof readCoins>>;

// Fired when the payment address surely changed, so budgets are read again at once.
export const COINS_CHANGED = 'bb:coins';

export function useNow(every = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

// The payment address's coins, read again every 30 seconds; null while unknown, 'error' when unreadable.
export function useCoins(w: Wallet | null, cfg: Config | null) {
  const [coins, setCoins] = useState<Coins | null | 'error'>(null);
  const address = w?.payment.address;
  useEffect(() => {
    setCoins(null);
    if (!address || !cfg) return;
    let alive = true;
    const read = () => readCoins(address, cfg).then((c) => alive && setCoins(c), () => alive && setCoins((old) => (old && old !== 'error' ? old : 'error')));
    read();
    const t = setInterval(read, 30_000);
    window.addEventListener(COINS_CHANGED, read);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(COINS_CHANGED, read);
    };
  }, [address, cfg?.network]);
  return [coins, setCoins] as const;
}

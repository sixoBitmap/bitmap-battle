import { useState } from 'react';
import { short } from '../lib/format.ts';
import { live } from '../lib/live.ts';
import { fail, toast } from '../lib/toast.ts';
import { speak } from '../lib/mood.ts';
import { addressKind, connect, hasXverse, isMobile, openInXverse, wallet } from '../lib/wallet.ts';

export function useConnect() {
  const { config } = live.use();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!config) return null;
    if (!config.dev && !hasXverse()) {
      if (isMobile()) location.href = openInXverse();
      else window.open('https://www.xverse.app/download', '_blank', 'noopener');
      return null;
    }
    setBusy(true);
    try {
      const w = await connect(config);
      toast(`Connected. Deposits come from your ${addressKind(w.payment)} address ${short(w.payment.address, 6, 4)}.`, 'good');
      return w;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export function WalletButton() {
  const w = wallet.use();
  const { config } = live.use();
  const { run, busy } = useConnect();
  if (w && config && w.network === config.network) {
    return (
      <button
        className="wallet on"
        title={`Pays from ${w.payment.address}`}
        onClick={() =>
          speak(`You pay from ${addressKind(w.payment)} ${w.payment.address}. Bitmaps go to ${w.ordinals.address}.`)
        }
      >
        {w.kind === 'test' ? '🧪' : '₿'} {short(w.payment.address, 4, 4)}
      </button>
    );
  }
  return (
    <button className="wallet" onClick={run} disabled={busy}>
      {busy ? '…' : config?.dev ? 'Test wallet' : 'Connect'}
    </button>
  );
}

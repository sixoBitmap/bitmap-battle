import { useMemo, useState } from 'react';
import { compact, sats } from '../lib/format.ts';
import { planBudgets } from '../lib/funds.ts';
import { useCoins } from '../lib/hooks.ts';
import { live } from '../lib/live.ts';
import { sfx } from '../lib/sound.ts';
import { fail, toast } from '../lib/toast.ts';
import { deposit, wallet } from '../lib/wallet.ts';
import { Addr } from './Addr.tsx';
import { useConnect } from './WalletButton.tsx';

export const TIPPED = 'bb:tipped';

// What the payment address can still send, or null while unknown.
function useSpendable(): number | null {
  const { config, state } = live.use();
  const w = wallet.use();
  const [coins] = useCoins(w, config);
  return useMemo(
    () => (w && coins && coins !== 'error' && state && config ? planBudgets(w, coins, state.rates, config.postage).spendable : null),
    [w, coins, state?.rates.nextBlock, config?.postage],
  );
}

function useTip() {
  const { config } = live.use();
  const w = wallet.use();
  const [busy, setBusy] = useState<number | null>(null);
  const send = async (amount: number) => {
    if (!config?.tipAddress || !w || busy) return false;
    setBusy(amount);
    try {
      await deposit(w, config.tipAddress, amount);
      sfx.lead();
      toast(`Thank you for the ${sats(amount)} tip! 🧡`, 'good');
      window.dispatchEvent(new Event(TIPPED));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { send, busy };
}

function Amounts({ onSent }: { onSent?: () => void }) {
  const { config } = live.use();
  const spendable = useSpendable();
  const { send, busy } = useTip();
  if (!config?.tipAddress) return null;
  return (
    <div className="tip-amounts">
      {config.tipAmounts.map((a) => (
        <button
          key={a}
          className="tip-amount"
          disabled={busy !== null || (spendable !== null && a > spendable)}
          onClick={() => send(a).then((ok) => ok && onSent?.())}
        >
          {busy === a ? '…' : `🧡 ${compact(a)}`}
        </button>
      ))}
    </div>
  );
}

// One tap after a win: each amount opens the wallet to confirm the tip.
export function TipRow() {
  const { config } = live.use();
  const w = wallet.use();
  if (!config?.tipAddress || !w) return null;
  return (
    <div className="tip-row">
      <span>Say thanks to the builder</span>
      <Amounts />
    </div>
  );
}

export function TipSheet({ onClose }: { onClose: () => void }) {
  const { config } = live.use();
  const w = wallet.use();
  const { run: connect, busy } = useConnect();
  if (!config?.tipAddress) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal tip-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Boop! Send a tip? 🧡</h2>
        <p className="muted">
          Tips go to the person who runs this battle server, at <Addr value={config.tipAddress} head={8} tail={6} label="Tips go to" />. Your
          wallet asks you to confirm.
        </p>
        {w ? (
          <Amounts onSent={onClose} />
        ) : (
          <button className="big go" onClick={connect} disabled={busy}>
            CONNECT WALLET
          </button>
        )}
        <button className="leave" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}

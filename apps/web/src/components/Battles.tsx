import { useEffect, useState } from 'react';
import { type Battle, backup, battles, quoteTakeback, recoverable, remove, restore, takeBack } from '../lib/battles.ts';
import { num, rate, sats } from '../lib/format.ts';
import { live } from '../lib/live.ts';
import { fail, toast } from '../lib/toast.ts';
import { addressKind, disconnect, wallet } from '../lib/wallet.ts';
import { Addr, Tx } from './Addr.tsx';

function download(b: Battle) {
  const url = URL.createObjectURL(new Blob([backup(b)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `bitmap-battle-${b.n}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LABEL: Record<string, string> = {
  won: '🏆 Won',
  lost: '😅 Lost',
  left: '👋 Left',
};


function Row({ b }: { b: Battle }) {
  const { state, config } = live.use();
  const [back, setBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const tip = state?.tip.height ?? 0;

  useEffect(() => {
    if (b.outcome && b.outcome !== 'won') recoverable(b.id).then(setBack, () => setBack(false));
    else setBack(false);
  }, [b.id, b.outcome, b.refund?.txid, tip]);

  const takeBackNow = async () => {
    if (!state || !config) return;
    setBusy(true);
    try {
      const t = await quoteTakeback(b.id, state.rates);
      if (!t.ok) throw new Error(t.reason);
      if (!confirm(`Take back about ${sats(t.back)}? The network fee is ${sats(t.fee)}.`)) return;
      await takeBack(b.id, t.fee, config);
      toast('Your sats are on their way back', 'good');
      setBack(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const status = b.outcome
    ? LABEL[b.outcome]
    : b.ghost
      ? b.claims.length
        ? `👻 Ghost run (${b.claims.length} tr${b.claims.length > 1 ? 'ies' : 'y'})`
        : '👻 Ghost run'
      : !b.deposit
      ? 'No deposit yet'
      : b.deposit.vout === null
        ? 'Deposit arriving'
        : b.claims.length
          ? `Fighting (${b.claims.length} bid${b.claims.length > 1 ? 's' : ''})`
          : 'Ready';

  return (
    <div className={`row ${b.outcome ?? 'active'} ${open ? 'open' : ''}`}>
      <button type="button" className="row-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{num(b.n)}</b>
        <span>{status}</span>
        <i>{open ? '▴' : '▾'}</i>
      </button>
      <div className="row-meta">
        {b.deposit ? `${sats(b.deposit.amount)} in` : sats(b.budget)}
        {b.claims.length > 0 && ` · bid ${sats(b.claims.at(-1)!.fee)}`}
      </div>
      <div className="row-actions">
        {back && (
          <button className="small go" onClick={takeBackNow} disabled={busy}>
            Sats back
          </button>
        )}
        <button className="small" onClick={() => download(b)} aria-label="Download backup">
          💾
        </button>
        {(!b.deposit || (b.outcome && !back)) && (
          <button
            className="small ghost"
            aria-label="Remove"
            onClick={() => {
              if (b.deposit) battles.set((all) => all.filter((x) => x.id !== b.id));
              else remove(b.id);
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="row-txs">
          {b.deposit ? (
            <Tx name="Deposit" id={b.deposit.txid} extra={sats(b.deposit.amount)} />
          ) : (
            <div className="tx muted">No deposit yet</div>
          )}
          {b.claims.map((c, i) => (
            <Tx
              key={c.txid}
              name={c.n !== undefined ? `Claim ${num(c.n)}` : b.claims.length > 1 ? `Bid ${i + 1}` : 'Claim'}
              id={c.txid}
              extra={`${sats(c.fee)} · ${rate(c.rate)}`}
            />
          ))}
          {b.refund && <Tx name="Sats back" id={b.refund.txid} extra={sats(b.refund.fee)} />}
          {b.outcome === 'won' && b.claims.length > 0 && <Tx name="Your bitmap" id={b.winner ?? `${b.claims.at(-1)!.txid}i0`} kind="inscription" />}
          {!b.outcome && (
            <a className="link" href={b.ghost ? '#/ghost' : `#/table/${b.n}`}>
              {b.ghost ? '👻 To the ghost run' : '⚔ Back to the battle'}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Connected() {
  const w = wallet.use();
  if (!w) return null;
  return (
    <div className="connected">
      <span>
        Pays from {addressKind(w.payment)} <Addr value={w.payment.address} label="You pay from" />
      </span>
      <span>
        Bitmaps go to <Addr value={w.ordinals.address} label="Bitmaps go to" />
      </span>
      <button className="small ghost" onClick={() => confirm('Disconnect this wallet?') && disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

export function Battles() {
  const all = battles.use();
  const restoreFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const b = restore(await file.text());
      toast(`Restored the battle for ${num(b.n)}.bitmap`, 'good');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="page mine">
      <div className="page-head">
        <h2>Your purse</h2>
        <label className="small restore">
          Restore
          <input type="file" accept="application/json,.json" onChange={(e) => restoreFile(e.target.files?.[0])} />
        </label>
      </div>
      <Connected />
      <p className="muted">Each battle key lives only in this browser. Tap 💾 to save a backup while coins are inside.</p>
      <div className="list">
        {all.length === 0 ? <div className="empty">No battles yet. The arena awaits.</div> : all.map((b) => <Row key={b.id} b={b} />)}
      </div>
    </div>
  );
}

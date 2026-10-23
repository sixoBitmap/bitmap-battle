import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type BattleClaim } from '../lib/api.ts';
import { num, rate, sats, who } from '../lib/format.ts';
import { Tx } from './Addr.tsx';

// Who claimed a past block's bitmap, in block order, with the fee each one paid. Rendered on the page itself, so
// the scroll's paper cannot clip it.
export function BattleLog({ height, onClose }: { height: number; onClose: () => void }) {
  const [claims, setClaims] = useState<BattleClaim[] | 'error' | null>(null);

  useEffect(() => {
    api.battle(height).then(setClaims, () => setClaims('error'));
  }, [height]);

  const winner = Array.isArray(claims) ? claims.find((c) => c.valid) : undefined;
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal log-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Battle for {num(height)}.bitmap</h2>
        {claims === null ? (
          <p className="muted">Reading the block…</p>
        ) : claims === 'error' ? (
          <p className="muted">This block is too old to read here.</p>
        ) : (
          <>
            <p className="muted">
              {claims.length} claim{claims.length === 1 ? '' : 's'} for {num(height)}. The first one mined wins.
              {claims.find((c) => c.block === height)?.pool && ` Block ${num(height)} was mined by ${claims.find((c) => c.block === height)!.pool}.`}
            </p>
            <div className="log">
              {claims.map((c, i) => {
                const w = who(c);
                return (
                  <Tx
                    key={c.txid}
                    name={`${i + 1}. ${c.valid ? '👑 ' : ''}${w.icon} ${w.name}`}
                    id={c.txid}
                    extra={[
                      c.fee === null ? '' : `${sats(c.fee)} · ${rate(c.rate ?? 0)}`,
                      c.block === height ? '' : `block ${num(c.block)}`,
                      c.unseen ? 'private' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                );
              })}
              {winner && <Tx name="The bitmap" id={winner.inscription} kind="inscription" />}
            </div>
          </>
        )}
        <button className="big go" onClick={onClose}>
          To the arena
        </button>
      </div>
    </div>,
    document.body,
  );
}

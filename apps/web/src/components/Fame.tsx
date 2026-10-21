import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { num, who } from '../lib/format.ts';
import { live, onBlock } from '../lib/live.ts';
import { BattleLog } from './BattleLog.tsx';

// The hall of fame: who won the last blocks, and the older bitmaps nobody owns yet, open for a fight.
export function Fame() {
  const { state, config } = live.use();
  const [free, setFree] = useState<number[] | null>(null);
  const [log, setLog] = useState<number | null>(null);

  useEffect(() => {
    const read = () => api.unclaimed().then(setFree, () => setFree([]));
    read();
    const off = onBlock(read);
    return () => {
      off();
    };
  }, []);

  if (!state || !config) return null;
  // Older bitmaps someone is claiming right now come first: those are fights you can still join.
  const fights = new Map(state.tables.filter((t) => t.kind === 'open' && t.claims.length > 0).map((t) => [t.n, t.claims.length]));
  const shown = free === null ? null : [...new Set([...[...fights.keys()].sort((a, b) => b - a), ...free])];
  return (
    <div className="page fame-page">
      <h2>Hall of fame</h2>
      <div className="list">
        <h3 className="list-title">Unclaimed bitmaps</h3>
        {shown === null ? (
          <p className="muted">Looking for bitmaps without an owner…</p>
        ) : shown.length === 0 ? (
          <p className="muted">Every bitmap so far has an owner. Fight for the next block!</p>
        ) : (
          shown.map((n) => {
            const claims = fights.get(n) ?? 0;
            return (
              <a key={n} className={`row free ${claims ? 'contested' : ''}`} href={`#/table/${n}`}>
                <b>{num(n)}</b>
                <span>{claims ? `${claims} claim${claims > 1 ? 's' : ''} in the mempool` : 'no owner yet'}</span>
                <em>{claims ? 'FIGHT ⚔' : 'MINT ⚡'}</em>
              </a>
            );
          })
        )}

        <h3 className="list-title">Last champions</h3>
        {state.results.map((r) => {
          const winner = r.claims.find((c) => c.n === r.height && c.valid);
          const fights = r.claims.filter((c) => c.n === r.height).length;
          const w = winner ? who(winner.key) : null;
          return w ? (
            <button key={r.height} type="button" className="row champion" onClick={() => setLog(r.height)}>
              <b>{num(r.height)}</b>
              <span>{`${w.icon} ${w.name}`}</span>
              <em>{fights > 1 ? `⚔ ${fights}` : '📜'}</em>
            </button>
          ) : (
            <a key={r.height} className="row champion" href={`#/table/${r.height}`}>
              <b>{num(r.height)}</b>
              <span>unclaimed</span>
              <em>MINT ⚡</em>
            </a>
          );
        })}
      </div>
      {log !== null && <BattleLog height={log} onClose={() => setLog(null)} />}
    </div>
  );
}

import type { ClaimView } from '../lib/api.ts';
import { bigRate, compact, rate, who } from '../lib/format.ts';

// How far a claim can still go with the coins it already spends: nothing left once its rate is its max.
function room(c: ClaimView): { label: string; title: string } {
  if (c.max === null) return { label: 'max ?', title: 'Its coins are not known yet' };
  const coins = compact(Math.round(c.max * c.vsize));
  if (c.max - c.rate < 0.01) return { label: 'all in', title: `It has already bid all ${coins} it holds` };
  return { label: `max ${bigRate(c.max)}`, title: `Can raise to ${bigRate(c.max)} sat/vB with the ${coins} it already holds` };
}

// The claims of one bitmap as bars, best first: the leader wears the crown.
export function Fight({ claims, mine, compact }: { claims: ClaimView[]; mine: string[]; compact?: boolean }) {
  const top = Math.max(...claims.map((c) => c.eff), 0.01);
  return (
    <div className={`fight ${compact ? 'compact' : ''}`}>
      {claims.map((c, i) => {
        const me = mine.includes(c.txid);
        const w = who(c);
        const r = room(c);
        return (
          <div key={c.txid} className={`bar ${me ? 'me' : ''} ${i === 0 ? 'lead' : ''}`}>
            <div className="bar-fill" style={{ width: `${Math.max(8, (c.eff / top) * 100)}%` }} />
            <span className="bar-label">
              {i === 0 && '👑 '}
              {me ? '⭐ YOU' : `${w.icon} ${w.name}`}
            </span>
            <span className="bar-rate" title={r.title}>
              {rate(c.eff)}
              <small>{r.label}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

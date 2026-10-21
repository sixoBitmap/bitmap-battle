import type { ClaimView } from '../lib/api.ts';
import { rate, who } from '../lib/format.ts';

// The claims of one bitmap as bars, best first: the leader wears the crown.
export function Fight({ claims, mine, compact }: { claims: ClaimView[]; mine: string[]; compact?: boolean }) {
  const top = Math.max(...claims.map((c) => c.eff), 0.01);
  return (
    <div className={`fight ${compact ? 'compact' : ''}`}>
      {claims.map((c, i) => {
        const me = mine.includes(c.txid);
        const w = who(c.key);
        return (
          <div key={c.txid} className={`bar ${me ? 'me' : ''} ${i === 0 ? 'lead' : ''}`}>
            <div className="bar-fill" style={{ width: `${Math.max(8, (c.eff / top) * 100)}%` }} />
            <span className="bar-label">
              {i === 0 && '👑 '}
              {me ? '⭐ YOU' : `${w.icon} ${w.name}`}
            </span>
            <span className="bar-rate">{rate(c.eff)}</span>
          </div>
        );
      })}
    </div>
  );
}

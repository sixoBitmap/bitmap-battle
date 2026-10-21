import { explorer, short } from '../lib/format.ts';
import { live } from '../lib/live.ts';
import { speak } from '../lib/mood.ts';

// A shortened address or transaction id; tapping it makes the cube read out the whole thing, and copies it.
export function Addr({ value, head = 6, tail = 4, label }: { value: string; head?: number; tail?: number; label?: string }) {
  const reveal = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {}
    speak(`${label ? `${label}: ` : ''}${value}${copied ? ' (copied)' : ''}`);
  };
  return (
    <button type="button" className="addr" onClick={reveal} title={value}>
      {short(value, head, tail)}
    </button>
  );
}

// One transaction: a mempool link on mainnet, otherwise the cube reads the id out.
export function Tx({ name, id, kind = 'tx', extra }: { name: string; id: string; kind?: 'tx' | 'inscription'; extra?: string }) {
  const { config } = live.use();
  const link = config ? explorer(config.network, kind, id) : '';
  return (
    <div className="tx">
      <span>{name}</span>
      {extra && <em>{extra}</em>}
      {link ? (
        <a className="link" href={link} target="_blank" rel="noopener">
          {id.slice(0, 8)}… ↗
        </a>
      ) : (
        <Addr value={id} head={6} tail={4} label={name} />
      )}
    </div>
  );
}

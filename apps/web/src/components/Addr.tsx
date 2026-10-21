import { short } from '../lib/format.ts';
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

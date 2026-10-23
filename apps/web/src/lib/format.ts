export const num = (n: number) => n.toLocaleString('en-US');

export const sats = (n: number) => `${num(Math.round(n))} sats`;

const trim = (x: string) => (x.includes('.') ? x.replace(/\.?0+$/, '') : x);

export function compact(sats: number): string {
  if (sats >= 1_000_000) return `${trim((sats / 1e8).toFixed(4))} ₿`;
  if (sats >= 1000) return `${trim((sats / 1000).toFixed(sats >= 100_000 ? 0 : 1))}k`;
  return String(sats);
}

const NUMERALS: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function numerals(n: number): string {
  let out = '';
  for (const [value, letters] of NUMERALS) {
    while (n >= value) {
      out += letters;
      n -= value;
    }
  }
  return out;
}

// Roman numerals; from 4,000 up the thousands get a bar over them (the vinculum), as the Romans wrote them.
export function roman(n: number): { thousands: string; rest: string } {
  if (n === 0) return { thousands: '', rest: 'N' };
  if (n < 4000) return { thousands: '', rest: numerals(n) };
  return { thousands: numerals(Math.floor(n / 1000)), rest: numerals(n % 1000) };
}

export const rate = (r: number) => `${r < 10 ? r.toFixed(2) : r.toFixed(1)} sat/vB`;

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export const short = (s: string, head = 6, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${tail ? s.slice(-tail) : ''}` : s);

// The bitmap bot signs every claim with the same key.
export const BOT_KEYS = new Set(['7dd6a85f']);

// A ghost sends its claims straight to private pools, so they never show up in the mempool: it is named after the
// address its bitmaps go to, since it signs every claim with a new key.
export type Claimer = { key: string | null; owner?: string | null; ghost?: boolean };

// The icon says what kind of claimer it is; the name only tells them apart.
export function who(c: Claimer): { icon: string; name: string } {
  if (c.key && BOT_KEYS.has(c.key)) return { icon: '🤖', name: c.key };
  if (c.ghost) return { icon: '👻', name: c.owner ? short(c.owner, 6, 4) : (c.key ?? '') };
  return { icon: '👤', name: c.key ?? (c.owner ? short(c.owner, 6, 4) : '') };
}

// A fee rate that can run into the thousands: 960, 12k, 1.2M.
export function bigRate(r: number): string {
  if (r >= 1e6) return `${trim((r / 1e6).toFixed(1))}M`;
  if (r >= 1000) return `${trim((r / 1000).toFixed(r >= 100_000 ? 0 : 1))}k`;
  return r >= 100 ? String(Math.round(r)) : trim(r.toFixed(1));
}

export function explorer(network: string, kind: 'tx' | 'inscription', id: string): string {
  if (network === 'mainnet') return kind === 'tx' ? `https://mempool.space/tx/${id}` : `https://ordinals.com/inscription/${id}`;
  if (network === 'signet' || network === 'testnet4') return kind === 'tx' ? `https://mempool.space/${network}/tx/${id}` : `https://${network}.ordinals.com/inscription/${id}`;
  return '';
}

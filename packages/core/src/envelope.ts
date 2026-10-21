import { equal, utf8 } from './bytes.ts';

export const MARK = utf8('ord');

const KNOWN_EVEN_TAGS = new Set([2]);
const CHUNKED_TAGS = new Set([5]);

export type Envelope = {
  tags: Map<number, Uint8Array[]>;
  body: Uint8Array;
  pushnum: boolean;
  incomplete: boolean;
  duplicate: boolean;
  unknownEven: boolean;
};

type Token = { kind: 'push' | 'num' | 'op'; data: Uint8Array; op: number };

const EMPTY = new Uint8Array();

export function tapscript(items: Uint8Array[]): Uint8Array | null {
  if (items.length >= 2 && items[items.length - 1][0] === 0x50) items = items.slice(0, -1);
  return items.length >= 2 ? items[items.length - 2] : null;
}

function scriptOps(s: Uint8Array): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const op = s[i++];
    if (op === 0x00) {
      out.push({ kind: 'push', data: EMPTY, op });
    } else if (op <= 0x4b) {
      if (i + op > n) throw new Error('push past the end of the script');
      out.push({ kind: 'push', data: s.subarray(i, i + op), op });
      i += op;
    } else if (op === 0x4c || op === 0x4d || op === 0x4e) {
      const width = op === 0x4c ? 1 : op === 0x4d ? 2 : 4;
      if (i + width > n) throw new Error('push past the end of the script');
      let len = 0;
      for (let k = width - 1; k >= 0; k--) len = len * 256 + s[i + k];
      i += width;
      if (i + len > n) throw new Error('push past the end of the script');
      out.push({ kind: 'push', data: s.subarray(i, i + len), op });
      i += len;
    } else if (op === 0x4f) {
      out.push({ kind: 'num', data: Uint8Array.of(0x81), op });
    } else if (op >= 0x51 && op <= 0x60) {
      out.push({ kind: 'num', data: Uint8Array.of(op - 0x50), op });
    } else {
      out.push({ kind: 'op', data: EMPTY, op });
    }
  }
  return out;
}

function tagNumber(t: Uint8Array): number {
  if (t.length > 6) return t[0] & 1 ? -1 : -2;
  let v = 0;
  for (let k = t.length - 1; k >= 0; k--) v = v * 256 + t[k];
  return v;
}

export function envelopes(script: Uint8Array): Envelope[] {
  let toks: Token[];
  try {
    toks = scriptOps(script);
  } catch {
    return [];
  }
  const out: Envelope[] = [];
  const n = toks.length;
  let k = 0;
  while (k + 2 < n) {
    const start = toks[k];
    if (start.kind === 'push' && start.data.length === 0 && toks[k + 1].op === 0x63 && toks[k + 2].kind === 'push' && equal(toks[k + 2].data, MARK)) {
      let j = k + 3;
      const fields: Uint8Array[] = [];
      const body: Uint8Array[] = [];
      let inBody = false;
      let pushnum = false;
      let closed = false;
      while (j < n) {
        const { kind, data, op } = toks[j];
        if (op === 0x68) {
          closed = true;
          break;
        }
        if (kind === 'op') break;
        if (kind === 'num') pushnum = true;
        if (inBody) body.push(data);
        else if (kind === 'push' && data.length === 0 && fields.length % 2 === 0) inBody = true;
        else fields.push(data);
        j++;
      }
      if (closed) {
        const tags = new Map<number, Uint8Array[]>();
        let duplicate = false;
        let unknownEven = false;
        for (let f = 0; f + 1 < fields.length; f += 2) {
          const tag = tagNumber(fields[f]);
          const values = tags.get(tag);
          if (values && !CHUNKED_TAGS.has(tag)) duplicate = true;
          if (values) values.push(fields[f + 1]);
          else tags.set(tag, [fields[f + 1]]);
          if ((tag === -2 || (tag >= 0 && tag % 2 === 0)) && !KNOWN_EVEN_TAGS.has(tag)) unknownEven = true;
        }
        const size = body.reduce((s, b) => s + b.length, 0);
        const joined = new Uint8Array(size);
        let at = 0;
        for (const b of body) {
          joined.set(b, at);
          at += b.length;
        }
        out.push({ tags, body: joined, pushnum, incomplete: fields.length % 2 === 1, duplicate, unknownEven });
      }
      k = j + 1;
    } else {
      k++;
    }
  }
  return out;
}

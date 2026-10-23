import { indexOf, latin1, toHex } from './bytes.ts';
import { type Envelope, envelopes, MARK, tapscript } from './envelope.ts';
import { blockTxs, type RawTx } from './rawtx.ts';

const CLAIM_RE = /^(0|[1-9][0-9]{0,7})\.bitmap$/;

// The rules of bitmap_index.py with its defaults: the body is exactly "<n>.bitmap", the content type starts
// with text/plain, the body is not compressed, and cursed inscriptions count like any other.
export function claimNumber(env: Envelope): number | null {
  if (env.body.length < 8 || env.body.length > 16) return null;
  const m = CLAIM_RE.exec(latin1(env.body));
  if (!m || env.tags.has(9)) return null;
  const contentType = env.tags.get(1)?.[0];
  if (!contentType || !latin1(contentType).toLowerCase().startsWith('text/plain')) return null;
  return Number(m[1]);
}

// owner: the output script the inscription lands on, when it can be told from the transaction alone.
export type TxClaim = { n: number; index: number; vin: number; key: string | null; pointer: number | null; owner: Uint8Array | null };

// A pointer tag: the sat offset in the outputs, little-endian.
function pointerOf(env: Envelope): number | null {
  const raw = env.tags.get(2)?.[0];
  if (!raw || raw.length > 8) return null;
  let v = 0;
  for (let i = raw.length - 1; i >= 0; i--) v = v * 256 + raw[i];
  return v;
}

// The output holding sat `offset` of the outputs. An inscription from the first input lands on offset 0 unless its
// pointer says otherwise; one from a later input depends on input values this transaction does not carry.
function ownerOf(tx: RawTx, vin: number, pointer: number | null): Uint8Array | null {
  const total = tx.outputs.reduce((s, o) => s + o.value, 0);
  const offset = pointer !== null && pointer < total ? pointer : vin === 0 ? 0 : null;
  if (offset === null) return null;
  let end = 0;
  for (const o of tx.outputs) {
    end += o.value;
    if (offset < end) return o.script;
  }
  return null;
}

export function claimsInTx(tx: RawTx): TxClaim[] {
  const found: { vin: number; env: Envelope; key: string | null }[] = [];
  tx.witnesses.forEach((items, vin) => {
    const script = tapscript(items);
    if (!script || indexOf(script, MARK) === -1) return;
    const key = script[0] === 0x20 && script.length > 33 ? toHex(script.subarray(1, 33)) : null;
    for (const env of envelopes(script)) found.push({ vin, env, key });
  });
  const out: TxClaim[] = [];
  found.forEach(({ vin, env, key }, index) => {
    const n = claimNumber(env);
    if (n === null) return;
    const pointer = pointerOf(env);
    out.push({ n, index, vin, key, pointer, owner: ownerOf(tx, vin, pointer) });
  });
  return out;
}

export type BlockClaim = {
  n: number;
  txid: string;
  index: number;
  position: number;
  inscription: string;
  key: string | null;
  owner: Uint8Array | null;
};

export function claimsInBlock(block: Uint8Array, height: number): { claims: BlockClaim[]; sizes: number[] } {
  const claims: BlockClaim[] = [];
  const sizes: number[] = [];
  const marked = indexOf(block, MARK) !== -1;
  let position = 0;
  for (const tx of blockTxs(block)) {
    sizes.push(Math.ceil(tx.weight / 4));
    if (marked) {
      for (const c of claimsInTx(tx)) {
        if (c.n > height) continue;
        const txid = tx.txid();
        claims.push({ n: c.n, txid, index: c.index, position, inscription: `${txid}i${c.index}`, key: c.key, owner: c.owner });
      }
    }
    position++;
  }
  return { claims, sizes };
}

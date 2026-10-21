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

export type TxClaim = { n: number; index: number; vin: number; key: string | null };

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
    if (n !== null) out.push({ n, index, vin, key });
  });
  return out;
}

export type BlockClaim = { n: number; txid: string; index: number; position: number; inscription: string; key: string | null };

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
        claims.push({ n: c.n, txid, index: c.index, position, inscription: `${txid}i${c.index}`, key: c.key });
      }
    }
    position++;
  }
  return { claims, sizes };
}

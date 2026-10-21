import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex as toHex, concatBytes, hexToBytes as fromHex, sha256, utf8ToBytes as utf8 };

export const dsha256 = (b: Uint8Array): Uint8Array => sha256(sha256(b));

export function latin1(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

export function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  const last = hay.length - needle.length;
  outer: for (let i = hay.indexOf(first, from); i !== -1 && i <= last; i = hay.indexOf(first, i + 1)) {
    for (let k = 1; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

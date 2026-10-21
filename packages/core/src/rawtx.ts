import { concatBytes, dsha256, toHex } from './bytes.ts';

export type RawTx = {
  witnesses: Uint8Array[][];
  size: number;
  weight: number;
  txid: () => string;
};

function varint(b: Uint8Array, i: number): [number, number] {
  const n = b[i];
  if (n === undefined) throw new Error('truncated data');
  if (n < 0xfd) return [n, i + 1];
  const width = n === 0xfd ? 2 : n === 0xfe ? 4 : 8;
  let v = 0;
  for (let k = width; k >= 1; k--) v = v * 256 + b[i + k];
  return [v, i + 1 + width];
}

export function readTx(b: Uint8Array, start: number): [RawTx, number] {
  let i = start + 4;
  const segwit = b[i] === 0 && b[i + 1] === 1;
  if (segwit) i += 2;
  const bodyStart = i;
  let inputs: number, outputs: number, len: number;
  [inputs, i] = varint(b, i);
  for (let k = 0; k < inputs; k++) {
    i += 36;
    [len, i] = varint(b, i);
    i += len + 4;
  }
  [outputs, i] = varint(b, i);
  for (let k = 0; k < outputs; k++) {
    i += 8;
    [len, i] = varint(b, i);
    i += len;
  }
  const bodyEnd = i;
  const witnesses: Uint8Array[][] = [];
  if (segwit) {
    for (let k = 0; k < inputs; k++) {
      let count: number;
      [count, i] = varint(b, i);
      const items: Uint8Array[] = [];
      for (let m = 0; m < count; m++) {
        [len, i] = varint(b, i);
        items.push(b.subarray(i, i + len));
        i += len;
      }
      witnesses.push(items);
    }
  }
  const lockStart = i;
  i += 4;
  if (i > b.length) throw new Error('truncated transaction');
  const baseSize = 4 + (bodyEnd - bodyStart) + 4;
  const size = i - start;
  let id: string | undefined;
  const txid = () =>
    (id ??= toHex(
      dsha256(concatBytes(b.subarray(start, start + 4), b.subarray(bodyStart, bodyEnd), b.subarray(lockStart, i))).reverse(),
    ));
  return [{ witnesses, size, weight: baseSize * 3 + size, txid }, i];
}

export function parseTx(raw: Uint8Array): RawTx {
  const [tx, end] = readTx(raw, 0);
  if (end !== raw.length) throw new Error('trailing bytes after transaction');
  return tx;
}

export function* blockTxs(block: Uint8Array): Generator<RawTx> {
  let [count, i] = varint(block, 80);
  for (; count > 0; count--) {
    const [tx, end] = readTx(block, i);
    yield tx;
    i = end;
  }
}

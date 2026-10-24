import { base64 } from '@scure/base';
import { p2wpkh, Transaction } from '@scure/btc-signer';
import { fromHex } from './bytes.ts';
import { btcNetwork, dustLimit, type Network, outputScript, RBF_SEQUENCE } from './claim.ts';

// A deposit at the fee rate the player picks: the app chooses the coins and builds the transaction, and the wallet
// only signs it (a wallet's own "send" picks its own rate, often far above what the next block needs).

export type SpendCoin = { txid: string; vout: number; value: number };
export type Payer = { address: string; publicKey: string };
export type DepositPlan = { psbt: string; fee: number; vsize: number; inputs: number; change: number };

// The vsize each input type adds once signed.
const INPUT: Record<'wpkh' | 'sh-wpkh' | 'tr', number> = { wpkh: 68, 'sh-wpkh': 91, tr: 57.5 };

function kindOf(script: Uint8Array): keyof typeof INPUT | null {
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return 'wpkh';
  if (script.length === 23 && script[0] === 0xa9) return 'sh-wpkh';
  if (script.length === 34 && script[0] === 0x51) return 'tr';
  return null;
}

export function depositPsbt(p: { coins: SpendCoin[]; to: string; amount: number; payer: Payer; rate: number; network: Network }): DepositPlan {
  const pay = outputScript(p.payer.address, p.network);
  const kind = kindOf(pay);
  if (!kind) throw new Error('This wallet address type cannot pay a deposit at a chosen fee.');
  if (!(p.rate > 0)) throw new Error('Pick a deposit fee rate.');
  const to = outputScript(p.to, p.network);
  const out = (s: Uint8Array) => 9 + s.length;
  const base = 10.5 + out(to) + out(pay);
  const chosen: SpendCoin[] = [];
  let total = 0;
  let fee = 0;
  for (const c of [...p.coins].sort((a, b) => b.value - a.value)) {
    chosen.push(c);
    total += c.value;
    fee = Math.ceil(p.rate * Math.ceil(base + chosen.length * INPUT[kind]));
    if (total >= p.amount + fee) break;
  }
  if (total < p.amount + fee) throw new Error('Not enough confirmed coins for this deposit and its fee.');

  const pub = fromHex(p.payer.publicKey);
  const tx = new Transaction({ version: 2 });
  for (const c of chosen) {
    tx.addInput({
      txid: c.txid,
      index: c.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: { script: pay, amount: BigInt(c.value) },
      ...(kind === 'sh-wpkh' ? { redeemScript: p2wpkh(pub, btcNetwork(p.network)).script } : {}),
      ...(kind === 'tr' ? { tapInternalKey: pub.length === 33 ? pub.subarray(1) : pub } : {}),
    });
  }
  tx.addOutput({ script: to, amount: BigInt(p.amount) });
  let change = total - p.amount - fee;
  let vsize = base + chosen.length * INPUT[kind];
  if (change >= dustLimit(pay)) {
    tx.addOutput({ script: pay, amount: BigInt(change) });
  } else {
    fee += change;
    change = 0;
    vsize -= out(pay);
  }
  return { psbt: base64.encode(tx.toPSBT()), fee, vsize: Math.ceil(vsize), inputs: chosen.length, change };
}

// The finished transaction of a PSBT the wallet signed but did not broadcast.
export function finishPsbt(psbt: string): { hex: string; txid: string } {
  const tx = Transaction.fromPSBT(base64.decode(psbt));
  tx.finalize();
  return { hex: tx.hex, txid: tx.id };
}

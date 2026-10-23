import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Pools that take transactions privately (MARA Slipstream, SpiderPool's accelerator), and the text each one writes
// into its coinbase.
export const PRIVATE_POOLS: [string, string][] = [
  ['MARA Pool', 'MARA '],
  ['SpiderPool', 'SpiderPool'],
];

const OTHER_POOLS: [string, string][] = [
  ['Foundry USA', 'Foundry'],
  ['AntPool', 'AntPool'],
  ['F2Pool', 'F2Pool'],
  ['ViaBTC', 'ViaBTC'],
  ['SECPOOL', 'Secpool'],
  ['Luxor', 'Luxor'],
  ['OCEAN', 'OCEAN'],
  ['Braiins Pool', 'Braiins'],
  ['Binance Pool', 'binance'],
  ['SBI Crypto', 'SBICrypto'],
];

// The pool that mined a block, from its coinbase text.
export function poolOf(coinbase: string): string | null {
  const lower = coinbase.toLowerCase();
  for (const [name, mark] of [...PRIVATE_POOLS, ...OTHER_POOLS]) if (lower.includes(mark.toLowerCase())) return name;
  return null;
}

export const isPrivatePool = (pool: string | null) => PRIVATE_POOLS.some(([name]) => name === pool);

// Owners seen claiming before this server watched: every one of their claims in blocks 972,498 to 972,542 was mined by
// MARA Pool or SpiderPool without ever reaching a public mempool (mempool.space block audits list them as unseen).
const KNOWN: Record<string, string[]> = {
  mainnet: ['bc1qm4qm4uszjkwyn0syduwwurdvnnqp426z0f3fhg'],
};

// Ghosts: owners whose claims reach blocks without passing through the public mempool, so nobody can see them coming.
// An owner becomes one when its claim is mined by a private pool and this node never saw it in the mempool before.
export class Ghosts {
  private readonly owners = new Set<string>();

  constructor(
    private readonly file: string,
    network: string,
  ) {
    for (const o of KNOWN[network] ?? []) this.owners.add(o);
    if (existsSync(file)) for (const o of JSON.parse(readFileSync(file, 'utf8')) as string[]) this.owners.add(o);
  }

  has(owner: string | null): boolean {
    return owner !== null && this.owners.has(owner);
  }

  add(owner: string): boolean {
    if (this.owners.has(owner)) return false;
    this.owners.add(owner);
    try {
      writeFileSync(this.file, `${JSON.stringify([...this.owners], null, 1)}\n`);
    } catch {}
    return true;
  }
}

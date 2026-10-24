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

// A bitmap a ghost minted in a private pool's block, and the fee rate its claim paid. n is the newest number the
// claim won there (one claim can win several numbers).
export type PoolMint = { n: number; height: number; owner: string | null; txid: string; rate: number | null };

// A private pool's newest block and whether a ghost minted in it, with the latest ghost mints at that pool (oldest
// first), so their fee trend shows; height and ghost are null until a block of the pool is seen.
export type PoolStatus = { pool: string; height: number | null; ghost: boolean | null; wins: PoolMint[] };

const KEEP_WINS = 5;

// Ghosts: owners whose claims reach blocks without passing through the public mempool, so nobody can see them coming.
// An owner becomes one when its claim is mined by a private pool and this node never saw it in the mempool before.
export class Ghosts {
  private readonly owners = new Set<string>();
  private pools: Record<string, PoolStatus> = {};

  constructor(
    private readonly file: string,
    network: string,
    private readonly poolsFile?: string,
  ) {
    for (const o of KNOWN[network] ?? []) this.owners.add(o);
    if (existsSync(file)) for (const o of JSON.parse(readFileSync(file, 'utf8')) as string[]) this.owners.add(o);
    if (poolsFile && existsSync(poolsFile)) {
      for (const s of Object.values(JSON.parse(readFileSync(poolsFile, 'utf8')) as Record<string, PoolStatus>)) {
        if (Array.isArray(s.wins)) this.pools[s.pool] = s;
      }
    }
  }

  // Every private pool, in the order of PRIVATE_POOLS.
  get poolStatus(): PoolStatus[] {
    return PRIVATE_POOLS.map(([name]) => this.pools[name] ?? { pool: name, height: null, ghost: null, wins: [] });
  }

  status(pool: string): PoolStatus | null {
    return this.pools[pool] ?? null;
  }

  // A block of a private pool, with the ghost mint in it if any, read in any order: only a newer block changes the
  // pool's status, and every ghost mint joins the list once.
  sawBlock(pool: string, height: number, mint: PoolMint | null): void {
    const was = this.pools[pool];
    const newest = !was || height >= (was.height ?? -1);
    const wins = was?.wins ?? [];
    this.pools[pool] = {
      pool,
      height: newest ? height : was.height,
      ghost: newest ? mint !== null : was.ghost,
      wins: mint && !wins.some((w) => w.txid === mint.txid) ? [...wins, mint].sort((a, b) => a.height - b.height).slice(-KEEP_WINS) : wins,
    };
    if (!this.poolsFile) return;
    try {
      writeFileSync(this.poolsFile, `${JSON.stringify(this.pools, null, 1)}\n`);
    } catch {}
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

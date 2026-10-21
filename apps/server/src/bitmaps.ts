import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { BlockClaim } from '@bitmap-battle/core';

export type Claimed = { inscription: string; height: number };
export type Judged = BlockClaim & { valid: boolean | null };

type Saved = {
  network: string;
  knownFrom: number;
  scannedTo: number;
  hashes: Record<string, string>;
  claims: Record<string, [string, number]>;
};

const KEEP_HASHES = 30;

// Which bitmaps have a valid claim: the bitmap_index.py database when there is one, and every block scanned
// here after it. A bitmap is known to be free only when every block since its own was scanned.
export class Bitmaps {
  private readonly lookup: StatementSync | null = null;
  private readonly db: DatabaseSync | null = null;
  private dbNext = 0;
  private gaps: number[] = [];
  private readonly own = new Map<number, Claimed>();
  readonly hashes = new Map<number, string>();
  knownFrom = Infinity;
  scannedTo = -1;

  constructor(
    private readonly file: string,
    private readonly network: string,
    dbPath: string | null,
  ) {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
      if (saved.network === network) {
        this.knownFrom = saved.knownFrom;
        this.scannedTo = saved.scannedTo;
        for (const [h, hash] of Object.entries(saved.hashes)) this.hashes.set(Number(h), hash);
        for (const [n, [inscription, height]] of Object.entries(saved.claims)) this.own.set(Number(n), { inscription, height });
      }
    }
    if (dbPath) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare("SELECT v FROM meta WHERE k = 'next_height'").get() as { v: string } | undefined;
      const next = Number(row?.v ?? 0);
      if (this.scannedTo >= 0 && this.knownFrom > next) {
        this.own.clear();
        this.hashes.clear();
        this.scannedTo = -1;
      }
      this.lookup = db.prepare('SELECT inscription, block FROM claims WHERE bitmap = ?');
      this.db = db;
      this.dbNext = next;
      this.knownFrom = 0;
      this.scannedTo = Math.max(this.scannedTo, next - 1);
    }
  }

  get hasIndex(): boolean {
    return this.lookup !== null;
  }

  // The claim of n, null when n is known to be free, undefined when this server cannot tell.
  claimed(n: number): Claimed | null | undefined {
    const own = this.own.get(n);
    if (own) return own;
    if (this.lookup) {
      const row = this.lookup.get(n) as { inscription: string; block: number } | undefined;
      if (row) return { inscription: row.inscription, height: row.block };
    }
    return n >= this.knownFrom && n <= this.scannedTo + 1 ? null : undefined;
  }

  // The bitmaps the index has no claim for, below its last block: read once, it takes a few seconds.
  findGaps(): number {
    if (!this.db) return 0;
    const rows = this.db
      .prepare('SELECT c.bitmap + 1 AS n FROM claims c LEFT JOIN claims d ON d.bitmap = c.bitmap + 1 WHERE d.bitmap IS NULL AND c.bitmap + 1 < ?')
      .all(this.dbNext) as { n: number }[];
    const zero = this.db.prepare('SELECT 1 FROM claims WHERE bitmap = 0').get();
    this.gaps = [...(zero ? [] : [0]), ...rows.map((r) => r.n)];
    return this.gaps.length;
  }

  // Bitmaps up to the tip that are known to have no valid claim yet, newest first.
  unclaimed(tip: number, limit: number): number[] {
    const out: number[] = [];
    const from = this.db ? this.dbNext : Number.isFinite(this.knownFrom) ? this.knownFrom : tip + 1;
    for (let n = Math.min(tip, this.scannedTo); n >= from && out.length < limit; n--) if (!this.own.has(n)) out.push(n);
    for (let i = this.gaps.length - 1; i >= 0 && out.length < limit; i--) if (!this.own.has(this.gaps[i])) out.push(this.gaps[i]);
    return out;
  }

  start(height: number): void {
    if (this.scannedTo < 0) {
      this.knownFrom = height;
      this.scannedTo = height - 1;
    }
  }

  apply(height: number, hash: string, claims: BlockClaim[], save = true): Judged[] {
    const judged: Judged[] = [];
    for (const c of claims) {
      const before = this.claimed(c.n);
      const valid = before === undefined ? null : before === null;
      if (valid) this.own.set(c.n, { inscription: c.inscription, height });
      judged.push({ ...c, valid });
    }
    this.scannedTo = height;
    this.hashes.set(height, hash);
    this.hashes.delete(height - KEEP_HASHES);
    if (save) this.save();
    return judged;
  }

  undo(from: number): void {
    for (const [n, c] of this.own) if (c.height >= from) this.own.delete(n);
    for (const h of [...this.hashes.keys()]) if (h >= from) this.hashes.delete(h);
    this.scannedTo = from - 1;
    this.save();
  }

  save(): void {
    const saved: Saved = {
      network: this.network,
      knownFrom: Number.isFinite(this.knownFrom) ? this.knownFrom : 0,
      scannedTo: this.scannedTo,
      hashes: Object.fromEntries(this.hashes),
      claims: Object.fromEntries([...this.own].map(([n, c]) => [n, [c.inscription, c.height]])),
    };
    const text = JSON.stringify(saved);
    try {
      writeFileSync(`${this.file}.tmp`, text);
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      writeFileSync(this.file, text);
    }
  }
}

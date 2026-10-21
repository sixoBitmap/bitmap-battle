import { createHash } from 'node:crypto';

export const tagOf = (player: string) => createHash('sha256').update(player).digest('hex').slice(0, 12);

export const validPlayer = (p: unknown): p is string => typeof p === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(p);

type Seat = { n: number; player: string; ip: string; tag: string; since: number; funded: string | null; seen: number };

const UNFUNDED_LIFE = 3 * 60_000;
const SEATS_PER_PLAYER = 2;
const UNFUNDED_PER_IP = 2;

// One app player per bitmap: players fight outsiders, never each other.
export class Seats {
  private readonly seats = new Map<number, Seat>();

  numbers(): number[] {
    return [...this.seats.keys()];
  }

  holder(n: number): string | null {
    return this.seats.get(n)?.tag ?? null;
  }

  take(n: number, player: string, ip: string): 'ok' | 'taken' | 'limit' {
    const seat = this.seats.get(n);
    if (seat) {
      if (seat.player !== player) return 'taken';
      seat.seen = Date.now();
      return 'ok';
    }
    const all = [...this.seats.values()];
    if (all.filter((s) => s.player === player).length >= SEATS_PER_PLAYER) return 'limit';
    if (all.filter((s) => s.ip === ip && !s.funded).length >= UNFUNDED_PER_IP) return 'limit';
    const now = Date.now();
    this.seats.set(n, { n, player, ip, tag: tagOf(player), since: now, funded: null, seen: now });
    return 'ok';
  }

  release(n: number, player: string): boolean {
    if (this.seats.get(n)?.player !== player) return false;
    this.seats.delete(n);
    return true;
  }

  fund(n: number, player: string, txid: string): boolean {
    const seat = this.seats.get(n);
    if (seat?.player !== player) return false;
    seat.funded = txid;
    seat.seen = Date.now();
    return true;
  }

  touch(player: string): void {
    const now = Date.now();
    for (const s of this.seats.values()) if (s.player === player) s.seen = now;
  }

  // Frees seats nobody uses any more: unfunded ones left alone for a while, and those of finished battles.
  sweep(over: (n: number) => boolean): void {
    const now = Date.now();
    for (const [n, s] of this.seats) {
      if (over(n) || (!s.funded && now - s.seen > UNFUNDED_LIFE)) this.seats.delete(n);
    }
  }
}

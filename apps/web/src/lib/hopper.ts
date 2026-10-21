// The tip cube's moves: it stands on top of page elements and hops between them with squash and stretch.
// The app never scrolls, so screen coordinates are page coordinates. Everything runs on two DOM nodes with
// requestAnimationFrame, so React never re-renders for a frame.

export const CUBE = 22;

const PLATFORMS =
  'main .roll, main .bar, main .pill, main .number, main .status, main .table-head, main .outcome-title, main .empty, main .note, main h2, main .side-box, main .fame';

// Controls a tap must never reach by accident when the cube hops away from under a finger: the cube only lands
// where its body and a margin around it touch none of them, and never near the dock with the battle buttons.
const CONTROLS =
  'button:not(.cube), input, select, label, a, .big, .chip, .tip-amount, .leave, .wallet, .icon';
const HALO = 14;

type Point = { x: number; y: number };
type Spot = { el: Element; at: Point };

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export class Hopper {
  private pos: Point = { x: -100, y: -100 };
  private on: Element | null = null;
  private timer = 0;
  private frame = 0;
  private blinker = 0;
  private paused = false;
  private flying = false;
  private stopped = false;

  constructor(
    private readonly wrap: HTMLElement,
    private readonly body: HTMLElement,
  ) {}

  start(): void {
    this.land();
    this.schedule(900);
    this.blinker = window.setInterval(() => this.idle(), 2600);
    window.addEventListener('hashchange', this.soon);
    window.addEventListener('resize', this.land);
    document.addEventListener('pointerdown', this.rest, true);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.blinker);
    cancelAnimationFrame(this.frame);
    window.removeEventListener('hashchange', this.soon);
    window.removeEventListener('resize', this.land);
    document.removeEventListener('pointerdown', this.rest, true);
  }

  pause(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.schedule(1200);
  }

  // A happy little spin in place, for taps and thank-yous.
  cheer(): void {
    if (this.flying) return;
    this.jump({ ...this.pos }, 70, 520, 360, () => this.schedule());
  }

  private soon = () => this.schedule(350);

  // While someone taps around the page the cube sits still.
  private rest = () => {
    if (!this.paused && !this.flying) this.schedule(12000 + Math.random() * 6000);
  };

  private choices(): Spot[] {
    if (document.querySelector('.modal-bg, .win')) return [];
    const dock = document.querySelector('main .dock')?.getBoundingClientRect().top ?? window.innerHeight;
    const top = 64;
    const bottom = Math.min(window.innerHeight - 90, dock - 30);
    const blocked = [...document.querySelectorAll(CONTROLS)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    const out: Spot[] = [];
    for (const el of document.querySelectorAll(PLATFORMS)) {
      if (el === this.on || el.closest('.modal-bg, .win, .toasts, .dock')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.top - CUBE - HALO < top || r.top > bottom) continue;
      for (let i = 0; i < 6; i++) {
        const x = Math.min(Math.max(4, r.left + 4 + Math.random() * Math.max(0, r.width - CUBE - 8)), window.innerWidth - CUBE - 4);
        const y = r.top - CUBE;
        const clear = !blocked.some((k) => x - HALO < k.right && x + CUBE + HALO > k.left && y - HALO < k.bottom && y + CUBE + HALO > k.top);
        if (clear) {
          out.push({ el, at: { x, y } });
          break;
        }
      }
    }
    return out;
  }

  private land = () => {
    const found = this.choices();
    if (found.length) {
      const c = pick(found);
      this.on = c.el;
      this.pos = c.at;
    } else {
      this.pos = { x: window.innerWidth - CUBE - 24, y: 70 };
    }
    this.draw(1, 1, 0);
  };

  private schedule(ms = 8000 + Math.random() * 8000): void {
    clearTimeout(this.timer);
    if (!this.stopped) this.timer = window.setTimeout(() => this.hop(), ms);
  }

  private hop(): void {
    if (this.paused || this.flying || document.hidden) return this.schedule();
    const found = this.choices();
    if (!found.length) return this.schedule();
    const near = found
      .map((c) => ({ ...c, d: Math.hypot(c.at.x - this.pos.x, c.at.y - this.pos.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    const { el: next, at: to } = pick(near);
    const dist = Math.hypot(to.x - this.pos.x, to.y - this.pos.y);
    const height = Math.min(220, Math.max(45, dist * 0.45));
    const flight = Math.min(1100, Math.max(460, 380 + dist * 0.9));
    const flip = Math.random() < 0.22 ? (to.x >= this.pos.x ? 360 : -360) : 0;
    this.jump(to, height, flight, flip, () => {
      this.on = next;
      this.schedule();
    });
  }

  private jump(to: Point, height: number, flight: number, flip: number, done: () => void): void {
    const from = { ...this.pos };
    const crouch = 150;
    const settle = 460;
    const peak = Math.min(from.y, to.y) - height;
    const control = 2 * peak - (from.y + to.y) / 2;
    this.body.dataset.look = to.x < from.x - 2 ? 'left' : to.x > from.x + 2 ? 'right' : '';
    this.flying = true;
    const start = performance.now();
    const step = (now: number) => {
      const t = now - start;
      if (t < crouch) {
        const k = Math.sin(((t / crouch) * Math.PI) / 2);
        this.draw(1 + 0.32 * k, 1 - 0.38 * k, 0);
      } else if (t < crouch + flight) {
        const u = (t - crouch) / flight;
        this.pos = { x: from.x + (to.x - from.x) * u, y: (1 - u) ** 2 * from.y + 2 * u * (1 - u) * control + u * u * to.y };
        const speed = Math.abs(2 * (1 - u) * (control - from.y) + 2 * u * (to.y - control)) / flight;
        const stretch = Math.min(0.38, speed * 0.9);
        this.draw(1 - stretch * 0.55, 1 + stretch, flip * ease(u));
      } else if (t < crouch + flight + settle) {
        this.pos = to;
        const v = (t - crouch - flight) / settle;
        const s = 0.42 * Math.exp(-5 * v) * Math.cos(v * Math.PI * 3.2);
        this.draw(1 + s, 1 - s, 0);
      } else {
        this.draw(1, 1, 0);
        this.flying = false;
        done();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private idle(): void {
    if (this.flying) return;
    if (Math.random() < 0.7) {
      this.body.classList.add('blink');
      setTimeout(() => this.body.classList.remove('blink'), 140);
    } else {
      this.body.dataset.look = pick(['left', 'right', '']);
    }
  }

  private draw(sx: number, sy: number, rotate: number): void {
    this.wrap.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
    this.body.style.transform = `rotate(${rotate}deg) scale(${sx}, ${sy})`;
  }
}

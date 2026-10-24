import { useEffect, useRef, useState } from 'react';
import { runCommand } from '../lib/commands.ts';
import { Hopper } from '../lib/hopper.ts';
import { line, type Moment, type Mood, mood, onMoment, onSpeak } from '../lib/mood.ts';
import { sfx } from '../lib/sound.ts';
import { TIPPED, TipSheet } from './Tip.tsx';

const SAY_FOR = 4800;

// The changes of your battle worth a word on their own; the rest it only talks about when tapped.
const IMPORTANT = new Set<Mood>(['mint', 'won', 'lost', 'left']);

// The arena's little orange mascot: it hops between page elements, speaks when tapped or when something important
// happens in your battle (a new block, your coins in, outbid, the lead, the result), and takes tips.
export function Cube({ tips }: { tips: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLButtonElement>(null);
  const hopper = useRef<Hopper | null>(null);
  const [open, setOpen] = useState(false);
  const [hearts, setHearts] = useState<number[]>([]);
  const [said, setSaid] = useState<{ text: string; id: number } | null>(null);
  const [side, setSide] = useState<'mid' | 'left' | 'right'>('mid');
  const current = mood.use();
  const lastLine = useRef('');
  const hide = useRef(0);
  const [asking, setAsking] = useState(false);
  const press = useRef(0);
  const held = useRef(false);

  const say = (key: Parameters<typeof line>[0], exact?: string) => {
    const text = exact ?? line(key, lastLine.current);
    lastLine.current = text;
    const x = wrap.current?.getBoundingClientRect().left ?? 200;
    setSide(x < 110 ? 'left' : x > window.innerWidth - 130 ? 'right' : 'mid');
    setSaid({ text, id: Date.now() });
    clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setSaid(null), exact ? SAY_FOR * 2 : SAY_FOR);
  };

  useEffect(() => {
    if (!wrap.current || !body.current) return;
    const h = new Hopper(wrap.current, body.current);
    hopper.current = h;
    h.start();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) h.pause(true);
    const thanks = () => {
      burst();
      h.cheer();
      say('thanks');
    };
    window.addEventListener(TIPPED, thanks);
    const off = onMoment((m: Moment) => {
      if (m === 'lead' || m === 'block') h.cheer();
      say(m);
    });
    const offSpeak = onSpeak((text) => {
      h.cheer();
      say('tap', text);
    });
    return () => {
      window.removeEventListener(TIPPED, thanks);
      off();
      offSpeak();
      h.stop();
      clearTimeout(hide.current);
    };
  }, []);

  const before = useRef(current);
  useEffect(() => {
    if (current !== before.current && IMPORTANT.has(current)) say(current);
    before.current = current;
  }, [current]);

  useEffect(() => {
    if (!said) return;
    const follow = window.setInterval(() => {
      const x = wrap.current?.getBoundingClientRect().left ?? 200;
      setSide(x < 110 ? 'left' : x > window.innerWidth - 130 ? 'right' : 'mid');
    }, 120);
    return () => clearInterval(follow);
  }, [said]);

  const burst = () => {
    const id = Date.now();
    setHearts((all) => [...all, id]);
    setTimeout(() => setHearts((all) => all.filter((x) => x !== id)), 1000);
  };

  // A right-click (or a long press on a phone) turns the bubble into a field for a secret word; the word works as soon
  // as it is typed, with nothing to submit.
  const ask = () => {
    clearTimeout(hide.current);
    setSaid(null);
    const x = wrap.current?.getBoundingClientRect().left ?? 200;
    setSide(x < 110 ? 'left' : x > window.innerWidth - 130 ? 'right' : 'mid');
    setAsking(true);
    hopper.current?.pause(true);
  };

  const stopAsking = () => {
    setAsking(false);
    hopper.current?.pause(false);
  };

  const hold = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    held.current = false;
    clearTimeout(press.current);
    press.current = window.setTimeout(() => {
      held.current = true;
      ask();
    }, 550);
  };

  const tap = () => {
    if (held.current) {
      held.current = false;
      return;
    }
    sfx.coin();
    burst();
    hopper.current?.cheer();
    say(current);
    if (!tips) return;
    hopper.current?.pause(true);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    hopper.current?.pause(false);
  };

  return (
    <>
      <div className="cube-wrap" ref={wrap}>
        {asking ? (
          <div className={`bubble ${side} ask`}>
            <input
              autoFocus
              aria-label="Say the word"
              placeholder="psst…"
              onChange={(e) => {
                if (runCommand(e.target.value)) {
                  sfx.coin();
                  stopAsking();
                }
              }}
              onKeyDown={(e) => e.key === 'Escape' && stopAsking()}
              onBlur={stopAsking}
            />
          </div>
        ) : (
          said && (
            <div key={said.id} className={`bubble ${side}`} role="status">
              {said.text}
            </div>
          )
        )}
        <button
          className="cube"
          ref={body}
          onClick={tap}
          onContextMenu={(e) => {
            e.preventDefault();
            ask();
          }}
          onPointerDown={hold}
          onPointerUp={() => clearTimeout(press.current)}
          onPointerLeave={() => clearTimeout(press.current)}
          onPointerCancel={() => clearTimeout(press.current)}
          aria-label={tips ? 'Send a tip' : 'Say hi'}
        >
          <i className="eye l" />
          <i className="eye r" />
        </button>
        {hearts.map((id) => (
          <span key={id} className="hearts" aria-hidden>
            <i>🧡</i>
            <i>🧡</i>
            <i>🧡</i>
          </span>
        ))}
      </div>
      {open && <TipSheet onClose={close} />}
    </>
  );
}

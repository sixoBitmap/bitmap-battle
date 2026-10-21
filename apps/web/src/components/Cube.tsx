import { useEffect, useRef, useState } from 'react';
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

  const tap = () => {
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
        {said && (
          <div key={said.id} className={`bubble ${side}`} role="status">
            {said.text}
          </div>
        )}
        <button className="cube" ref={body} onClick={tap} aria-label={tips ? 'Send a tip' : 'Say hi'}>
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

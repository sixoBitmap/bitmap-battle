import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.ts';
import { num } from '../lib/format.ts';
import { music } from '../lib/music.ts';
import { sfx } from '../lib/sound.ts';

export default function Win({ n, height, onClose }: { n: number; height: number; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    music.duck(true);
    return () => music.duck(false);
  }, []);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const sizes = await api.sizes(height).catch(() => [] as number[]);
      const { startVolcano } = await import('../volcano/scene.ts');
      if (cancelled || !canvas.current) return;
      stop = startVolcano(canvas.current, sizes);
      sfx.win();
      setTimeout(() => !cancelled && setShown(true), 700);
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [height]);

  // Rendered on the page itself, so the scroll's paper (its mask and shadow) cannot clip the full-screen scene.
  return createPortal(
    <div className="win">
      <canvas ref={canvas} />
      {shown && (
        <div className="win-title">
          {num(n)}
          <small>.bitmap</small>
        </div>
      )}
      <div className={`win-text ${shown ? 'shown' : ''}`}>
        <button className="big gold" onClick={onClose}>
          VICTORIA!
        </button>
      </div>
    </div>,
    document.body,
  );
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { Backdrop } from './components/Backdrop.tsx';
import { Battles } from './components/Battles.tsx';
import { Cube } from './components/Cube.tsx';
import { Fame } from './components/Fame.tsx';
import { DevPanel } from './components/DevPanel.tsx';
import { Rules } from './components/How.tsx';
import { RiskGate } from './components/RiskGate.tsx';
import { Table } from './components/Table.tsx';
import { WalletButton } from './components/WalletButton.tsx';
import { battles } from './lib/battles.ts';
import { num, who } from './lib/format.ts';
import { live, onBlock } from './lib/live.ts';
import { moment } from './lib/mood.ts';
import { disablePush, enablePush, pushOn, pushSupported } from './lib/push.ts';
import { go, useRoute } from './lib/route.ts';
import { type SoundMode, soundMode, sfx } from './lib/sound.ts';
import { fail, toast, toasts } from './lib/toast.ts';

const Win = lazy(() => import('./components/Win.tsx'));

const NEXT_MODE: Record<SoundMode, SoundMode> = { all: 'effects', effects: 'off', off: 'all' };
const MODE_ICON: Record<SoundMode, string> = { all: '🎶', effects: '🔊', off: '🔇' };
const MODE_LABEL: Record<SoundMode, string> = { all: 'Music and sounds on', effects: 'Sounds only', off: 'Silent' };

function Bell({ vapidKey }: { vapidKey: string }) {
  const on = pushOn.use();
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    if (!pushSupported()) {
      toast(/iPhone|iPad/.test(navigator.userAgent) ? 'Battle alerts: add the app to your home screen first.' : 'Battle alerts need the app over https.');
      return;
    }
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        toast('Battle alerts are off');
      } else {
        await enablePush(vapidKey);
        toast('You will hear about new battles', 'good');
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`icon ${on ? 'lit' : ''}`} onClick={flip} disabled={busy} aria-label={on ? 'Battle alerts on' : 'Turn on battle alerts'}>
      {on ? '🔔' : '🔕'}
    </button>
  );
}

function HallOfFame() {
  const { state } = live.use();
  if (!state) return null;
  return (
    <div className="side-box">
      <h3>Hall of fame</h3>
      {state.results.slice(0, 6).map((r) => {
        const winner = r.claims.find((c) => c.n === r.height && c.valid);
        const fights = r.claims.filter((c) => c.n === r.height).length;
        return winner ? (
          <div key={r.height} className="fame">
            <b>{num(r.height)}</b>
            <span>{`${who(winner.key).icon} ${who(winner.key).name}`}</span>
            {fights > 1 && <em>⚔ {fights}</em>}
          </div>
        ) : (
          <a key={r.height} className="fame" href={`#/table/${r.height}`}>
            <b>{num(r.height)}</b>
            <span>unclaimed</span>
            <em>{state.tables.some((t) => t.n === r.height && t.claims.length > 0) ? 'FIGHT ⚔' : 'MINT ⚡'}</em>
          </a>
        );
      })}
    </div>
  );
}

const SOURCE = 'https://github.com/sixoBitmap/bitmap-battle';

export function App() {
  const route = useRoute();
  const { config, state, connected } = live.use();
  const all = battles.use();
  const active = all.find((b) => b.outcome === null) ?? null;
  const mode = soundMode.use();
  const [demo, setDemo] = useState(true);
  const ready = state && config && state.tip.height >= 0;
  const purse = route.page === 'me';
  const fame = route.page === 'fame';
  const n = route.page === 'table' ? route.n : (active?.n ?? (state ? state.tip.height + 1 : 0));

  useEffect(() => {
    const off = onBlock(() => {
      sfx.block();
      moment('block');
    });
    return () => {
      off();
    };
  }, []);

  return (
    <div className="world">
      <Backdrop />
      <header className="topbar">
        <a className="brand" href="#/" aria-label="Bitmap Battle arena">
          <span className="logo-mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="brand-text">
            Bitmap <b>Battle</b>
          </span>
        </a>
        <div className="top-right">
          <span className={`block-no ${connected ? 'on' : ''}`} title={connected ? 'Live' : 'Reconnecting'}>
            {state && state.tip.height >= 0 ? `#${num(state.tip.height)}` : '…'}
          </span>
          {config && <Bell vapidKey={config.vapidKey} />}
          <button
            className="icon"
            onClick={() => {
              const next = NEXT_MODE[mode];
              soundMode.set(next);
              toast(MODE_LABEL[next]);
            }}
            aria-label={`${MODE_LABEL[mode]}. Tap to change`}
          >
            {MODE_ICON[mode]}
          </button>
          <WalletButton />
        </div>
      </header>

      {config?.network && config.network !== 'mainnet' && (
        <div className="testnet">{config.dev ? 'Test mode: play money on regtest' : `${config.network}: test coins`}</div>
      )}

      <main className="stage">
        <aside className="side left">
          <div className="side-box">
            <h3>Bitmap Battle</h3>
            <p>
              Every new block opens a battle for its bitmap. Deposit a purse, <b>MINT</b> your claim, <b>RAISE</b> when a challenger outbids
              you. The first claim mined wins the bitmap.
            </p>
            <p>You sign everything yourself. The arena master never holds your coins.</p>
          </div>
        </aside>

        <section className="board">
          <div className="roll top" aria-hidden />
          <div className="board-body">
            <nav className="board-tabs">
              <a href="#/" className={purse || fame ? '' : 'on'}>
                Arena
              </a>
              <a href="#/me" className={purse ? 'on' : ''}>
                Purse{active ? ' ⚔' : ''}
              </a>
              <a href="#/fame" className={`fame-tab ${fame ? 'on' : ''}`}>
                Fame
              </a>
            </nav>
            {!ready ? (
              <div className="loading">
                <div className="spinner" />
                Opening the arena gates…
              </div>
            ) : purse ? (
              <Battles />
            ) : fame ? (
              <Fame />
            ) : (
              <Table key={n} n={n} />
            )}
          </div>
          <div className="roll bottom" aria-hidden />
        </section>

        <aside className="side right">
          <HallOfFame />
          <div className="side-box">
            <h3>Links</h3>
            <a href="#/how">📜 Rules of the arena</a>
            <a href="#/me">👛 Your purse and backups</a>
          </div>
        </aside>
      </main>

      <footer className="foot">
        <a href="#/how">Rules</a>
        <span>18+ only</span>
        <a href={SOURCE} target="_blank" rel="noopener">
          MIT open source
        </a>
      </footer>

      {route.page === 'how' && <Rules onClose={() => go('#/')} />}
      {route.page === 'volcano' && ready && demo && (
        <Suspense fallback={null}>
          <Win n={state.tip.height} height={state.tip.height} onClose={() => setDemo(false)} />
        </Suspense>
      )}
      {config?.dev && <DevPanel />}
      {ready && <Cube tips={Boolean(config.tipAddress)} />}
      <RiskGate />
      <div className="toasts">
        {toasts.use().map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

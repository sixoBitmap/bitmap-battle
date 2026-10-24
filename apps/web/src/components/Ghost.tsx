import { commitFor, fromHex, ghostCosts } from '@bitmap-battle/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api, type GhostRunView, type PrivateInfo } from '../lib/api.ts';
import { type Battle, battles, fund, GHOST_REFUNDS, ghostPlan, joinGhost, locateDeposit, remove, startGhost, stopGhost, syncGhost } from '../lib/battles.ts';
import { num, rate, sats } from '../lib/format.ts';
import { planBudgets } from '../lib/funds.ts';
import { useCoins } from '../lib/hooks.ts';
import { live, onBlock } from '../lib/live.ts';
import { player } from '../lib/player.ts';
import { go } from '../lib/route.ts';
import { fail, toast } from '../lib/toast.ts';
import { wallet } from '../lib/wallet.ts';
import { Tx } from './Addr.tsx';
import { useConnect } from './WalletButton.tsx';

const Win = lazy(() => import('./Win.tsx'));

const STARTS = [4, 5, 6];
const EXTRAS = [1, 2, 3];
const LENGTHS = [12, 24, 48];
// The share of blocks the private pool mines (MARA: about one in twenty last week).
const PRIVATE_SHARE = 0.05;

const pct = (x: number) => `${Math.round(x * 100)}%`;

// Addresses like a wallet's, to price a run before one is connected: Taproot for the bitmap, Native SegWit to pay.
const sample = (network: 'mainnet' | 'regtest') => ({
  ordinals: commitFor(fromHex('02'.repeat(32)), 1, network).address,
  payment: network === 'mainnet' ? 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' : 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
});

// A ghost run: the newest bitmap chased block after block through a private pool, from one deposit.
export function Ghost() {
  const all = battles.use();
  const [fresh, setFresh] = useState(false);
  const latest = all.find((b) => b.ghost) ?? null;
  if (latest && (latest.outcome === null || !fresh)) return <GhostRun b={latest} onNew={() => setFresh(true)} />;
  return <GhostSetup />;
}

function GhostSetup() {
  const { state, config } = live.use();
  const w = wallet.use();
  const { run: connect, busy: connecting } = useConnect();
  const [info, setInfo] = useState<PrivateInfo | null>(null);
  const [start, setStart] = useState(5);
  const [custom, setCustom] = useState('');
  const [extra, setExtra] = useState(3);
  const [count, setCount] = useState(24);
  const [busy, setBusy] = useState(false);
  const [coins] = useCoins(w, config);

  useEffect(() => {
    const read = () => api.privateInfo().then(setInfo, () => setInfo(null));
    read();
    const off = onBlock(read);
    return () => {
      off();
    };
  }, []);

  if (!state || !config) return null;
  if (!config.privatePool) {
    return (
      <div className="page ghost-page">
        <h2>👻 Ghost mint</h2>
        <p className="muted">This server has no private pool to send claims through.</p>
      </div>
    );
  }

  const startRate = custom ? Number(custom) : start;
  const floor = info?.floor ?? null;
  const ghosts = (info?.recent ?? []).map((r) => r.rate).filter((r): r is number => r !== null);
  const topGhost = ghosts.length ? Math.max(...ghosts) : null;
  const plan = ghostPlan(state.tip.height, startRate, extra, count);
  const net = config.network === 'mainnet' ? 'mainnet' : 'regtest';
  const to = w ? { ordinals: w.ordinals.address, payment: w.payment.address } : sample(net);
  const costs = Number.isFinite(startRate) && startRate > 0 ? ghostCosts(plan, config.network, to.ordinals, to.payment) : null;
  const deposit = costs?.deposit ?? null;
  const refundRate = GHOST_REFUNDS.find((r) => r >= Math.max(state.rates.nextBlock, state.rates.minRelay) + 0.1) ?? GHOST_REFUNDS.at(-1)!;
  const refund = costs ? Math.ceil(refundRate * costs.refundSize) : null;
  const about = w ? '' : '≈ ';
  const funds = w && coins && coins !== 'error' ? planBudgets(w, coins, state.rates, config.postage) : null;
  const problem = !(startRate > 0)
    ? 'Pick a start fee'
    : floor !== null && startRate < floor
      ? `The private floor is ${floor} sat/vB right now`
      : state.ghostRun
        ? 'Another ghost run is chasing on this server'
        : funds && deposit !== null && deposit > funds.spendable
          ? `Your purse needs ${sats(deposit)} confirmed`
          : null;

  const begin = () => {
    if (!w) {
      void connect();
      return;
    }
    if (busy || problem) return;
    setBusy(true);
    (async () => {
      await api.ghostSeat(player);
      const b = joinGhost(plan, w, config);
      try {
        await fund(b.id, w);
      } catch (e) {
        remove(b.id);
        throw e;
      }
      toast('Deposit sent. The chase starts once it confirms.', 'good');
    })()
      .catch((e) => {
        void api.ghostRelease(player);
        fail(e);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="page ghost-page">
      <h2>👻 Ghost mint</h2>
      <p className="muted">
        Claims go privately to {config.privatePool} and chase the newest bitmap every block, even with this page closed. Only the claim that
        gets mined pays.
      </p>
      <div className="ghost-facts">
        <span>
          Private floor <b>{floor === null ? '…' : rate(floor)}</b>
        </span>
        <span>
          Ghosts paid <b>{topGhost === null ? '—' : rate(topGhost)}</b>
        </span>
      </div>
      <div className="ghost-picks">
        <span>Start sat/vB</span>
        <div>
          {STARTS.map((s) => (
            <button key={s} type="button" className={`pick ${!custom && start === s ? 'on' : ''}`} onClick={() => (setStart(s), setCustom(''))}>
              {s}
            </button>
          ))}
          <input className="pick" inputMode="decimal" placeholder="other" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <span title="Only when the private floor or a public claim asks for more">Can rise</span>
        <div>
          {EXTRAS.map((x) => (
            <button key={x} type="button" className={`pick ${extra === x ? 'on' : ''}`} onClick={() => setExtra(x)}>
              +{x}
            </button>
          ))}
        </div>
        <span>Chase blocks</span>
        <div>
          {LENGTHS.map((k) => (
            <button key={k} type="button" className={`pick ${count === k ? 'on' : ''}`} onClick={() => setCount(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>
      {costs && refund !== null && (
        <dl className="ghost-costs">
          <dt>Deposit</dt>
          <dd>
            <b>
              {about}
              {sats(costs.deposit)}
            </b>{' '}
            what you don't pay comes back
          </dd>
          <dt>If you win</dt>
          <dd>
            you pay{' '}
            <b>
              {about}
              {num(costs.first)}–{sats(costs.last)}
            </b>{' '}
            · max {sats(costs.most)}
          </dd>
          <dt>If not</dt>
          <dd>
            you pay{' '}
            <b>
              ≈ {sats(refund)}
            </b>{' '}
            to get it back
          </dd>
          <dt>Chance</dt>
          <dd>
            up to <b>{pct(1 - (1 - PRIVATE_SHARE) ** count)}</b> in {count} blocks
          </dd>
        </dl>
      )}
      <button className="big go" onClick={begin} disabled={busy || connecting || (w !== null && problem !== null)}>
        {busy ? 'OPENING WALLET…' : !w ? 'CONNECT WALLET' : '👻 START THE GHOST RUN'}
        <small>{w && problem ? problem : `numbers ${num(plan.first)}–${num(plan.first + count - 1)}`}</small>
      </button>
    </div>
  );
}

function GhostRun({ b, onNew }: { b: Battle; onNew: () => void }) {
  const { state } = live.use();
  const [run, setRun] = useState<GhostRunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const lastError = useRef('');

  useEffect(() => {
    let alive = true;
    const step = async () => {
      try {
        if (b.deposit && b.deposit.vout === null) await locateDeposit(b.id);
        const now = battles.get().find((x) => x.id === b.id);
        if (now?.deposit?.vout != null && !now.ghost?.started) await startGhost(b.id);
        const r = await syncGhost(b.id);
        if (!alive || !r) return;
        setRun(r);
        if (r.state === 'won' && now?.outcome === null) setCelebrate(true);
        lastError.current = '';
      } catch (e) {
        const message = (e as Error).message;
        if (message !== lastError.current) fail(e);
        lastError.current = message;
      }
    };
    void step();
    const t = setInterval(step, 4000);
    const off = onBlock(() => void step());
    return () => {
      alive = false;
      clearInterval(t);
      off();
    };
  }, [b.id]);

  if (!state || !b.ghost) return null;
  const { first, count, start, extra } = b.ghost;
  const last = first + count - 1;
  const lastSent = run?.sent.at(-1) ?? null;
  const open = b.outcome === null;
  const status = !b.deposit
    ? 'No deposit yet'
    : b.deposit.vout === null
      ? 'Your deposit is on its way…'
      : !run || run.state === 'waiting'
        ? `Waiting for the deposit to confirm. The chase starts at #${num(first)}.`
        : run.state === 'chasing'
          ? run.stopped
            ? 'Stopping: your sats are on their way back. The last claim can still win this block.'
            : lastSent
              ? `👻 Waiting at the private pool for #${num(lastSent.n)} · try ${run.sent.length} of ${count}`
              : `Chasing from #${num(Math.max(first, state.tip.height + 1))}`
          : run.state === 'won'
            ? `🏆 You won ${num(lastSent?.n ?? b.n)}.bitmap!`
            : run.state === 'refunded'
              ? 'The run is over: your sats are back.'
              : `Lost: ${run.note || 'another claim came first'}`;

  const stop = () => {
    if (!confirm('Stop the ghost run? Your deposit goes back to your wallet. The claim already waiting can still win this block.')) return;
    setBusy(true);
    stopGhost(b.id)
      .then((r) => (setRun(r), toast('Stopping the run', 'good')), fail)
      .finally(() => setBusy(false));
  };

  return (
    <div className="page ghost-page">
      <h2>👻 Ghost run</h2>
      <div className={`status ghost-status ${run?.state ?? ''}`}>{status}</div>
      <div className="ghost-facts">
        <span>
          Numbers <b>{num(first)}</b>–<b>{num(last)}</b>
        </span>
        <span>
          From <b>{rate(start)}</b>, +{extra} max
        </span>
        {lastSent && (
          <span>
            Now <b>{rate(lastSent.rate)}</b> · {sats(lastSent.fee)}
          </span>
        )}
      </div>
      {run?.note && open && <p className="muted">{run.note}</p>}
      <div className="list ghost-log">
        {b.deposit && <Tx name="Deposit" id={b.deposit.txid} extra={sats(b.deposit.amount)} />}
        {[...(run?.sent ?? [])]
          .reverse()
          .slice(0, 6)
          .map((s) => (
            <Tx key={s.txid} name={`Claim ${num(s.n)}`} id={s.txid} extra={`${sats(s.fee)} · ${rate(s.rate)}`} />
          ))}
        {run?.refund && <Tx name="Sats back" id={run.refund.txid} extra={sats(run.refund.fee)} />}
      </div>
      {open ? (
        <button className="leave" onClick={stop} disabled={busy || !b.ghost.started || run?.stopped}>
          Stop and take my sats back
        </button>
      ) : (
        <div className="buttons">
          <button className="big go" onClick={onNew}>
            👻 NEW GHOST RUN
          </button>
          <button className="big" onClick={() => go('#/')}>
            ⚔ ARENA
          </button>
        </div>
      )}
      {celebrate && run && (
        <Suspense fallback={null}>
          <Win n={lastSent?.n ?? b.n} height={run.block ?? state.tip.height} onClose={() => setCelebrate(false)} />
        </Suspense>
      )}
    </div>
  );
}

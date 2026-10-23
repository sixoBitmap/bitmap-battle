import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type TableView } from '../lib/api.ts';
import {
  type Battle,
  battles,
  claim,
  current,
  fund,
  join,
  locateDeposit,
  type Quote,
  quote,
  quoteTakeback,
  rebudget,
  recoverable,
  remove,
  settle,
  type Takeback,
  takeBack,
} from '../lib/battles.ts';
import { ago, type Claimer, compact, explorer, num, rate, roman, sats, short, who } from '../lib/format.ts';
import { type Funds, planBudgets, readCoins } from '../lib/funds.ts';
import { useCoins, useNow } from '../lib/hooks.ts';
import { live, onBlock } from '../lib/live.ts';
import { type Mood, moment, mood } from '../lib/mood.ts';
import { player, playerTag } from '../lib/player.ts';
import { go } from '../lib/route.ts';
import { sfx } from '../lib/sound.ts';
import { fail, toast } from '../lib/toast.ts';
import { addressKind, type Wallet, wallet } from '../lib/wallet.ts';
import { Fight } from './Fight.tsx';
import { Addr } from './Addr.tsx';
import { TipRow } from './Tip.tsx';
import { useConnect } from './WalletButton.tsx';

const Win = lazy(() => import('./Win.tsx'));

type Phase = 'watch' | 'taken' | 'deposit' | 'arriving' | 'ready' | 'mint' | 'fighting' | 'won' | 'lost' | 'left' | 'over';

function phaseOf(b: Battle | null, tableExists: boolean, seatTaken: boolean, n: number, tip: number): Phase {
  if (b?.outcome) return b.outcome;
  if (b) {
    if (!b.deposit) return 'deposit';
    if (b.deposit.vout === null) return 'arriving';
    if (n > tip + 1) return 'ready';
    return b.claims.length ? 'fighting' : 'mint';
  }
  if (!tableExists) return 'over';
  return seatTaken ? 'taken' : 'watch';
}

export function Table({ n }: { n: number }) {
  const { state, config } = live.use();
  const all = battles.use();
  const w = wallet.use();
  const now = useNow();
  const { run: connectWallet } = useConnect();
  const [busy, setBusy] = useState<string | null>(null);
  const [share, setShare] = useState(25);
  const [q, setQ] = useState<Quote | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [wonAt, setWonAt] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<Takeback | null>(null);
  const [canRecover, setCanRecover] = useState(false);
  const [coins, setCoins] = useCoins(w, config);
  const funds = useMemo(
    () => (w && coins && coins !== 'error' && state && config ? planBudgets(w, coins, state.rates, config.postage) : null),
    [w, coins, state?.rates.nextBlock, config?.postage],
  );
  const pick = funds?.options.find((o) => o.share === share) ?? funds?.options[0] ?? null;

  const tip = state?.tip.height ?? 0;
  const listed = state?.tables.find((t) => t.n === n) ?? null;
  // An older bitmap nobody owns is open for a fight even before anyone bids on it.
  const [free, setFree] = useState(false);
  useEffect(() => {
    if (listed || n > tip) return;
    let alive = true;
    api.bitmap(n).then(
      (r) => alive && setFree(r.claimed === null),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [n, tip, listed !== null]);
  const table: TableView | null = listed ?? (free && n <= tip ? { n, kind: 'open', claims: [], seat: null, hot: false } : null);
  const active = current(all, n);
  const b = active ?? (n <= tip ? all.find((x) => x.n === n) : null) ?? null;
  const seatTaken = Boolean(table?.seat && table.seat !== playerTag);
  const phase = phaseOf(b, table !== null, seatTaken, n, tip);

  const mineTx = b?.claims.map((c) => c.txid) ?? [];
  const claims = table?.claims ?? [];
  const myView = claims.find((c) => mineTx.includes(c.txid)) ?? null;
  const rivals = claims.filter((c) => !mineTx.includes(c.txid));
  const topRival = rivals[0]?.eff ?? null;
  const leading = myView !== null && (topRival === null || myView.eff > topRival + 1e-9);
  const claimsKey = claims.map((c) => `${c.txid}:${c.eff}`).join();

  useEffect(() => {
    if (phase !== 'arriving' || !active) return;
    const look = () => locateDeposit(active.id).then((found) => found && sfx.coin(), fail);
    look();
    const t = setInterval(look, 2500);
    return () => clearInterval(t);
  }, [phase, active?.id]);

  useEffect(() => {
    if (!active || !table || !state || !config || (phase !== 'mint' && phase !== 'fighting')) {
      setQ(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      quote(active.id, table, state.rates, config).then(
        (r) => !stale && setQ(r),
        (e) => !stale && setQ({ ok: false, reason: (e as Error).message, top: null, best: 0 }),
      );
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [phase, active?.id, active?.claims.length, claimsKey, state?.rates.nextBlock, tip]);

  useEffect(() => {
    if (!active || n > tip) return;
    const check = () =>
      settle(active.id).then(
        (outcome) => {
          if (outcome === 'won') {
            setCelebrate(true);
          } else if (outcome === 'lost') sfx.lose();
        },
        () => {},
      );
    check();
    const off = onBlock(check);
    const t = setInterval(check, 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [active?.id, tip, n]);

  useEffect(() => {
    if (b?.outcome !== 'won') return;
    api.bitmap(n).then(
      (r) => r.claimed && r.claimed !== 'unknown' && setWonAt(r.claimed.height),
      () => {},
    );
  }, [b?.outcome, n]);

  useEffect(() => {
    if (!b || b.outcome !== 'lost') return;
    recoverable(b.id).then(setCanRecover, () => setCanRecover(false));
  }, [b?.id, b?.outcome, b?.refund?.txid, tip]);

  const feeling: Mood =
    phase === 'fighting'
      ? !myView
        ? 'sending'
        : leading
          ? 'leading'
          : 'behind'
      : phase === 'deposit' || phase === 'arriving'
        ? 'joining'
        : phase === 'watch'
          ? claims.length
            ? 'crowd'
            : w
              ? 'quiet'
              : 'connect'
          : phase === 'over'
            ? 'quiet'
            : phase;
  useEffect(() => mood.set(feeling), [feeling]);

  const wasLeading = useRef<boolean | null>(null);
  useEffect(() => {
    if (phase !== 'fighting' || !myView) return;
    if (wasLeading.current !== null && wasLeading.current !== leading) {
      (leading ? sfx.lead : sfx.outbid)();
      moment(leading ? 'lead' : 'outbid');
    }
    wasLeading.current = leading;
  }, [leading, phase, myView !== null]);

  // A bitmap nobody owns, opened from the hall of fame: once the deposit lands the claim goes out by itself, since
  // it is signed with the battle key in this browser and needs no wallet.
  const autoMint = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (phase === 'mint' && table?.kind === 'open' && q?.ok) autoMint.current?.();
  }, [phase, table?.kind, q?.ok]);

  if (!state || !config) return null;

  const act = async (name: string, f: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    try {
      await f();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  // Reads the coins once more right before the wallet opens, so the chosen budget is one it can still pay.
  const recheck = async (wal: Wallet) => {
    const fresh = await readCoins(wal.payment.address, config);
    setCoins(fresh);
    const plan = planBudgets(wal, fresh, state.rates, config.postage);
    const now = plan.options.find((o) => o.share === share) ?? null;
    if (!now) toast('Your balance just changed. Pick a budget again.');
    return now;
  };

  const fight = () =>
    act('join', async () => {
      if (!w) {
        await connectWallet();
        return;
      }
      const chosen = await recheck(w);
      if (!chosen) return;
      await api.seat(n, player);
      sfx.tap();
      const battle = join(n, chosen.amount, w, config);
      go(`#/table/${n}`);
      await fund(battle.id, w);
      toast('Deposit sent! Waiting for it to arrive…', 'good');
    });

  const retryDeposit = () =>
    act('fund', async () => {
      const wal = w ?? (await connectWallet());
      if (!wal || !active) return;
      const chosen = await recheck(wal);
      if (!chosen) return;
      rebudget(active.id, chosen.amount);
      await fund(active.id, wal);
      toast('Deposit sent!', 'good');
    });

  const send = (name: 'mint' | 'raise') =>
    act(name, async () => {
      if (!active || !q?.ok) return;
      sfx.tap();
      const sent = await claim(active.id, q, config);
      toast(name === 'mint' ? `Claim sent at ${rate(sent.rate)}!` : `Raised to ${rate(sent.rate)}!`, 'good');
    });
  autoMint.current = () => send('mint');

  const askLeave = () =>
    act('leave', async () => {
      if (!b) return;
      if (!b.deposit) {
        remove(b.id);
        go('#/');
        return;
      }
      const t = await quoteTakeback(b.id, state.rates);
      if (!t.ok) throw new Error(t.reason);
      setLeaving(t);
    });

  const confirmLeave = () =>
    act('leave', async () => {
      if (!b || !leaving?.ok) return;
      await takeBack(b.id, leaving.fee, config);
      setLeaving(null);
      setCanRecover(false);
      toast(`${sats(leaving.back)} are on their way back to your wallet`, 'good');
    });

  const kind = table?.kind ?? 'over';
  // Someone claiming an older bitmap nobody owns opens a fight there too.
  const openFight = state.tables.find((t) => t.kind === 'open' && t.n !== n && t.claims.length > 0) ?? null;
  const spent = b?.claims.at(-1)?.fee ?? 0;
  const room = (b?.deposit?.amount ?? b?.budget ?? pick?.amount ?? 0) - config.postage;
  const result = state.results.find((r) => r.claims.some((c) => c.n === n && c.valid));
  const winnerClaim = result?.claims.find((c) => c.n === n && c.valid) ?? null;

  const finished = phase === 'won' || phase === 'lost' || phase === 'left' || phase === 'over';
  const note = kind === 'live' ? `⏱ ${ago(now - state.tip.seenAt)} since #${num(tip)}` : '';
  const nextBattle = (
    <button className="big go" onClick={() => go('#/')}>
      ⚔️ NEXT
    </button>
  );

  return (
    <div className={`table phase-${phase} ${phase === 'fighting' ? (leading ? 'is-leading' : myView ? 'is-behind' : '') : ''}`}>
      <div className="table-head">
        <span className={`pill ${kind === 'live' ? 'red' : kind === 'next' ? 'purple' : kind === 'open' ? 'gold' : 'grey'}`}>
          {kind === 'live' && <i className="dot" />}
          {kind === 'live' ? 'LIVE' : kind === 'next' ? 'NEXT' : kind === 'open' ? 'STILL OPEN' : 'FINISHED'}
        </span>
        {note && <span className="muted">{note}</span>}
      </div>
      <div className="number">
        {num(n)}
        <small>.bitmap</small>
      </div>

      <Status phase={phase} leading={leading} seen={myView !== null} n={n} next={kind === 'next'} />

      <div className="arena">
        {finished ? (
          <Outcome phase={phase} b={b} n={n} winner={winnerClaim} />
        ) : claims.length ? (
          <Fight claims={claims} mine={mineTx} />
        ) : (
          <div className="empty">
            {kind === 'next' ? 'Claims open when the next block is found.' : 'Nobody has claimed it yet. Be the first!'}
          </div>
        )}
      </div>

      {!finished && (
        <div className="arena-meta">
          {kind === 'live' ? (
            <a
              className="prepare"
              href={`#/table/${tip + 2}`}
              title={`Prepare for ${num(tip + 2)}.bitmap: your purse confirms before the fight starts, so your claim stands alone and every sat goes into your bid`}
            >
              🛡️ PARARE <Roman n={tip + 2} />
            </a>
          ) : (
            <a href="#/">Back to the live battle</a>
          )}
          {openFight ? (
            <a className="open-fight" href={`#/table/${openFight.n}`}>
              ⚔ {num(openFight.n)} open fight
            </a>
          ) : (
            <span className="fame-line">
              {state.results.slice(0, 3).map((r) => {
                const champ = r.claims.find((c) => c.n === r.height && c.valid);
                return (
                  <span key={r.height}>
                    {num(r.height).slice(-3)}
                    {champ ? who(champ).icon : '·'}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      )}

      <div className="dock">
        {b?.deposit && !b.outcome && (
          <div className="meter">
            <div className="meter-bar">
              <div
                style={{
                  width: `${Math.min(100, (spent / Math.max(1, room)) * 100)}%`,
                }}
              />
            </div>
            <span>
              {spent ? `bid ${sats(spent)}` : 'no bid yet'} · budget {sats(room)}
            </span>
          </div>
        )}

        {phase === 'taken' && (
          <p className="muted center">Another app player sits here, so you can watch. App players never fight each other.</p>
        )}

        {phase === 'watch' && (
          <>
            <Budgets w={w} coins={coins} funds={funds} pick={pick} onPick={setShare} />
            <button className="big go" onClick={fight} disabled={busy !== null || (w !== null && !pick)}>
              {busy === 'join'
                ? 'OPENING WALLET…'
                : !w
                  ? 'CONNECT WALLET'
                  : kind === 'next'
                    ? `🛡️ PARARE ${num(n)}`
                    : kind === 'open' && !claims.length
                      ? `⚡ MINT ${num(n)} NOW`
                      : `FIGHT FOR ${num(n)}`}
              {w && pick && busy !== 'join' && (
                <small>
                  {kind === 'open'
                    ? `budget ${sats(pick.amount)} · mints by itself once the deposit lands`
                    : `budget ${sats(pick.amount)} · bids up to ~${rate((pick.amount - config.postage) / 175)}`}
                </small>
              )}
            </button>
            {config.privatePool && kind === 'live' && (
              <a className="ghost-entry" href="#/ghost">
                👻 Ghost mint (private)
              </a>
            )}
          </>
        )}

        {phase === 'deposit' && (
          <>
            <Budgets w={w} coins={coins} funds={funds} pick={pick} onPick={setShare} />
            <button className="big go" onClick={retryDeposit} disabled={busy !== null || !pick}>
              {busy === 'fund' ? 'OPENING WALLET…' : `DEPOSIT ${pick ? compact(pick.amount) : ''}`}
            </button>
          </>
        )}

        {(phase === 'mint' || phase === 'fighting' || phase === 'ready' || phase === 'arriving') && (
          <div className="buttons">
            <button className="big mint" onClick={() => send('mint')} disabled={phase !== 'mint' || !q?.ok || busy !== null}>
              {busy === 'mint' ? 'SENDING…' : 'MINT'}
              <small>
                {phase === 'ready'
                  ? `after #${num(n - 1)}`
                  : phase === 'arriving'
                    ? kind === 'open'
                      ? 'deposit arriving · mints by itself'
                      : 'deposit arriving'
                    : phase === 'mint'
                      ? q
                        ? q.ok
                          ? `${sats(q.fee)} · ${rate(q.rate)}`
                          : q.reason
                        : '…'
                      : 'sent ✓'}
              </small>
            </button>
            <button
              className={`big raise ${phase === 'fighting' && !leading && myView ? 'pulse' : ''}`}
              onClick={() => send('raise')}
              disabled={phase !== 'fighting' || leading || !q?.ok || busy !== null}
            >
              {busy === 'raise' ? 'SENDING…' : leading ? 'LEADING' : 'RAISE'}
              <small>
                {phase !== 'fighting' ? '—' : leading ? '👑 hold on' : q ? (q.ok ? `+${sats(q.extra)} → ${rate(q.rate)}` : q.reason) : '…'}
              </small>
            </button>
          </div>
        )}

        {phase === 'won' && (
          <div className="pair">
            <button className="big gold" onClick={() => setCelebrate(true)}>
              🌋 Vesuvius
            </button>
            {nextBattle}
          </div>
        )}
        {phase === 'lost' &&
          (canRecover ? (
            <div className="pair">
              <button className="big ghost" onClick={askLeave} disabled={busy !== null}>
                SATS BACK
              </button>
              {nextBattle}
            </div>
          ) : (
            nextBattle
          ))}
        {(phase === 'left' || phase === 'over') && nextBattle}

        {active && ['deposit', 'arriving', 'ready', 'mint', 'fighting'].includes(phase) && (
          <button className="leave" onClick={askLeave} disabled={busy !== null || phase === 'arriving'}>
            {phase === 'deposit' ? 'Cancel' : 'Leave and take my sats back'}
          </button>
        )}
      </div>

      {leaving?.ok &&
        createPortal(
          <div className="modal-bg" onClick={() => setLeaving(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Take your sats back?</h2>
              <p>
                You get back about <b>{sats(leaving.back)}</b>. The network fee is {sats(leaving.fee)}
                {leaving.replaces ? ', a little more than your waiting claim, which it cancels' : ''}.
              </p>
              <button className="big go" onClick={confirmLeave} disabled={busy !== null}>
                YES, TAKE IT BACK
              </button>
              <button className="leave" onClick={() => setLeaving(null)}>
                Stay in the battle
              </button>
            </div>
          </div>,
          document.body,
        )}

      {celebrate && b && (
        <Suspense fallback={null}>
          <Win n={n} height={wonAt ?? tip} onClose={() => setCelebrate(false)} />
        </Suspense>
      )}
    </div>
  );
}

function Roman({ n }: { n: number }) {
  const { thousands, rest } = roman(n);
  return (
    <b className="roman">
      {thousands && <span className="vinculum">{thousands}</span>}
      {rest}
    </b>
  );
}

function Status({ phase, leading, seen, n, next }: { phase: Phase; leading: boolean; seen: boolean; n: number; next: boolean }) {
  if (phase === 'fighting') {
    if (!seen) return <div className="status wait">Your claim flies to the miners…</div>;
    return leading ? (
      <div className="status lead">🏛 You lead the arena</div>
    ) : (
      <div className="status behind">⚔ A challenger outbid you</div>
    );
  }
  const text: Partial<Record<Phase, string>> = {
    watch: next ? '🛡️ Prepared purses fight stronger' : 'Fill your purse and step into the arena',
    taken: 'Another of our gladiators fights here',
    deposit: 'Fill your purse to take the seat',
    arriving: 'Your coins are on their way…',
    ready: `🛡️ Prepared. The fight starts after #${num(n - 1)}`,
    mint: 'Your purse is in. MINT your claim!',
  };
  return text[phase] ? <div className="status">{text[phase]}</div> : null;
}

function Outcome({ phase, b, n, winner }: { phase: Phase; b: Battle | null; n: number; winner: Claimer | null }) {
  const w = winner ? who(winner) : null;
  if (phase === 'won' && b) {
    const link = b.winner ? explorer(b.network, 'inscription', b.winner) : '';
    return (
      <div className="outcome won">
        <div className="outcome-title">🏆 YOU WON!</div>
        <p>
          {num(n)}.bitmap is already in your ordinals address. Xverse may take a few minutes to show it.{' '}
          {link && (
            <a className="link" href={link} target="_blank" rel="noopener">
              See it ↗
            </a>
          )}
        </p>
        <TipRow />
      </div>
    );
  }
  if (phase === 'lost') {
    return (
      <div className="outcome lost">
        <div className="outcome-title">😅 Not this time</div>
        <p>{w ? `${w.icon} ${w.name} took ${num(n)}.bitmap.` : `Someone else took ${num(n)}.bitmap.`}</p>
      </div>
    );
  }
  if (phase === 'left' && b) {
    const link = b.refund ? explorer(b.network, 'tx', b.refund.txid) : '';
    return (
      <div className="outcome">
        <div className="outcome-title">👋 You left</div>
        <p>
          Your sats are on their way back.{' '}
          {link && (
            <a className="link" href={link} target="_blank" rel="noopener">
              See it ↗
            </a>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="outcome">
      <div className="outcome-title">Battle over</div>
      {w && (
        <p>
          Won by {w.icon} {w.name}
        </p>
      )}
    </div>
  );
}

function Budgets({
  w,
  coins,
  funds,
  pick,
  onPick,
}: {
  w: Wallet | null;
  coins: unknown;
  funds: Funds | null;
  pick: { share: number; amount: number } | null;
  onPick: (share: number) => void;
}) {
  if (!w) return null;
  const from = (
    <>
      {addressKind(w.payment)} <b>{short(w.payment.address, 6, 4)}</b>
    </>
  );
  if (coins === 'error') return <div className="warn">Could not read the balance of {from}. Trying again every 30 seconds.</div>;
  if (!funds) return <p className="muted center">Reading what {from} can spend…</p>;
  if (!funds.options.length) {
    return (
      <div className="warn">
        To play, {from} needs <b>{sats(funds.minimum + funds.reserve)}</b> confirmed. It has {sats(funds.confirmed)}
        {funds.pending > 0 && <> (+{sats(funds.pending)} confirming)</>}.
        {funds.confirmed === 0 && funds.pending === 0 && (
          <>
            {' '}
            Xverse pays only from its Preferred Bitcoin Address (Settings › Advanced). Pick the SegWit type that holds your BTC, then
            reconnect.
          </>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="chips">
        {funds.options.map((o) => (
          <button key={o.share} className={`chip ${pick?.share === o.share ? 'on' : ''}`} onClick={() => onPick(o.share)}>
            <span className="chip-share">{o.share === 100 ? 'ALL' : `${o.share}%`}</span>
            <span className="chip-amount">{compact(o.amount)}</span>
          </button>
        ))}
      </div>
      <p className="payfrom" title={`Xverse pays from its ${addressKind(w.payment)} address ${w.payment.address}`}>
        Pays from <Addr value={w.payment.address} label="You pay from" /> · <b>{sats(funds.spendable)}</b> free
        {funds.pending > 0 && <> (+{compact(funds.pending)} soon)</>}
      </p>
    </>
  );
}

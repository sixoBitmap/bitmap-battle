import { useEffect, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { COINS_CHANGED } from '../lib/hooks.ts';
import { fail, toast } from '../lib/toast.ts';

type Status = {
  rival: { enabled: boolean; maxRate: number };
  automine: number;
  private: { floor: number; held: number; rival: { enabled: boolean; rate: number } };
};

// Regtest only: drive the private test network from the phone.
export function DevPanel() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    if (open) get<Status>('/dev/status').then(setS, fail);
  }, [open]);
  const act = (path: string, body: unknown, note?: string) =>
    post<Status>(path, body).then((r) => {
      if ('rival' in (r as object)) setS(r);
      if (note) toast(note, 'good');
    }, fail);

  return (
    <div className={`dev ${open ? 'open' : ''}`}>
      <button className="dev-toggle" onClick={() => setOpen(!open)}>
        🧪
      </button>
      {open && s && (
        <div className="dev-body">
          <b>Test network</b>
          <button
            onClick={() =>
              act('/dev/faucet', {}, '1,000,000 test sats arrived, confirmed').then(() => window.dispatchEvent(new Event(COINS_CHANGED)))
            }
          >
            💰 Get 0.01 test BTC
          </button>
          <button onClick={() => act('/dev/mine', { blocks: 1 }, 'Block mined').then(() => window.dispatchEvent(new Event(COINS_CHANGED)))}>
            ⛏ Mine a block
          </button>
          <button onClick={() => act('/dev/mine-mara', {}, 'MARA block mined: private claims included').then(() => window.dispatchEvent(new Event(COINS_CHANGED)))}>
            👻 Mine a MARA block
          </button>
          <label>
            <input type="checkbox" checked={s.rival.enabled} onChange={(e) => act('/dev/rival', { enabled: e.target.checked })} /> Rival bot
            fights
          </label>
          <label>
            <input type="checkbox" checked={s.private.rival.enabled} onChange={(e) => act('/dev/private', { rival: e.target.checked })} /> Private
            rival ({s.private.rival.rate})
          </label>
          <label>
            Private floor
            <select value={s.private.floor} onChange={(e) => act('/dev/private', { floor: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6].map((r) => (
                <option key={r} value={r}>
                  {r} sat/vB
                </option>
              ))}
            </select>
          </label>
          <label>
            Rival max
            <select value={s.rival.maxRate} onChange={(e) => act('/dev/rival', { maxRate: Number(e.target.value) })}>
              {[1, 2, 3, 5, 10, 20].map((r) => (
                <option key={r} value={r}>
                  {r} sat/vB
                </option>
              ))}
            </select>
          </label>
          <label>
            Auto-mine
            <select value={s.automine} onChange={(e) => act('/dev/automine', { seconds: Number(e.target.value) })}>
              {[0, 30, 60, 120, 300].map((x) => (
                <option key={x} value={x}>
                  {x ? `every ${x}s` : 'off'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

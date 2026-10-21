import { api, type Config, type PublicState } from './api.ts';
import { player } from './player.ts';
import { store } from './store.ts';

export const live = store<{ config: Config | null; state: PublicState | null; connected: boolean; offset: number }>({
  config: null,
  state: null,
  connected: false,
  offset: 0,
});

const blockListeners = new Set<(height: number) => void>();
export const onBlock = (cb: (height: number) => void) => {
  blockListeners.add(cb);
  return () => blockListeners.delete(cb);
};

function setState(state: PublicState) {
  const prev = live.get().state;
  live.set((l) => ({ ...l, state, offset: state.now - Date.now() }));
  if (prev && state.tip.height > prev.tip.height) for (const cb of blockListeners) cb(state.tip.height);
}

export async function startLive(): Promise<void> {
  const config = await api.config();
  live.set((l) => ({ ...l, config }));
  setState(await api.state());

  let delay = 1000;
  const connect = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    let hello: number | undefined;
    ws.onopen = () => {
      delay = 1000;
      live.set((l) => ({ ...l, connected: true }));
      const greet = () => ws.send(JSON.stringify({ type: 'hello', player }));
      greet();
      hello = window.setInterval(greet, 60_000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') setState(msg.state);
    };
    ws.onclose = () => {
      clearInterval(hello);
      live.set((l) => ({ ...l, connected: false }));
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15_000);
    };
  };
  connect();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') api.state().then(setState, () => {});
  });
}

export const serverNow = () => Date.now() + live.get().offset;

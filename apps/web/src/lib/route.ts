import { useSyncExternalStore } from 'react';

export type Route = { page: 'lobby' } | { page: 'table'; n: number } | { page: 'me' } | { page: 'fame' } | { page: 'how' } | { page: 'volcano' };

function parse(hash: string): Route {
  const m = hash.match(/^#\/table\/(\d{1,8})$/);
  if (m) return { page: 'table', n: Number(m[1]) };
  if (hash === '#/me') return { page: 'me' };
  if (hash === '#/fame') return { page: 'fame' };
  if (hash === '#/how') return { page: 'how' };
  if (hash === '#/volcano') return { page: 'volcano' };
  return { page: 'lobby' };
}

let route = parse(location.hash);
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  route = parse(location.hash);
  window.scrollTo(0, 0);
  for (const l of listeners) l();
});

export const useRoute = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => route,
  );

export const go = (hash: string) => {
  location.hash = hash;
};

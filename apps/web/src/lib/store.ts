import { useSyncExternalStore } from 'react';

export type Store<T> = { get: () => T; set: (next: T | ((prev: T) => T)) => void; use: () => T; subscribe: (l: () => void) => () => void };

export function store<T>(initial: T, persist?: string): Store<T> {
  let value = initial;
  if (persist) {
    try {
      const saved = localStorage.getItem(persist);
      if (saved !== null) value = JSON.parse(saved);
    } catch {}
  }
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const get = () => value;
  return {
    get,
    subscribe,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (persist) {
        try {
          localStorage.setItem(persist, JSON.stringify(value));
        } catch {}
      }
      for (const l of listeners) l();
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}

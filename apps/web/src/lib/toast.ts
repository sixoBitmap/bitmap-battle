import { store } from './store.ts';

export type Toast = { id: number; text: string; kind: 'info' | 'error' | 'good' };

export const toasts = store<Toast[]>([]);
let next = 1;

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = next++;
  toasts.set((all) => [...all.slice(-2), { id, text, kind }]);
  setTimeout(() => toasts.set((all) => all.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
}

export const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

import { sha256, toHex, utf8 } from '@bitmap-battle/core';

function makeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

function load(): string {
  try {
    const saved = localStorage.getItem('bb.player');
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const id = makeId();
    localStorage.setItem('bb.player', id);
    return id;
  } catch {
    return makeId();
  }
}

export const player = load();

// The tag the server shows on a table's seat, so the app can tell whether the seat is ours.
export const playerTag = toHex(sha256(utf8(player))).slice(0, 12);

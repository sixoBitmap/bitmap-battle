import { store } from './store.ts';

export type Mood =
  | 'quiet'
  | 'crowd'
  | 'taken'
  | 'connect'
  | 'joining'
  | 'ready'
  | 'mint'
  | 'sending'
  | 'leading'
  | 'behind'
  | 'won'
  | 'lost'
  | 'left';

// What the arena is doing for this player right now; the cube talks about it.
export const mood = store<Mood>('quiet');

// One-off happenings the cube reacts to at once.
export type Moment = 'block' | 'tap' | 'thanks' | 'outbid' | 'lead';
const listeners = new Set<(m: Moment) => void>();
export const onMoment = (cb: (m: Moment) => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const moment = (m: Moment) => {
  for (const l of listeners) l(m);
};

// Anything the cube should read out word for word, like a whole address.
const speakers = new Set<(text: string) => void>();
export const onSpeak = (cb: (text: string) => void) => {
  speakers.add(cb);
  return () => speakers.delete(cb);
};
export const speak = (text: string) => {
  for (const s of speakers) s(text);
};

export const PHRASES: Record<Mood | Moment, string[]> = {
  quiet: [
    'Ave! The sand is empty. First blood is yours.',
    'No challengers yet. The crowd is getting bored.',
    'An empty arena. A brave one could walk right in.',
    'Even the lions are napping. Want to wake them?',
    'Quiet round. Those are the best ones to win.',
    'The emperor yawns. Give him a show.',
    'I counted the gladiators. Zero. Your move.',
    'Nobody has claimed this block. Yet.',
    'Psst. Fortune favors the early.',
    'I am small, but I believe in big wins.',
    'Wise gladiators prepare for the next block. Their purse is ready first.',
  ],
  crowd: [
    'Fighters are in the arena. Will you join them?',
    'The bot is here again. It never sleeps.',
    'Hear the crowd? Someone already bid.',
    'A brawl is forming. Pick your purse and step in.',
    'Watch the bids. Strike when you are ready.',
    'Tough crowd tonight.',
    'That bot has fought a thousand rounds. You only need one.',
    'Gladiators are warming up. Are you?',
    'Two can play. Three is a party.',
    'Spectating is free. Winning costs a little.',
    'Tip: prepare for the next battle. A confirmed purse hits harder.',
    'The bot always comes prepared. You can too.',
  ],
  taken: [
    'Another one of us sits here. We never fight each other.',
    'This seat is taken by a friend. Watch and cheer.',
    'Next round is yours to claim.',
    'Sit back. Learn from the masters.',
    'Our player is in the arena. Go, friend, go!',
  ],
  connect: [
    'Connect your wallet and I will count your coins.',
    'No purse, no glory. Connect Xverse.',
    'Show me your coin purse, champion.',
    'One tap to connect, then the fun begins.',
  ],
  joining: [
    'Coins are travelling to the arena.',
    'Your deposit is on its way. Stretch a little.',
    'The gate is opening. Hold on.',
    'Patience. The guards are counting your coins.',
    'Almost there. Sharpen your sword.',
  ],
  ready: [
    'Prepared! The fight starts with the next block.',
    'Seat reserved. Breathe in, breathe out.',
    'Ready and waiting. Like a lion before dinner.',
    'Your coins confirm before the fight. Every sat goes into your bid.',
  ],
  mint: [
    'Your purse is in. Tap MINT and claim it!',
    'The sand is yours. MINT!',
    'Now! Before the bot wakes up.',
    'One tap. Glory awaits.',
    'MINT it. Legends do not wait.',
  ],
  sending: [
    'Your claim is flying to the miners.',
    'Message sent to the gods of the block.',
    'Whoosh. Claim in the air.',
  ],
  leading: [
    'You lead! The crowd chants your name.',
    'Hold the line, gladiator.',
    'Top of the arena. Stay calm.',
    'The laurel wreath is close.',
    'They fear you now.',
    'Look at you. Number one.',
    'Keep your shield up. Bots strike back.',
    'Victory smells like fresh sand.',
    'Do not blink. A block can come any second.',
    'The emperor gives a thumbs up.',
  ],
  behind: [
    'A challenger outbid you! RAISE?',
    'They took the lead. A small raise wins it back.',
    'Ouch. Strike back with a RAISE.',
    'The bot is ahead. Show it who rules this arena.',
    'Not today, bot! Raise!',
    'One tap and you are back on top.',
    'The crowd turns away. Win them back.',
    'Remember: you set the limit. Raise only if you like.',
    'Fortune is fickle. So are fee rates.',
    'Steady hands. Small raise.',
  ],
  won: [
    'VICTORIA! The bitmap is yours!',
    'Champion of the block!',
    'The crowd goes wild!',
    'Laurels for the winner!',
    'History is written. And it is your bitmap.',
    'I knew it. I always knew it.',
  ],
  lost: [
    'Even the greatest gladiators lose a round.',
    'Next block, next glory.',
    'Shake it off. A new arena opens every ten minutes.',
    'The bot got lucky. Revenge is near.',
    'Lost the battle, not the war.',
    'Dust off your sandals and try again.',
  ],
  left: [
    'Wise retreat. Your coins are coming home.',
    'Live to fight another block.',
    'A smart gladiator picks the battle.',
  ],
  block: [
    'A new block! A new battle begins.',
    'The gates open for a fresh round!',
    'Fresh sand, fresh bitmap.',
    'New round. Who dares?',
  ],
  tap: [
    'Hey! That tickles.',
    'A coin for the arena master? Only if you like.',
    'Boop. Tips keep this arena open.',
    'You found me. Want to toss a tip?',
  ],
  thanks: ['Gratias! You are a true patron of the arena.', 'Thank you, generous one!', 'The arena master smiles upon you.'],
  outbid: ['Outbid! Quick, RAISE!', 'Someone just passed you!', 'Challenger incoming!'],
  lead: ['Back on top!', 'You took the lead!', 'Now that is how it is done.'],
};

export function line(key: Mood | Moment, last?: string): string {
  const list = PHRASES[key];
  let next = list[Math.floor(Math.random() * list.length)];
  if (next === last && list.length > 1) next = list[(list.indexOf(next) + 1) % list.length];
  return next;
}

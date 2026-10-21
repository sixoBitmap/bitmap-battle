import { useState } from 'react';

const SECTIONS = {
  play: {
    label: 'Play',
    facts: [
      ['⚔️', 'Pick the battle', 'Each new block opens a battle for the next bitmap. The first valid claim mined wins.'],
      ['👛', 'Fill your purse', 'Choose 25%, 50%, 75% or all of what you can spend. Your wallet opens only for this.'],
      ['🟧', 'MINT', 'One tap sends your claim, signed in this browser with the battle key.'],
      ['⬆️', 'RAISE', 'Outbid? One tap pays just enough to lead again.'],
      ['🏆', 'Victory', 'Mined first, the bitmap goes to your ordinals address.'],
    ],
  },
  safety: {
    label: 'Safety',
    facts: [
      ['🔑', 'Your keys', 'You sign everything yourself. The server never holds keys or coins and never sends your transactions.'],
      ['📜', 'Backups', 'Each battle key lives in this browser. Save a backup from your purse while coins are inside.'],
      ['💸', 'Fees', 'Real bitcoin. A losing claim usually still pays its fee.'],
      ['🤖', 'Bots', 'They react in milliseconds and win many battles.'],
      ['🔞', '18+', 'A fee auction between players. No house, no odds.'],
    ],
  },
  rules: {
    label: 'Rules',
    facts: [
      ['📝', 'Body', 'Exactly "<number>.bitmap": no spaces, no leading zeros.'],
      ['📄', 'Type', 'The content type starts with text/plain.'],
      ['⛓️', 'Height', 'The number is not above the block holding the claim. Your claim is locked until it can count.'],
      ['🥇', 'First wins', 'Chain order decides: block, then position in it.'],
      ['🤝', 'One seat', 'App players never fight each other, only outsiders.'],
    ],
  },
} as const;

type Key = keyof typeof SECTIONS;

export function Rules({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Key>('play');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal rules-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Rules of the arena</h2>
        <div className="segment" role="tablist">
          {(Object.keys(SECTIONS) as Key[]).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {SECTIONS[k].label}
            </button>
          ))}
        </div>
        <div className="facts">
          {SECTIONS[tab].facts.map(([icon, title, text]) => (
            <div key={title} className="fact">
              <span className="fact-icon">{icon}</span>
              <div>
                <b>{title}</b>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="big go" onClick={onClose}>
          To the arena
        </button>
      </div>
    </div>
  );
}

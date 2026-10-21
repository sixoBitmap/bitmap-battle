import { useState } from 'react';
import { store } from '../lib/store.ts';

const agreed = store<boolean>(false, 'bb.agreed');

export function RiskGate() {
  const ok = agreed.use();
  const [checked, setChecked] = useState(false);
  if (ok) return null;
  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Before you play</h2>
        <ul className="rules">
          <li>
            <b>Real bitcoin.</b> Every MINT and RAISE pays a network fee.
          </li>
          <li>
            <b>Losers pay too.</b> A losing claim usually still costs its fee.
          </li>
          <li>
            <b>Bots are fast.</b> They react in milliseconds; many battles are lost to them.
          </li>
          <li>
            <b>You stay in control.</b> You sign everything in your own browser and wallet. You can never lose more than the
            budget you deposit.
          </li>
          <li>
            <b>Adults only (18+).</b> This is a fee auction, not a casino: there are no odds and no house.
          </li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I am 18 or older and I
          understand I can lose the fees I bid.
        </label>
        <button className="big go" disabled={!checked} onClick={() => agreed.set(true)}>
          Let me in
        </button>
      </div>
    </div>
  );
}

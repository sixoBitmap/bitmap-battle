// A private mempool a claim can wait in, unseen by everyone else until its pool mines a block: MARA Slipstream on
// mainnet, a stand-in on regtest.
export type PrivatePool = {
  name: string;
  // The lowest fee rate it takes right now, in sat/vB.
  floor(): Promise<number>;
  // Throws with the pool's own reason when it refuses the transaction.
  submit(hex: string): Promise<void>;
};

export function slipstream(api: string): PrivatePool {
  const base = api.replace(/\/$/, '');
  return {
    name: 'MARA Slipstream',
    async floor() {
      const res = await fetch(`${base}/rates`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Slipstream rates: HTTP ${res.status}`);
      const r = (await res.json()) as Record<string, number | undefined>;
      const floor = Math.max(r.submit_fee_rate ?? 0, r.market_rate ?? 0, r.slipstream_rate ?? 0, r.effective_rate ?? 0);
      if (!(floor > 0)) throw new Error('Slipstream sent no fee rates');
      return floor;
    },
    async submit(hex) {
      const res = await fetch(`${base}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx_hex: hex }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let body: { status?: string; message?: string } = {};
      try {
        body = JSON.parse(text);
      } catch {}
      if (!res.ok || body.status !== 'success') throw new Error(body.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`);
    },
  };
}

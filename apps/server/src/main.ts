import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { outputScript } from '@bitmap-battle/core';
import { Bitmaps } from './bitmaps.ts';
import { loadConfig } from './config.ts';
import { Dev } from './dev.ts';
import { GhostRuns } from './ghostrun.ts';
import { Ghosts } from './ghosts.ts';
import { serve } from './http.ts';
import { log } from './log.ts';
import { announcePublicLink } from './public-link.ts';
import { Push } from './push.ts';
import { Rpc } from './rpc.ts';
import { Seats } from './seats.ts';
import { buildState } from './state.ts';
import { type BlockInfo, Watcher } from './watcher.ts';

const CHAINS: Record<string, string> = { main: 'mainnet', test: 'testnet', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };

const cfg = loadConfig();
mkdirSync(cfg.dataDir, { recursive: true });

const rpc = new Rpc(cfg.rpcUrl, cfg.rpcAuth);
const info = await rpc.call<{ chain: string; blocks: number; initialblockdownload: boolean }>('getblockchaininfo');
if (CHAINS[info.chain] !== cfg.network) throw new Error(`the node at ${cfg.rpcUrl} runs ${info.chain}, not ${cfg.network}`);
if (info.initialblockdownload) log('the node is still syncing: battles start once it has caught up');

const bitmaps = new Bitmaps(join(cfg.dataDir, 'claims.json'), cfg.network, cfg.bitmapDb);
setTimeout(() => {
  const found = bitmaps.findGaps();
  if (cfg.bitmapDb) log(`bitmap index: ${found} unclaimed bitmap(s) below its last block`);
}, 3000);
const ghosts = new Ghosts(join(cfg.dataDir, 'ghosts.json'), cfg.network);
const watcher = new Watcher(rpc, bitmaps, cfg.pollMs, cfg.network, ghosts);
const seats = new Seats();
const push = new Push(cfg.dataDir, cfg.vapidSubject);
const dev = cfg.network === 'regtest' ? new Dev(rpc, new Rpc(`${cfg.rpcUrl}/wallet/bb-dev`, cfg.rpcAuth), watcher, cfg.dataDir) : null;
await dev?.init();
if (dev && !cfg.tipAddress) cfg.tipAddress = dev.tipJar;
if (cfg.tipAddress) {
  try {
    outputScript(cfg.tipAddress, cfg.network);
  } catch {
    throw new Error(`--tip-address ${cfg.tipAddress} is not a ${cfg.network} address`);
  }
}

if (dev) watcher.poolHint = (hash) => dev.poolOf(hash);
const pool = cfg.slipstream === 'dev' ? (dev?.pool ?? null) : null;
const runs = new GhostRuns(join(cfg.dataDir, 'ghost-runs.json'), { rpc, watcher, bitmaps, pool, network: cfg.network });
watcher.on('tip', (t: { height: number }) => void runs.step(t.height));

const state = () => buildState(cfg.network, watcher, bitmaps, seats, ghosts, runs);
const server = serve(cfg, { rpc, watcher, bitmaps, seats, push, dev, ghosts, runs, state });

const announced = new Set<number>();
watcher.on('change', () => {
  seats.sweep((n) => n <= watcher.tip.height && bitmaps.claimed(n) !== null);
  server.publish();
  if (watcher.syncing) return;
  for (const t of state().tables) {
    if (!t.hot || t.kind === 'next' || announced.has(t.n)) continue;
    announced.add(t.n);
    void push.notify({
      title: `Battle for ${t.n.toLocaleString('en-US')}.bitmap`,
      body: `${t.claims.length} minters are fighting. Tap to watch or join.`,
      url: `/#/table/${t.n}`,
      tag: `table-${t.n}`,
    });
  }
});
watcher.on('block', (block: BlockInfo) => {
  server.publishBlock(block);
  void runs.step(block.height);
  const won = block.claims.filter((c) => c.valid).map((c) => c.n);
  log(`block ${block.height.toLocaleString()}: ${block.claims.length} claim(s)${won.length ? `, won: ${won.join(', ')}` : ''}`);
});

void watcher.run();
void watcher.watchTip();
log(`Bitmap Battle (${cfg.network}) on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);
log(`node ${cfg.rpcUrl}, login ${cfg.rpcAuthSource}${cfg.bitmapDb ? `, bitmap index ${cfg.bitmapDb}` : ''}`);
log(cfg.tipAddress ? `tips go to ${cfg.tipAddress}` : 'no tip address set: the tip cube and tip buttons are hidden');
if (cfg.network === 'mainnet') announcePublicLink(join(cfg.dataDir, '..', 'public-url.txt'));

const stop = async () => {
  watcher.stop();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

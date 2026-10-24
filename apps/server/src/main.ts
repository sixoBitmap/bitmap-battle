import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { outputScript } from '@bitmap-battle/core';
import { Bitmaps } from './bitmaps.ts';
import { loadConfig } from './config.ts';
import { Dev } from './dev.ts';
import { GhostRuns } from './ghostrun.ts';
import { Ghosts, isPrivatePool, PRIVATE_POOLS } from './ghosts.ts';
import { serve } from './http.ts';
import { log } from './log.ts';
import { slipstream } from './private.ts';
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
const ghosts = new Ghosts(join(cfg.dataDir, 'ghosts.json'), cfg.network, join(cfg.dataDir, 'private-pools.json'));
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
const pool = cfg.slipstream === 'dev' ? (dev?.pool ?? null) : cfg.slipstream ? slipstream(cfg.slipstream) : null;
const runs = new GhostRuns(join(cfg.dataDir, 'ghost-runs.json'), { rpc, watcher, bitmaps, pool, network: cfg.network });
watcher.on('tip', (t: { height: number }) => void runs.step(t.height));

const state = () => buildState(cfg.network, watcher, bitmaps, seats, ghosts, runs);
const server = serve(cfg, { rpc, watcher, bitmaps, seats, push, dev, ghosts, runs, state });

// Each private pool's newest block and its ghost mints (valid claims that came privately), kept so the ghost setup
// shows them after any restart. Blocks read at startup were not watched live: there a ghost is an owner already known
// as one.
async function notePrivate(block: BlockInfo): Promise<void> {
  if (!isPrivatePool(block.pool)) return;
  const ghostly = block.claims.filter((c) => c.valid === true && (c.unseen ?? ghosts.has(c.address))).sort((a, b) => a.position - b.position);
  const first = ghostly[0];
  let mint = null;
  if (first) {
    const tx = await rpc.call<{ vsize: number; fee?: number }>('getrawtransaction', first.txid, 2, block.hash).catch(() => null);
    const rate = tx?.fee === undefined ? null : Math.round((Math.round(tx.fee * 1e8) / tx.vsize) * 100) / 100;
    const n = Math.max(...ghostly.filter((c) => c.txid === first.txid).map((c) => c.n));
    mint = { n, height: block.height, owner: first.address, txid: first.txid, rate };
  }
  ghosts.sawBlock(block.pool!, block.height, mint);
}

// How far back a restart reads blocks for each private pool's newest block and its last two ghost mints.
const LOOK_BACK = 300;

// From the tip down, until every private pool's newest block and last two ghost mints are known, or were known
// before the restart and nothing newer came.
async function lookBack(): Promise<void> {
  const tip = watcher.tip.height;
  const done = (h: number) =>
    PRIVATE_POOLS.every(([pool]) => {
      const s = ghosts.status(pool);
      return s?.height != null && s.wins.length >= 2 && h <= Math.min(s.height, s.wins.at(-2)!.height);
    });
  for (let h = tip; h > tip - LOOK_BACK && !done(h); h--) {
    await notePrivate(watcher.blocks.find((b) => b.height === h) ?? (await watcher.blockAt(h)));
  }
}

const announced = new Set<number>();
let lookedBack = false;
watcher.on('change', () => {
  if (!lookedBack && !watcher.syncing && watcher.blocks.length) {
    lookedBack = true;
    lookBack().catch((e) => log(`private pools: ${(e as Error).message}`));
  }
  void runs.step();
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
  void notePrivate(block);
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

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { type ClusterTx, POSTAGE } from '@bitmap-battle/core';
import { WebSocket, WebSocketServer } from 'ws';
import type { Bitmaps } from './bitmaps.ts';
import type { Config } from './config.ts';
import type { Dev } from './dev.ts';
import type { Ghosts } from './ghosts.ts';
import { log } from './log.ts';
import type { Push } from './push.ts';
import { RpcError, type Rpc } from './rpc.ts';
import { type Seats, validPlayer } from './seats.ts';
import type { PublicState } from './state.ts';
import type { BlockInfo, Watcher } from './watcher.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const BROADCAST: Record<string, string[]> = {
  mainnet: ['https://mempool.space/api/tx', 'https://blockstream.info/api/tx'],
  testnet: ['https://mempool.space/testnet/api/tx', 'https://blockstream.info/testnet/api/tx'],
  testnet4: ['https://mempool.space/testnet4/api/tx'],
  signet: ['https://mempool.space/signet/api/tx'],
  regtest: ['dev'],
};

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
};

const TXID = /^[0-9a-f]{64}$/;
const sats = (btc: number) => Math.round(btc * 1e8);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type BattleClaim = {
  txid: string;
  inscription: string;
  block: number;
  pool: string | null;
  owner: string | null;
  ghost: boolean;
  unseen: boolean | null;
  position: number;
  valid: boolean | null;
  key: string | null;
  fee: number | null;
  vsize: number;
  rate: number | null;
};

type Deps = {
  rpc: Rpc;
  watcher: Watcher;
  bitmaps: Bitmaps;
  seats: Seats;
  push: Push;
  dev: Dev | null;
  ghosts: Ghosts;
  state: () => PublicState;
};

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'request too large');
    parts.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  throw new HttpError(400, 'send a JSON object');
}

// The client's address: behind a tunnel or proxy on this machine, the one it forwards.
function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? '';
  const local = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'];
  if (local && typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return direct;
}

// A token bucket per address, so a public server cannot be used to flood the node.
class Limiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
  ) {
    setInterval(() => {
      const old = Date.now() - 60_000;
      for (const [ip, b] of this.buckets) if (b.at < old) this.buckets.delete(ip);
    }, 60_000).unref();
  }

  allow(ip: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(ip) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    this.buckets.set(ip, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function bitmapNumber(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, 'n must be a bitmap number');
  return n;
}

export function serve(cfg: Config, deps: Deps) {
  const { rpc, watcher, seats, push, dev } = deps;

  async function txInfo(txid: string) {
    type Vout = { n: number; value: number; scriptPubKey: { hex: string; address?: string } };
    let tx: { hex: string; vsize: number; confirmations?: number; vout: Vout[] };
    try {
      tx = await rpc.call('getrawtransaction', txid, 1);
    } catch {
      return null;
    }
    const entry = await rpc.call<{ fees: { base: number } }>('getmempoolentry', txid).catch(() => null);
    const confirmations = tx.confirmations ?? 0;
    return {
      txid,
      hex: tx.hex,
      vsize: tx.vsize,
      inMempool: entry !== null,
      fee: entry ? sats(entry.fees.base) : null,
      confirmations,
      height: confirmations > 0 ? watcher.tip.height - confirmations + 1 : null,
      outputs: tx.vout.map((o) => ({ n: o.n, value: sats(o.value), script: o.scriptPubKey.hex, address: o.scriptPubKey.address ?? null })),
    };
  }

  // What a mined transaction paid never changes, so each one is read from the node once.
  const fees = new Map<string, Promise<{ fee: number | null; vsize: number }>>();
  function paid(txid: string, block: BlockInfo) {
    const id = `${block.hash}:${txid}`;
    let found = fees.get(id);
    if (!found) {
      found = rpc
        .call<{ vsize: number; fee?: number }>('getrawtransaction', txid, 2, block.hash)
        .then((tx) => ({ fee: tx.fee === undefined ? null : sats(tx.fee), vsize: tx.vsize }));
      fees.set(id, found);
      found.catch(() => fees.delete(id));
      if (fees.size > 2000) fees.delete(fees.keys().next().value!);
    }
    return found;
  }

  // Every claim for bitmap n in the recent blocks from n on, in chain order, with what each one paid.
  function battleLog(n: number): Promise<BattleClaim[]> {
    const claims = watcher.blocks.filter((b) => b.height >= n).flatMap((b) => b.claims.filter((c) => c.n === n).map((c) => ({ c, b })));
    return Promise.all(
      claims.slice(0, 50).map(async ({ c, b }) => {
        const { fee, vsize } = await paid(c.txid, b);
        const rate = fee === null ? null : Math.round((fee / vsize) * 100) / 100;
        return {
          txid: c.txid,
          inscription: c.inscription,
          block: b.height,
          pool: b.pool,
          owner: c.address,
          ghost: deps.ghosts.has(c.address),
          unseen: c.unseen,
          position: c.position,
          valid: c.valid,
          key: c.key?.slice(0, 8) ?? null,
          fee,
          vsize,
          rate,
        };
      }),
    );
  }

  async function outspend(txid: string, vout: number) {
    const out = await rpc.call<{ confirmations: number } | null>('gettxout', txid, vout, true);
    if (out) return { unspent: true, spender: null, confirmations: out.confirmations };
    const spends = await rpc.call<{ spendingtxid?: string }[]>('gettxspendingprevout', [{ txid, vout }]).catch(() => []);
    return { unspent: false, spender: spends[0]?.spendingtxid ?? null, confirmations: null };
  }

  const config = () => ({
    network: cfg.network,
    postage: POSTAGE,
    broadcast: BROADCAST[cfg.network],
    vapidKey: push.publicKey,
    dev: dev !== null,
    tipAddress: cfg.tipAddress,
    tipAmounts: cfg.tipAmounts,
  });

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === '/api/config') return send(res, 200, config());
    if (method === 'GET' && path === '/api/state') return send(res, 200, deps.state());
    if (method === 'GET' && (m = path.match(/^\/api\/tx\/([0-9a-f]{64})$/))) {
      const info = await txInfo(m[1]);
      return info ? send(res, 200, info) : send(res, 404, { error: 'this node does not know that transaction' });
    }
    if (method === 'GET' && (m = path.match(/^\/api\/cluster\/([0-9a-f]{64})$/))) {
      const cluster: ClusterTx[] = await watcher.cluster(m[1]);
      return send(res, 200, { cluster });
    }
    if (method === 'GET' && (m = path.match(/^\/api\/outspend\/([0-9a-f]{64})\/(\d{1,5})$/))) {
      return send(res, 200, await outspend(m[1], Number(m[2])));
    }
    if (method === 'GET' && (m = path.match(/^\/api\/bitmap\/(\d{1,8})$/))) {
      const claimed = deps.bitmaps.claimed(Number(m[1]));
      return send(res, 200, { n: Number(m[1]), claimed: claimed === undefined ? 'unknown' : claimed, scannedTo: deps.bitmaps.scannedTo });
    }
    if (method === 'GET' && path === '/api/unclaimed') {
      return send(res, 200, { numbers: deps.bitmaps.unclaimed(watcher.tip.height, 30) });
    }
    if (method === 'GET' && (m = path.match(/^\/api\/block\/(\d+)\/sizes$/))) {
      const block = watcher.blocks.find((b) => b.height === Number(m![1]));
      return block ? send(res, 200, { height: block.height, sizes: block.sizes }) : send(res, 404, { error: 'not a recent block' });
    }
    if (method === 'GET' && (m = path.match(/^\/api\/block\/(\d+)\/battle$/))) {
      const n = Number(m[1]);
      if (!watcher.blocks.some((b) => b.height === n)) return send(res, 404, { error: 'not a recent block' });
      return send(res, 200, { height: n, claims: await battleLog(n) });
    }
    if (method === 'POST' && path.startsWith('/api/seat')) {
      const b = await body(req);
      if (!validPlayer(b.player)) throw new HttpError(400, 'bad player id');
      const n = bitmapNumber(b.n);
      if (path === '/api/seat') {
        const tip = watcher.tip.height;
        if (n > tip + 2) throw new HttpError(400, 'that battle has not started yet');
        if (n <= tip && deps.bitmaps.claimed(n) !== null) throw new HttpError(409, 'that bitmap already has an owner');
        const r = seats.take(n, b.player, clientIp(req));
        if (r === 'taken') throw new HttpError(409, 'another player already sits at this table');
        if (r === 'limit') throw new HttpError(429, 'you already hold two seats');
        return send(res, 200, { ok: true });
      }
      if (path === '/api/seat/release') return send(res, 200, { ok: seats.release(n, b.player) });
      if (path === '/api/seat/funded') {
        if (typeof b.txid !== 'string' || !TXID.test(b.txid)) throw new HttpError(400, 'bad txid');
        return send(res, 200, { ok: seats.fund(n, b.player, b.txid) });
      }
    }
    if (method === 'POST' && path === '/api/push/subscribe') {
      const b = await body(req);
      if (!push.subscribe(b.subscription)) throw new HttpError(400, 'bad push subscription');
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/push/unsubscribe') {
      push.unsubscribe((await body(req)).endpoint);
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'no such API');
  }

  async function devApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!dev) throw new HttpError(404, 'the dev tools exist on regtest only');
    if (req.method === 'GET' && path === '/dev/status') return send(res, 200, dev.status());
    const coins = req.method === 'GET' ? path.match(/^\/dev\/utxos\/([a-z0-9]{20,90})$/) : null;
    if (coins) return send(res, 200, await dev.utxos(coins[1]));
    if (req.method !== 'POST') throw new HttpError(404, 'no such dev API');
    const b = await body(req);
    if (path === '/dev/send') {
      const amount = Number(b.amount);
      if (typeof b.address !== 'string' || !Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'address and amount (sats) needed');
      return send(res, 200, { txid: await dev.send(b.address, amount) });
    }
    if (path === '/dev/mine') return send(res, 200, { hashes: await dev.mine(Math.min(100, Math.max(1, Number(b.blocks) || 1))) });
    if (path === '/dev/faucet') return send(res, 200, { txid: await dev.faucet() });
    if (path === '/dev/broadcast') {
      if (typeof b.hex !== 'string') throw new HttpError(400, 'hex needed');
      return send(res, 200, { txid: await dev.broadcast(b.hex) });
    }
    if (path === '/dev/rival') {
      if (typeof b.enabled === 'boolean') dev.rival.enabled = b.enabled;
      if (Number(b.maxRate) > 0) dev.rival.maxRate = Number(b.maxRate);
      return send(res, 200, dev.status());
    }
    if (path === '/dev/automine') {
      dev.setAutomine(Number(b.seconds) || 0);
      return send(res, 200, dev.status());
    }
    throw new HttpError(404, 'no such dev API');
  }

  function file(res: ServerResponse, path: string): void {
    if (!existsSync(cfg.webDir)) {
      res.writeHead(503, { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      res.end('The web app is not built yet: run "npm run build" in the bitmap-battle folder.');
      return;
    }
    let target = normalize(join(cfg.webDir, decodeURIComponent(path)));
    if (!target.startsWith(cfg.webDir + sep) && target !== cfg.webDir) target = cfg.webDir;
    if (!existsSync(target) || statSync(target).isDirectory()) target = join(cfg.webDir, 'index.html');
    const immutable = target.includes(`${sep}assets${sep}`);
    // A new build replaces the files while the server runs: a file gone for a moment is a retry, not a crash.
    const stream = createReadStream(target);
    stream.once('open', () => {
      res.writeHead(200, {
        ...HEADERS,
        'content-type': MIME[extname(target)] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      stream.pipe(res);
    });
    stream.once('error', () => {
      if (res.headersSent) return void res.destroy();
      res.writeHead(503, { ...HEADERS, 'content-type': 'text/plain; charset=utf-8', 'retry-after': '3', 'cache-control': 'no-store' });
      res.end('Bitmap Battle is updating. Reload in a moment.');
    });
  }

  const limiter = new Limiter(10, 40);
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    const handler = path.startsWith('/api/') ? api : path.startsWith('/dev/') ? devApi : null;
    if (!handler) return file(res, path);
    if (!limiter.allow(clientIp(req))) return send(res, 429, { error: 'too many requests, slow down' });
    handler(req, res, path).catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof RpcError) return send(res, 400, { error: e.message, code: e.code });
      log(`${req.method} ${path}: ${(e as Error).message}`);
      send(res, 500, { error: 'server error' });
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', state: deps.state() }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'hello' && validPlayer(msg.player)) seats.touch(msg.player);
      } catch {}
    });
  });
  const everyone = (msg: unknown) => {
    const text = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  };

  let last = 0;
  let pending: NodeJS.Timeout | null = null;
  const publish = () => {
    if (pending) return;
    const wait = Math.max(0, 500 - (Date.now() - last));
    pending = setTimeout(() => {
      pending = null;
      last = Date.now();
      everyone({ type: 'state', state: deps.state() });
    }, wait);
  };

  server.listen(cfg.port, cfg.host);
  return {
    publish,
    publishBlock: (block: BlockInfo) => everyone({ type: 'block', height: block.height, claims: block.claims.length }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

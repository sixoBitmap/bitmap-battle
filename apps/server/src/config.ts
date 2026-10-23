import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Network } from '@bitmap-battle/core';

export type Config = {
  network: Network;
  host: string;
  port: number;
  rpcUrl: string;
  rpcAuth: () => string;
  rpcAuthSource: string;
  dataDir: string;
  bitmapDb: string | null;
  webDir: string;
  pollMs: number;
  vapidSubject: string;
  tipAddress: string | null;
  tipAmounts: number[];
  // Where ghost runs send their claims: 'dev' for the regtest stand-in, or null for no ghost runs.
  slipstream: string | null;
};

const RPC_PORTS: Record<Network, number> = { mainnet: 8332, testnet: 18332, testnet4: 48332, signet: 38332, regtest: 18443 };
const NETWORKS = Object.keys(RPC_PORTS) as Network[];

function options(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const eq = arg.indexOf('=');
    if (eq !== -1) out.set(arg.slice(2, eq), arg.slice(eq + 1));
    else out.set(arg.slice(2), argv[++i] ?? '');
  }
  return out;
}

function cookieCandidates(network: Network): string[] {
  const sub = network === 'mainnet' ? '' : network === 'testnet' ? 'testnet3' : network;
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') dirs.push(`${drive}:\\Bitcoin Core\\data`);
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'Bitcoin'));
  } else if (process.env.HOME) {
    dirs.push(join(process.env.HOME, '.bitcoin'), join(process.env.HOME, 'Library/Application Support/Bitcoin'));
  }
  return dirs.map((d) => join(d, sub, '.cookie'));
}

// Ghost runs work on regtest only for now, against the local stand-in for a private pool.
function slipstreamFor(network: Network, option: string | undefined): string | null {
  return network === 'regtest' && option !== 'off' ? 'dev' : null;
}

export function loadConfig(argv = process.argv.slice(2)): Config {
  const o = options(argv);
  const get = (name: string, env: string) => o.get(name) ?? process.env[env];
  const network = (get('network', 'BB_NETWORK') ?? 'mainnet') as Network;
  if (!NETWORKS.includes(network)) throw new Error(`--network must be one of ${NETWORKS.join(', ')}`);

  const rpcUrl = get('rpc-url', 'BB_RPC_URL') ?? `http://127.0.0.1:${RPC_PORTS[network]}`;
  const user = get('rpc-user', 'BB_RPC_USER');
  const password = get('rpc-password', 'BB_RPC_PASSWORD');
  let rpcAuth: () => string;
  let rpcAuthSource: string;
  if (user !== undefined && password !== undefined) {
    const token = Buffer.from(`${user}:${password}`).toString('base64');
    rpcAuth = () => token;
    rpcAuthSource = `user ${user}`;
  } else {
    const cookie = get('rpc-cookie', 'BB_RPC_COOKIE') ?? cookieCandidates(network).find((p) => existsSync(p));
    if (!cookie) throw new Error('no RPC login: pass --rpc-cookie <path to .cookie> or --rpc-user and --rpc-password');
    rpcAuth = () => Buffer.from(readFileSync(cookie, 'utf8').trim()).toString('base64');
    rpcAuthSource = cookie;
  }

  const root = resolve(import.meta.dirname, '../../..');
  const dataDir = resolve(get('data-dir', 'BB_DATA_DIR') ?? join(root, 'data', network));
  const db = get('bitmap-db', 'BB_BITMAP_DB');
  return {
    network,
    host: get('host', 'BB_HOST') ?? '127.0.0.1',
    port: Number(get('port', 'BB_PORT') ?? 8787),
    rpcUrl,
    rpcAuth,
    rpcAuthSource,
    dataDir,
    bitmapDb: db ? resolve(db) : null,
    webDir: resolve(get('web-dir', 'BB_WEB_DIR') ?? join(root, 'apps/web/dist')),
    pollMs: Number(get('poll-ms', 'BB_POLL_MS') ?? 2000),
    vapidSubject: get('vapid-subject', 'BB_VAPID_SUBJECT') ?? 'mailto:bitmap-battle@users.noreply.github.com',
    tipAddress: get('tip-address', 'BB_TIP_ADDRESS')?.trim() || null,
    tipAmounts: (get('tip-amounts', 'BB_TIP_AMOUNTS') ?? '1000,5000,21000')
      .split(',')
      .map(Number)
      .filter((x) => Number.isSafeInteger(x) && x >= 546),
    slipstream: slipstreamFor(network, get('slipstream', 'BB_SLIPSTREAM')),
  };
}

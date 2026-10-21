// Starts a private regtest node (play money) and the Bitmap Battle server on it, with the test wallet, block
// mining and the rival bot. Usage: npm run regtest [-- --port 8788 --bitcoind <path to bitcoind>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const root = fileURLToPath(new URL('..', import.meta.url));
const datadir = fileURLToPath(new URL('../data/regtest-node', import.meta.url));
const port = opt('port', '8788');
const rpc = { url: 'http://127.0.0.1:18443', user: 'dev', password: 'dev' };

function findBitcoind() {
  const given = opt('bitcoind', process.env.BITCOIND);
  if (given) return given;
  const candidates = ['C:\\Program Files\\Bitcoin\\daemon\\bitcoind.exe'];
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') candidates.unshift(`${d}:\\Bitcoin Core\\bin\\bitcoind.exe`);
  candidates.push('/usr/local/bin/bitcoind', '/usr/bin/bitcoind', '/opt/homebrew/bin/bitcoind');
  return candidates.find((p) => existsSync(p)) ?? 'bitcoind';
}

async function call(method, params = []) {
  const res = await fetch(rpc.url, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${rpc.user}:${rpc.password}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const up = () => call('getblockcount').then(() => true, () => false);

if (!(await up())) {
  mkdirSync(datadir, { recursive: true });
  const bitcoind = findBitcoind();
  console.log(`starting a regtest node: ${bitcoind}`);
  const node = spawn(
    bitcoind,
    [
      '-regtest',
      `-datadir=${datadir}`,
      '-server',
      '-listen=0',
      '-rest',
      '-txindex',
      '-fallbackfee=0.0001',
      '-dbcache=50',
      '-rpcbind=127.0.0.1',
      '-rpcallowip=127.0.0.1',
      `-rpcuser=${rpc.user}`,
      `-rpcpassword=${rpc.password}`,
    ],
    { stdio: 'ignore', detached: true },
  );
  node.unref();
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) throw new Error('the regtest node did not start');
}
console.log(`regtest node ready at height ${await call('getblockcount')}`);

const server = spawn(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--import',
    'tsx',
    'apps/server/src/main.ts',
    '--network',
    'regtest',
    '--rpc-url',
    rpc.url,
    '--rpc-user',
    rpc.user,
    '--rpc-password',
    rpc.password,
    '--port',
    port,
    '--poll-ms',
    '1000',
  ],
  { cwd: root, stdio: 'inherit' },
);

const stop = async () => {
  server.kill();
  if (!args.includes('--keep-node')) await call('stop').catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));

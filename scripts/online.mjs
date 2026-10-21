// Puts the app online through a free Cloudflare quick tunnel: no account, no router changes. Prints the public
// https address and a QR code that opens it inside the Xverse app. Usage: npm run online [-- --port 8787]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const root = fileURLToPath(new URL('..', import.meta.url));
const port = opt('port', '8787');
const local = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findCloudflared() {
  const candidates = [
    opt('cloudflared', process.env.CLOUDFLARED),
    `${root}tools\\cloudflared.exe`,
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ];
  return candidates.find((p) => p && existsSync(p)) ?? 'cloudflared';
}

const serverUp = () =>
  fetch(`${local}/api/config`)
    .then((r) => r.ok)
    .catch(() => false);

if (!(await serverUp())) {
  if (process.platform === 'win32' && port === '8787') {
    console.log('The app is not running yet: starting start_mainnet.cmd in its own window.');
    spawn('cmd.exe', ['/c', 'start', '"Bitmap Battle"', 'start_mainnet.cmd'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
  } else {
    console.log(`Nothing answers on ${local}. Start the app first (npm start).`);
  }
  for (let i = 0; i < 120 && !(await serverUp()); i++) await sleep(1000);
  if (!(await serverUp())) {
    console.error(`The app did not start on ${local}.`);
    process.exit(1);
  }
}

console.log(`Opening a Cloudflare tunnel to ${local} …`);
const tunnel = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', local], { stdio: ['ignore', 'pipe', 'pipe'] });
tunnel.on('error', (e) => {
  console.error(`Could not run cloudflared: ${e.message}`);
  process.exit(1);
});

let announced = false;
const watch = async (chunk) => {
  for (const line of String(chunk).split(/\r?\n/)) {
    const url = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (url && !announced) {
      announced = true;
      await announce(url);
    } else if (/\bERR\b|error/i.test(line) && !/context canceled/.test(line)) {
      console.log(line.trim());
    }
  }
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);
tunnel.on('exit', (code) => {
  console.log(`The tunnel closed (code ${code}). The app is offline until you start this again.`);
  process.exit(code ?? 0);
});

async function announce(url) {
  mkdirSync(`${root}data`, { recursive: true });
  writeFileSync(`${root}data/public-url.txt`, `${url}\n`);
  const xverse = `https://connect.xverse.app/browser?url=${encodeURIComponent(url)}`;
  for (let i = 0; i < 30; i++) {
    const ok = await fetch(`${url}/api/config`).then((r) => r.ok, () => false);
    if (ok) break;
    await sleep(1000);
  }
  const qr = await QRCode.toString(xverse, { type: 'terminal', small: true });
  console.log(`
==================================================================
  Bitmap Battle is ONLINE

  Public address:  ${url}
  Open in Xverse:  ${xverse}

  Scan with your phone's camera to open it inside the Xverse app:
==================================================================
${qr}
  Keep this window open. Closing it takes the app offline.
  The address changes every time the tunnel starts.
`);
}

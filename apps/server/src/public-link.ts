import { existsSync, readFileSync, watchFile } from 'node:fs';
import QRCode from 'qrcode';
import { log } from './log.ts';

const HOURLY = 60 * 60_000;

// Prints the public address the tunnel (start_online.cmd) wrote, with a QR code that opens it in the Xverse
// app: at start, whenever the address changes, and every hour, so this window always has it.
export function announcePublicLink(file: string): void {
  let last = '';
  const show = async (force: boolean) => {
    if (!existsSync(file)) return;
    const url = readFileSync(file, 'utf8').trim();
    if (!url || (url === last && !force)) return;
    last = url;
    const online = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(10_000) }).then(
      (r) => r.ok,
      () => false,
    );
    const xverse = `https://connect.xverse.app/browser?url=${encodeURIComponent(url)}`;
    const qr = await QRCode.toString(xverse, { type: 'terminal', small: true });
    log(online ? 'public link is ONLINE' : 'public link is OFFLINE: start start_online.cmd to open the tunnel');
    console.log(`
  Link:            ${url}
  Open in Xverse:  ${xverse}
  Scan with a phone camera to open it inside the Xverse app:
${qr}`);
  };
  setTimeout(() => void show(true), 4000);
  watchFile(file, { interval: 5000 }, () => void show(false));
  setInterval(() => void show(true), HOURLY).unref();
}

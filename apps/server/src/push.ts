import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush, { type PushSubscription } from 'web-push';
import { log } from './log.ts';

export type Notice = { title: string; body: string; url: string; tag: string };

const MAX_SUBSCRIPTIONS = 5000;

export class Push {
  readonly publicKey: string;
  private readonly subs = new Map<string, PushSubscription>();
  private readonly subsFile: string;

  constructor(dataDir: string, subject: string) {
    const keysFile = join(dataDir, 'vapid.json');
    if (!existsSync(keysFile)) writeFileSync(keysFile, JSON.stringify(webpush.generateVAPIDKeys()));
    const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as { publicKey: string; privateKey: string };
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    this.publicKey = keys.publicKey;
    this.subsFile = join(dataDir, 'push.json');
    if (existsSync(this.subsFile)) {
      for (const s of JSON.parse(readFileSync(this.subsFile, 'utf8')) as PushSubscription[]) this.subs.set(s.endpoint, s);
    }
  }

  get count(): number {
    return this.subs.size;
  }

  subscribe(sub: unknown): boolean {
    const s = sub as PushSubscription;
    if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || !s.keys?.p256dh || !s.keys?.auth) return false;
    if (s.endpoint.length > 1000 || (this.subs.size >= MAX_SUBSCRIPTIONS && !this.subs.has(s.endpoint))) return false;
    this.subs.set(s.endpoint, { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
    this.save();
    return true;
  }

  unsubscribe(endpoint: unknown): void {
    if (typeof endpoint === 'string' && this.subs.delete(endpoint)) this.save();
  }

  async notify(notice: Notice): Promise<void> {
    if (this.subs.size === 0) return;
    let gone = 0;
    await Promise.all(
      [...this.subs.values()].map((s) =>
        webpush.sendNotification(s, JSON.stringify(notice), { TTL: 600, urgency: 'high', topic: notice.tag.slice(0, 32) }).catch((e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) {
            this.subs.delete(s.endpoint);
            gone++;
          }
        }),
      ),
    );
    if (gone) this.save();
    log(`notified ${this.subs.size} device(s): ${notice.title}`);
  }

  private save(): void {
    writeFileSync(this.subsFile, JSON.stringify([...this.subs.values()]));
  }
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

type Reply = { result: unknown; error: { code: number; message: string } | null; id: number };

export class Rpc {
  private id = 0;

  constructor(
    private readonly url: string,
    private readonly auth: () => string,
  ) {}

  private async post(body: unknown): Promise<unknown> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { authorization: `Basic ${this.auth()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) throw new RpcError('the node refused the RPC login', -401);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new RpcError(`bad reply from the node (HTTP ${res.status}): ${text.slice(0, 200)}`, -1);
    }
  }

  async call<T>(method: string, ...params: unknown[]): Promise<T> {
    const reply = (await this.post({ jsonrpc: '1.0', id: ++this.id, method, params })) as Reply;
    if (reply.error) throw new RpcError(reply.error.message, reply.error.code);
    return reply.result as T;
  }

  // One request per parameter list, sent together; a failed item comes back as null.
  async batch<T>(method: string, params: unknown[][]): Promise<(T | null)[]> {
    if (params.length === 0) return [];
    const first = this.id + 1;
    this.id += params.length;
    const replies = (await this.post(params.map((p, i) => ({ jsonrpc: '1.0', id: first + i, method, params: p })))) as Reply[];
    if (!Array.isArray(replies)) throw new RpcError(`batch ${method} failed`, -1);
    const out: (T | null)[] = new Array(params.length).fill(null);
    for (const r of replies) if (!r.error) out[r.id - first] = r.result as T;
    return out;
  }

  async block(hash: string): Promise<Uint8Array> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/block/${hash}.bin`, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    const hex = await this.call<string>('getblock', hash, 0);
    return Uint8Array.from(Buffer.from(hex, 'hex'));
  }
}

/**
 * Zero-network guard for the ML worker. Installed before transformers.js is imported, it refuses any
 * fetch or XHR outside the worker's own origin (the extension, or the app's own site), so a missed
 * library default fails loudly instead of sending a request. blob: is allowed: the ONNX runtime uses it
 * for its own in-memory files.
 */
export interface GuardScope {
  fetch: typeof fetch;
  XMLHttpRequest?: { prototype: { open: (...a: any[]) => void } };
}

export class BlockedRequestError extends Error {
  constructor(readonly url: string) {
    super(`VaultSnip blocked a network request from the ML worker: ${url}`);
    this.name = 'BlockedRequestError';
  }
}

/**
 * `origin` is the worker's own origin. `also` may name further first-party origins, such as the VaultSnip
 * site the store extension downloads its model from; nothing else is ever allowed.
 */
export function installNetworkGuard(scope: GuardScope, origin: string, blocked: string[] = [], also: string[] = []): string[] {
  // Compared by protocol and host, not URL.origin: for chrome-extension:// that can be the opaque "null",
  // and "null" === "null" would let every opaque-origin URL through.
  const owns = [origin, ...also].map((o) => {
    const u = new URL(o);
    if (!u.host) throw new Error(`network guard needs an origin with a host, got "${o}"`);
    return u;
  });
  const allowed = (raw: string) => {
    try {
      const u = new URL(raw, owns[0]);
      return u.protocol === 'blob:' || owns.some((o) => u.protocol === o.protocol && u.host === o.host);
    } catch {
      return false;
    }
  };
  const realFetch = scope.fetch.bind(scope);
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!allowed(url)) {
      blocked.push(url);
      return Promise.reject(new BlockedRequestError(url));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const xhr = scope.XMLHttpRequest?.prototype;
  if (xhr) {
    const realOpen = xhr.open;
    xhr.open = function (this: unknown, method: string, url: string | URL, ...rest: unknown[]) {
      if (!allowed(String(url))) {
        blocked.push(String(url));
        throw new BlockedRequestError(String(url));
      }
      return realOpen.call(this, method, url, ...rest);
    };
  }
  return blocked;
}

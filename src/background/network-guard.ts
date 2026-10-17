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

export function installNetworkGuard(scope: GuardScope, origin: string, blocked: string[] = []): string[] {
  // Compared by protocol and host, not URL.origin: for chrome-extension:// that can be the opaque "null",
  // and "null" === "null" would let every opaque-origin URL through.
  const own = new URL(origin);
  if (!own.host) throw new Error(`network guard needs an origin with a host, got "${origin}"`);
  const allowed = (raw: string) => {
    try {
      const u = new URL(raw, own);
      return u.protocol === 'blob:' || (u.protocol === own.protocol && u.host === own.host);
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

/**
 * Where the ML worker's model files come from (Feature 2).
 *
 * transformers.js asks for files under a local path ("/app/models/…"). This layer, installed on top of the
 * network guard, can (a) fetch them from VaultSnip's own site instead (the store extension does not bundle
 * the model, as it does not bundle the OCR language data) and (b) unpack the model from .onnx.gz: the web
 * app's host refuses single files over 25 MiB, and the int8 model is 28.7 MB (19.5 MB gzipped).
 */
export interface ModelSource {
  /** Path transformers.js uses, e.g. "/app/models/". */
  localPath: string;
  /** Absolute URL to fetch from instead, or null to fetch localPath itself. */
  remoteBase: string | null;
  /** Model weights are stored as .onnx.gz. */
  gzip: boolean;
}

/** Worker URL query: ?models=<url or path>&gz=1. Default: ../models/ next to the worker, gzipped. */
export function modelSource(workerUrl: string): ModelSource {
  const u = new URL(workerUrl);
  const local = new URL('../models/', u);
  const given = u.searchParams.get('models');
  const target = given ? new URL(given, u) : local;
  return {
    localPath: local.pathname,
    remoteBase: target.href === local.href ? null : target.href,
    gzip: u.searchParams.get('gz') !== '0',
  };
}

export function installModelFiles(scope: { fetch: typeof fetch }, src: ModelSource, origin: string): void {
  const inner = scope.fetch.bind(scope);
  scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin || !url.pathname.startsWith(src.localPath)) return inner(input, init);
    let target = src.remoteBase ? new URL(url.pathname.slice(src.localPath.length), src.remoteBase).href : url.href;
    if (!(src.gzip && target.endsWith('.onnx'))) return inner(target, init);
    target += '.gz';
    const res = await inner(target);
    if (!res.ok || !res.body) return res;
    return new Response(res.body.pipeThrough(new DecompressionStream('gzip')), {
      status: 200, headers: { 'content-type': 'application/octet-stream' },
    });
  }) as typeof fetch;
}

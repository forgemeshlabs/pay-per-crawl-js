// Shared glue: framework request -> core gate, env config, optional Pro reporter.
import {
  createGate, createProReporter, parseConfig, memoryStore, proEnabled, dohResolver,
} from "@forgemeshlabs/pay-per-crawl-core";

/**
 * Build the gate once. Options win over env vars (PAY_TO, PRICE_USD, MODE, ...).
 * @param {object} options gate options plus `pro: {key, listed}` and `env`
 * @param {() => Promise<object>|object} [defaultResolver] rDNS resolver used when none is passed
 */
export function buildRuntime(options = {}, defaultResolver) {
  const env = options.env || process.env;
  const fromEnv = Object.fromEntries(Object.entries(parseConfig(env)).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
  const defined = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const opts = { ...fromEnv, ...defined };
  const store = opts.store || memoryStore();
  const key = (options.pro && options.pro.key) || env.PRO_KEY;
  const reporter = proEnabled(key)
    ? createProReporter({
        key, store, fetch: opts.fetch,
        site: { host: "", url: "", name: opts.siteName || "", mode: opts.mode || "monitor", price_usd: opts.priceUsd ?? 0.01, pay_to: opts.payTo || "", listed: !(options.pro && options.pro.listed === false) },
      })
    : null;
  const userOnEvent = opts.onEvent;
  const gate = createGate({
    resolver: defaultResolver ? defaultResolver() : dohResolver({ fetch: opts.fetch }),
    ...opts,
    store,
    catalog: opts.catalog || (reporter ? () => reporter.catalog() : undefined),
    onEvent: async (e) => {
      if (reporter) await reporter.record(e);
      if (userOnEvent) await userOnEvent(e);
    },
  });
  let lastFlush = 0;
  return {
    gate,
    reporter,
    trust: opts.trustHeader || "",
    /** Hourly-ish background flush of the Pro batch (no-op without a key). */
    maybeFlush() {
      if (reporter && Date.now() - lastFlush > 600_000) {
        lastFlush = Date.now();
        reporter.flush().catch(() => {});
      }
    },
  };
}

/** Node IncomingMessage-ish -> Web Request (headers + method + absolute URL; no body needed by the gate). */
export function toWebRequest(nodeReq, { baseUrl, path } = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(nodeReq.headers || {})) {
    if (v === undefined) continue;
    try { h.set(k, Array.isArray(v) ? v.join(", ") : String(v)); } catch { /* skip invalid header */ }
  }
  let origin = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  if (!origin) {
    const proto = (nodeReq.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (nodeReq.socket && nodeReq.socket.encrypted ? "https" : "http");
    origin = `${proto}://${nodeReq.headers.host || "localhost"}`;
  }
  return new Request(origin + (path || nodeReq.url || "/"), { method: nodeReq.method || "GET", headers: h });
}

export const remoteIp = (nodeReq) => (nodeReq.socket && nodeReq.socket.remoteAddress) || "";

/** Write a Web Response to a Node ServerResponse. */
export async function sendWeb(res, web, method) {
  res.statusCode = web.status;
  for (const [k, v] of web.headers) res.setHeader(k, v);
  if (method === "HEAD" || web.body === null) return res.end();
  res.end(Buffer.from(await web.arrayBuffer()));
}

/**
 * Run the gate for a Node request. Returns {response} to send, or {headers} to set before continuing.
 */
export async function check(rt, nodeReq, path) {
  const request = toWebRequest(nodeReq, { baseUrl: rt.gate.settings.baseUrl, path });
  const d = rt.gate.discovery(request);
  if (d) return { response: d };
  const result = await rt.gate.handle(request, { ip: remoteIp(nodeReq) });
  if (result.type === "respond") return { response: result.response };
  rt.maybeFlush();
  return { headers: result.headers };
}

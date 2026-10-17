// ForgeMesh Pay-per-Crawl for Next.js (middleware / proxy). Edge-runtime compatible:
// only Web APIs, DNS-over-HTTPS for rDNS, no Node-only imports.
import { NextResponse } from "next/server.js";
import {
  createGate, createProReporter, parseConfig, dohResolver, memoryStore, proEnabled, discoveryResponse,
} from "@forgemeshlabs/pay-per-crawl-core";

const DEFAULT_ALLOW = ["/_next/"];

/** Matcher string worth copying into your own `export const config` (Next requires it to be a literal in middleware.js). */
export const recommendedMatcher = "/((?!_next/static|_next/image|favicon.ico).*)";

/**
 * @param {import("@forgemeshlabs/pay-per-crawl-core").GateOptions & {pro?: {key?: string, listed?: boolean}, env?: Record<string,string|undefined>}} [options]
 *   Options win over env vars (PAY_TO, PRICE_USD, MODE, FACILITATOR_URL, CLASS_POLICY, BOT_OVERRIDES, ALLOW_PATHS, MPP_SECRET, ...).
 */
export function createPayPerCrawl(options = {}) {
  let rt = null;
  const build = () => {
    if (rt) return rt;
    const env = options.env || (typeof process !== "undefined" ? process.env : {});
    const fromEnv = parseConfig(env);
    const defined = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
    const opts = { ...Object.fromEntries(Object.entries(fromEnv).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))), ...defined };
    opts.allowPaths = [...DEFAULT_ALLOW, ...(opts.allowPaths || [])];
    opts.trustHeader = opts.trustHeader === undefined ? "x-forwarded-for" : opts.trustHeader;
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
      resolver: dohResolver({ fetch: opts.fetch }),
      ...opts,
      store,
      catalog: opts.catalog || (reporter ? () => reporter.catalog() : undefined),
      onEvent: async (e) => {
        if (reporter) await reporter.record(e);
        if (userOnEvent) await userOnEvent(e);
      },
    });
    rt = { gate, reporter, lastFlush: 0 };
    return rt;
  };

  async function middleware(request, event) {
    try {
      const r = build();
      const d = r.gate.discovery(request);
      if (d) return d;
      const result = await r.gate.handle(request, { waitUntil: event && event.waitUntil ? event.waitUntil.bind(event) : undefined });
      if (result.type === "respond") return result.response;
      if (r.reporter && event && event.waitUntil && Date.now() - r.lastFlush > 600_000) {
        r.lastFlush = Date.now();
        event.waitUntil(r.reporter.flush().catch(() => {}));
      }
      const res = NextResponse.next();
      for (const [k, v] of result.headers) res.headers.set(k, v);
      return res;
    } catch (e) {
      // Fail open: a bug or bad config must never take the site down.
      console.error("[pay-per-crawl] gate error, passing through:", e && e.stack ? e.stack : e);
      return NextResponse.next();
    }
  }

  const route = (path) => ({
    GET: async (request) => {
      const s = build().gate.settings;
      return discoveryResponse(path, s, s.baseUrl || new URL(request.url).origin + "/", "next") || new Response("not found", { status: 404 });
    },
  });

  return {
    middleware,
    /** Same function, for Next 16's `proxy.js` convention: `export const proxy = ppc.middleware`. */
    proxy: middleware,
    /** Route handlers for the discovery files (the middleware serves them too, so these are optional). */
    handlers: { x402Json: route("/.well-known/x402.json"), llmsTxt: route("/llms.txt"), agentsTxt: route("/agents.txt") },
    /** The underlying gate (created lazily on the first request). */
    get gate() { return build().gate; },
  };
}

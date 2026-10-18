// ForgeMesh Pay-per-Crawl for Vercel Edge Middleware (framework-agnostic).
// Works in front of anything Vercel serves: static HTML, Astro, SvelteKit, Vite, Nuxt, Remix, Hugo...
// Next.js projects should use @forgemeshlabs/pay-per-crawl-next instead (same engine, Next-shaped API).
// Only Web APIs are used; search-engine reverse DNS goes over DNS-over-HTTPS.
import {
  createGate, createProReporter, parseConfig, dohResolver, memoryStore, proEnabled, discoveryResponse,
} from "@forgemeshlabs/pay-per-crawl-core";

const DEFAULT_ALLOW = ["/_vercel/"];

/** Matcher worth copying into your own `export const config` (Vercel requires it to be a literal in middleware.js). */
export const recommendedMatcher = "/((?!_vercel|favicon.ico).*)";

/**
 * Vercel's `next()` from `@vercel/edge` is this: a response carrying `x-middleware-next: 1`.
 * Any other header set on it is applied to the response Vercel serves (the static file or framework output).
 * Implemented inline so the package has no Vercel dependency and runs in plain tests.
 */
export function next(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-middleware-next", "1");
  return new Response(null, { headers });
}

/**
 * @param {import("@forgemeshlabs/pay-per-crawl-core").GateOptions & {pro?: {key?: string, listed?: boolean}, env?: Record<string,string|undefined>}} [options]
 *   Options win over env vars (PAY_TO, PRICE_USD, MODE, FACILITATOR_URL, CLASS_POLICY, BOT_OVERRIDES, ALLOW_PATHS, TRUST_HEADER, MPP_SECRET, PRO_KEY ...).
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
    // Vercel appends the real client IP to X-Forwarded-For; the gate reads the right-most entry.
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

  /** `export default ppc.middleware` from your middleware.js. Second argument is Vercel's RequestContext ({ waitUntil }). */
  async function middleware(request, context) {
    try {
      const r = build();
      const d = r.gate.discovery(request);
      if (d) return d;
      const waitUntil = context && context.waitUntil ? context.waitUntil.bind(context) : undefined;
      const result = await r.gate.handle(request, { waitUntil });
      if (result.type === "respond") return result.response;
      if (r.reporter && waitUntil && Date.now() - r.lastFlush > 600_000) {
        r.lastFlush = Date.now();
        waitUntil(r.reporter.flush().catch(() => {}));
      }
      return next({ headers: result.headers });
    } catch (e) {
      // Fail open: a bug or bad config must never take the site down.
      console.error("[pay-per-crawl] gate error, passing through:", e && e.stack ? e.stack : e);
      return next();
    }
  }

  /** Serve one discovery file from an Edge Function (api/...) if you prefer that over the middleware doing it. */
  const route = (path) => async (request) => {
    const s = build().gate.settings;
    return discoveryResponse(path, s, s.baseUrl || new URL(request.url).origin + "/", "vercel") || new Response("not found", { status: 404 });
  };

  return {
    middleware,
    handlers: { x402Json: route("/.well-known/x402.json"), llmsTxt: route("/llms.txt"), agentsTxt: route("/agents.txt") },
    /** The underlying gate (created lazily on the first request). */
    get gate() { return build().gate; },
  };
}

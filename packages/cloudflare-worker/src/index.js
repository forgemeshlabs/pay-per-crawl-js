// ForgeMesh Pay-per-Crawl for Cloudflare Workers.
// Sits in front of any origin (route or custom domain). Everything is configured by env vars;
// KV (PPC_KV), Analytics Engine (PPC_ANALYTICS) and the Pro key are all optional.
import {
  createGate, createProReporter, parseConfig, applyToResponse, dohResolver, kvStore, memoryStore, robotsLines, proEnabled,
} from "@forgemeshlabs/pay-per-crawl-core";

const fallbackStore = memoryStore();
const runtimes = new WeakMap();
let lastFlushTry = 0;

/** Build (once per isolate per env) the gate, store and optional Pro reporter. */
export function buildRuntime(env, overrides = {}) {
  const opts = { ...parseConfig(env), ...overrides };
  const store = env.PPC_KV ? kvStore(env.PPC_KV) : fallbackStore;
  const reporter = proEnabled(env.PRO_KEY)
    ? createProReporter({
        key: env.PRO_KEY, store, fetch: overrides.fetch,
        site: { host: "", url: "", name: opts.siteName || "", mode: opts.mode || "monitor", price_usd: opts.priceUsd ?? 0.01, pay_to: opts.payTo || "", listed: env.PRO_LISTED !== "false" },
      })
    : null;
  const onEvent = async (e) => {
    const jobs = [];
    if (env.PPC_ANALYTICS && e.ua_class !== "human") {
      try {
        env.PPC_ANALYTICS.writeDataPoint({
          blobs: [e.status, e.ua_class, e.bot_name, e.path, e.rail || "", e.tx_hash || "", e.reason || ""],
          doubles: [e.amount_units || 0, 1],
          indexes: [(e.bot_name || e.ua_class).slice(0, 96)],
        });
      } catch { /* analytics is best effort */ }
    }
    if (env.PPC_KV && /^(1|true)$/i.test(String(env.LOG_TO_KV || ""))) {
      jobs.push(env.PPC_KV.put(`ppc:log:${e.ts}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(e), { expirationTtl: 7 * 86400 }));
    }
    if (reporter) jobs.push(reporter.record(e));
    await Promise.all(jobs);
    if (e.status === "paid" && opts.logger !== false) console.log(`[pay-per-crawl] paid ${e.rail} ${e.amount_units} ${e.tx_hash} ${e.bot_name}`);
  };
  const gate = createGate({
    trustHeader: "cf-connecting-ip",
    resolver: dohResolver({ fetch: overrides.fetch }),
    ...opts,
    store,
    onEvent,
    catalog: reporter ? () => reporter.catalog() : undefined,
  });
  return { gate, reporter, opts };
}

function runtimeFor(env, overrides) {
  let rt = runtimes.get(env);
  if (!rt) { rt = buildRuntime(env, overrides); runtimes.set(env, rt); }
  return rt;
}

/** Forward to the origin: ORIGIN_URL rewrites host (workers.dev setups); otherwise plain fetch(request). */
function toOrigin(request, env, fetchFn) {
  if (env.ORIGIN_URL) {
    const o = new URL(env.ORIGIN_URL);
    const u = new URL(request.url);
    u.protocol = o.protocol; u.host = o.host;
    const fwd = new Request(u, request);
    fwd.headers.set("x-forwarded-host", new URL(request.url).host);
    return fetchFn(fwd);
  }
  return fetchFn(request);
}

export async function handleRequest(request, env, ctx, overrides = {}) {
  const fetchFn = overrides.fetch || ((r) => fetch(r));
  let rt;
  try {
    rt = runtimeFor(env, overrides);
    const d = rt.gate.discovery(request);
    if (d) return d;
    const result = await rt.gate.handle(request, { ip: request.headers.get("cf-connecting-ip") || "", waitUntil: ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : undefined });
    if (result.type === "respond") return result.response;

    if (rt.reporter && ctx && ctx.waitUntil && Date.now() - lastFlushTry > 600_000) {
      lastFlushTry = Date.now();
      ctx.waitUntil(rt.reporter.flush().catch(() => {}));
    }
    let res = await toOrigin(request, env, fetchFn);
    const url = new URL(request.url);
    if (rt.gate.settings.discovery && url.pathname === "/robots.txt" && res.ok && /text\/plain/i.test(res.headers.get("content-type") || "")) {
      const text = (await res.text()) + robotsLines(rt.gate.settings.baseUrl || url.origin + "/");
      res = new Response(text, res);
      res.headers.delete("content-length");
    }
    return applyToResponse(res, result.headers);
  } catch (e) {
    // Fail open: a bug or bad config must never take the site down.
    console.error("[pay-per-crawl] gate error, passing through:", e && e.stack ? e.stack : e);
    return toOrigin(request, env, fetchFn);
  }
}

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx),
  async scheduled(_event, env, ctx) {
    const rt = runtimeFor(env, {});
    if (rt.reporter) ctx.waitUntil(rt.reporter.flush({ force: true }));
  },
};

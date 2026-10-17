// Hono middleware (Node, Bun, Deno, Workers). app.use("*", payPerCrawl({ payTo, mode: "gate" }))
import { buildRuntime } from "./common.js";

export function payPerCrawl(options = {}) {
  const rt = buildRuntime(options); // DNS-over-HTTPS rDNS: works on every Hono runtime
  return async function payPerCrawlMiddleware(c, next) {
    let result;
    try {
      const request = options.baseUrl ? new Request(options.baseUrl.replace(/\/+$/, "") + new URL(c.req.url).pathname + new URL(c.req.url).search, c.req.raw) : c.req.raw;
      const d = rt.gate.discovery(request);
      if (d) return d;
      const ip = (c.env && c.env.incoming && c.env.incoming.socket && c.env.incoming.socket.remoteAddress) || "";
      let waitUntil;
      try { waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx); } catch { /* not on Workers */ }
      result = await rt.gate.handle(request, { ip, waitUntil });
    } catch (e) {
      console.error("[pay-per-crawl] gate error, passing through:", e && e.stack ? e.stack : e);
      return next(); // fail open
    }
    if (result.type === "respond") return result.response;
    rt.maybeFlush();
    for (const [k, v] of result.headers) c.header(k, v);
    return next();
  };
}
export default payPerCrawl;

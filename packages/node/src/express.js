// Express / Connect middleware. app.use(payPerCrawl({ payTo, mode: "gate" })) before your routes.
import { buildRuntime, check, sendWeb } from "./common.js";
import { nodeResolver } from "@forgemesh/pay-per-crawl-core/node-dns";

export function payPerCrawl(options = {}) {
  const rt = buildRuntime(options, nodeResolver);
  return async function payPerCrawlMiddleware(req, res, next) {
    try {
      const r = await check(rt, req, req.originalUrl || req.url);
      if (r.response) return await sendWeb(res, r.response, req.method);
      for (const [k, v] of r.headers) res.setHeader(k, v);
      next();
    } catch (e) {
      console.error("[pay-per-crawl] gate error, passing through:", e && e.stack ? e.stack : e);
      next(); // fail open
    }
  };
}
export default payPerCrawl;

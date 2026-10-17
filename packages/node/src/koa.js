// Koa middleware. app.use(payPerCrawl({ payTo, mode: "gate" })) before your routes.
import { buildRuntime, check, sendWeb } from "./common.js";
import { nodeResolver } from "@forgemesh/pay-per-crawl-core/node-dns";

export function payPerCrawl(options = {}) {
  const rt = buildRuntime(options, nodeResolver);
  return async function payPerCrawlMiddleware(ctx, next) {
    let r;
    try {
      r = await check(rt, ctx.req, ctx.originalUrl || ctx.url);
    } catch (e) {
      console.error("[pay-per-crawl] gate error, passing through:", e && e.stack ? e.stack : e);
      return next(); // fail open
    }
    if (r.response) {
      ctx.respond = false; // we write the raw response ourselves
      return sendWeb(ctx.res, r.response, ctx.method);
    }
    for (const [k, v] of r.headers) ctx.set(k, v);
    return next();
  };
}
export default payPerCrawl;

// Fastify plugin. await app.register(payPerCrawl, { payTo, mode: "gate" })
// Applies to every route (skip-override), runs in onRequest before routing.
import { buildRuntime, check } from "./common.js";
import { nodeResolver } from "@forgemesh/pay-per-crawl-core/node-dns";

export async function payPerCrawl(fastify, options = {}) {
  const rt = buildRuntime(options, nodeResolver);
  fastify.addHook("onRequest", async (request, reply) => {
    let r;
    try {
      r = await check(rt, request.raw, request.raw.url);
    } catch (e) {
      request.log.error({ err: e }, "[pay-per-crawl] gate error, passing through");
      return; // fail open
    }
    if (r.response) {
      reply.code(r.response.status);
      for (const [k, v] of r.response.headers) reply.header(k, v);
      return reply.send(request.method === "HEAD" || r.response.body === null ? undefined : Buffer.from(await r.response.arrayBuffer()));
    }
    for (const [k, v] of r.headers) reply.header(k, v);
  });
}
// Same effect as fastify-plugin without the dependency: do not encapsulate the hook.
payPerCrawl[Symbol.for("skip-override")] = true;
payPerCrawl[Symbol.for("fastify.display-name")] = "forgemesh-pay-per-crawl";
export default payPerCrawl;

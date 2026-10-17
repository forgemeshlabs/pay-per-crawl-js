import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import Fastify from "fastify";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import Koa from "koa";
import { payPerCrawl as ex } from "../src/express.js";
import { payPerCrawl as fa } from "../src/fastify.js";
import { payPerCrawl as ho } from "../src/hono.js";
import { payPerCrawl as ko } from "../src/koa.js";

const PAY_TO = "0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09";
const UA_GPT = "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const fac = async (url, init) => {
  const b = JSON.parse(init.body);
  return new Response(JSON.stringify(new URL(url).pathname === "/verify" ? { isValid: true, payer: "0xp" } : { success: true, transaction: "0x" + "12".repeat(32), network: b.paymentRequirements.network }));
};
const opts = () => ({ env: {}, payTo: PAY_TO, mode: "gate", priceUsd: 0.01, mppSecret: "t", fetch: fac, resolver: { reverse: async () => [], forward: async () => [] }, siteName: "T", logger: { warn() {} } });

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

const builders = {
  async express() {
    const app = express(); app.use(ex(opts())); app.get("/paid-test", (_q, r) => r.send("ZZPAIDZZ"));
    const s = http.createServer(app); return { port: await listen(s), close: () => s.close() };
  },
  async fastify() {
    const app = Fastify(); await app.register(fa, opts()); app.get("/paid-test", async () => "ZZPAIDZZ");
    await app.listen({ port: 0, host: "127.0.0.1" }); return { port: app.server.address().port, close: () => app.close() };
  },
  async hono() {
    const app = new Hono(); app.use("*", ho(opts())); app.get("/paid-test", (c) => c.text("ZZPAIDZZ"));
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }); await new Promise((r) => s.on("listening", r));
    return { port: s.address().port, close: () => s.close() };
  },
  async koa() {
    const app = new Koa(); app.use(ko(opts())); app.use((ctx) => { ctx.body = "ZZPAIDZZ"; });
    const s = http.createServer(app.callback()); return { port: await listen(s), close: () => s.close() };
  },
};

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: human free, GPTBot 402 (3 forms), HEAD 402, paid v2 -> content + receipt, replay 402, discovery`, async () => {
    const { port, close } = await build();
    try {
      const u = `http://127.0.0.1:${port}/paid-test`;
      const human = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129 Safari/537.36", accept: "text/html" } });
      assert.equal(human.status, 200); assert.match(await human.text(), /ZZPAIDZZ/);
      const r = await fetch(u, { headers: { "user-agent": UA_GPT } });
      assert.equal(r.status, 402);
      assert.ok(r.headers.get("payment-required")); assert.match(r.headers.get("www-authenticate"), /^Payment id=/);
      assert.equal((await r.json()).x402Version, 1);
      assert.equal((await fetch(u, { method: "HEAD", headers: { "user-agent": UA_GPT } })).status, 402);
      const a = { from: "0x" + "b".repeat(40), to: PAY_TO, value: "10000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + Math.random().toString(16).slice(2).padEnd(64, "0") };
      const sig = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, payload: { signature: "0xs", authorization: a } })).toString("base64");
      const paid = await fetch(u, { headers: { "user-agent": UA_GPT, "payment-signature": sig } });
      assert.equal(paid.status, 200); assert.match(await paid.text(), /ZZPAIDZZ/);
      assert.ok(paid.headers.get("payment-response"));
      assert.equal((await fetch(u, { headers: { "user-agent": UA_GPT, "payment-signature": sig } })).status, 402);
      const m = await (await fetch(`http://127.0.0.1:${port}/.well-known/x402.json`, { headers: { "user-agent": UA_GPT } })).json();
      assert.equal(m.resources[0].accepts[0].payTo, PAY_TO);
    } finally { close(); }
  });
}

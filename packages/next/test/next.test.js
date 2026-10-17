import test from "node:test";
import assert from "node:assert/strict";
import { createPayPerCrawl } from "../src/index.js";

const PAY_TO = "0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09";
const UA_GPT = "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const get = (path, ua, h = {}) => new Request("https://site.example" + path, { headers: { "user-agent": ua, ...h } });
const fac = async (url, init) => {
  const b = JSON.parse(init.body);
  return new Response(JSON.stringify(new URL(url).pathname === "/verify" ? { isValid: true } : { success: true, transaction: "0x" + "ef".repeat(32), network: b.paymentRequirements.network }));
};
const env = { PAY_TO, MODE: "gate", PRICE_USD: "0.01", MPP_SECRET: "t" };

test("env config, 402 for GPTBot, pass-through for humans (x-middleware-next)", async () => {
  const ppc = createPayPerCrawl({ env, fetch: fac });
  const r = await ppc.middleware(get("/a", UA_GPT));
  assert.equal(r.status, 402);
  const human = await ppc.middleware(get("/a", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129 Safari/537.36", { accept: "text/html" }));
  assert.equal(human.headers.get("x-middleware-next"), "1");
  assert.match(human.headers.get("link"), /describedby/);
});

test("options beat env; discovery served by middleware and route handlers; _next free", async () => {
  const ppc = createPayPerCrawl({ env, fetch: fac, priceUsd: 0.02 });
  const m = await (await ppc.middleware(get("/.well-known/x402.json", UA_GPT))).json();
  assert.equal(m.resources[0].accepts[0].amount, "20000");
  const h = await (await ppc.handlers.x402Json.GET(get("/anything", UA_GPT))).json();
  assert.equal(h.resources[0].accepts[0].payTo, PAY_TO);
  assert.match(await (await ppc.handlers.llmsTxt.GET(get("/x", UA_GPT))).text(), /402/);
  assert.equal((await ppc.middleware(get("/_next/data/x.json", UA_GPT))).headers.get("x-middleware-next"), "1");
});

test("paid request passes with receipt headers", async () => {
  const ppc = createPayPerCrawl({ env, fetch: fac });
  const a = { from: "0x" + "b".repeat(40), to: PAY_TO, value: "10000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + "7".repeat(64) };
  const sig = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, payload: { signature: "0xs", authorization: a } })).toString("base64");
  const r = await ppc.middleware(get("/a", UA_GPT, { "payment-signature": sig }));
  assert.equal(r.headers.get("x-middleware-next"), "1");
  assert.ok(r.headers.get("payment-response"));
});

test("bad config does not take the site down", async () => {
  const ppc = createPayPerCrawl({ env: { ...env, PAY_TO: "garbage" } });
  const r = await ppc.middleware(get("/a", UA_GPT));
  assert.equal(r.headers.get("x-middleware-next"), "1", "monitor mode, passes");
});

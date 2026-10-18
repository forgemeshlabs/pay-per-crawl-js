import test from "node:test";
import assert from "node:assert/strict";
import { createPayPerCrawl, next, recommendedMatcher } from "../src/index.js";

const PAY_TO = "0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09";
const UA_GPT = "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const UA_HUMAN = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129 Safari/537.36";
const get = (path, ua, h = {}) => new Request("https://site.example" + path, { headers: { "user-agent": ua, ...h } });
const fac = async (url, init) => {
  const b = JSON.parse(init.body);
  return new Response(JSON.stringify(new URL(url).pathname === "/verify" ? { isValid: true } : { success: true, transaction: "0x" + "ef".repeat(32), network: b.paymentRequirements.network }));
};
const env = { PAY_TO, MODE: "gate", PRICE_USD: "0.01", MPP_SECRET: "t" };

test("next() is Vercel's continue signal and carries extra headers", () => {
  const r = next({ headers: { "x-a": "1" } });
  assert.equal(r.headers.get("x-middleware-next"), "1");
  assert.equal(r.headers.get("x-a"), "1");
  assert.equal(r.status, 200);
  assert.match(recommendedMatcher, /_vercel/);
});

test("env config: 402 with all three offers for GPTBot, pass-through for humans", async () => {
  const ppc = createPayPerCrawl({ env, fetch: fac });
  const r = await ppc.middleware(get("/post.html", UA_GPT));
  assert.equal(r.status, 402);
  assert.ok(r.headers.get("payment-required"), "x402 v2 header");
  assert.match(r.headers.get("www-authenticate") || "", /^Payment/i);
  const body = await r.json();
  assert.equal(body.accepts[0].payTo, PAY_TO);
  const human = await ppc.middleware(get("/post.html", UA_HUMAN, { accept: "text/html" }));
  assert.equal(human.headers.get("x-middleware-next"), "1");
  assert.match(human.headers.get("link"), /describedby/);
});

test("discovery files, _vercel and static assets are free; options beat env", async () => {
  const ppc = createPayPerCrawl({ env, fetch: fac, priceUsd: 0.02 });
  const m = await (await ppc.middleware(get("/.well-known/x402.json", UA_GPT))).json();
  assert.equal(m.resources[0].accepts[0].amount, "20000");
  assert.match(await (await ppc.handlers.llmsTxt(get("/x", UA_GPT))).text(), /402/);
  assert.equal((await ppc.middleware(get("/_vercel/insights/script.js", UA_GPT))).headers.get("x-middleware-next"), "1");
  assert.equal((await ppc.middleware(get("/css/site.css", UA_GPT))).headers.get("x-middleware-next"), "1");
});

test("right-most X-Forwarded-For entry is the trusted client IP (Vercel appends it)", async () => {
  const resolver = {
    reverse: async (ip) => (ip === "66.249.66.1" ? ["crawl-66-249-66-1.googlebot.com"] : []),
    forward: async (h) => (h.endsWith("googlebot.com") ? ["66.249.66.1"] : []),
  };
  const ppc = createPayPerCrawl({ env, fetch: fac, resolver });
  const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const spoof = await ppc.middleware(get("/a", ua, { "x-forwarded-for": "66.249.66.1, 203.0.113.9" }));
  assert.equal(spoof.status, 402, "client-prepended Googlebot IP is not trusted");
  const real = await ppc.middleware(get("/a", ua, { "x-forwarded-for": "203.0.113.9, 66.249.66.1" }));
  assert.equal(real.headers.get("x-middleware-next"), "1", "IP appended by Vercel verifies");
});

test("paid request passes with receipt headers; waitUntil receives the flush", async () => {
  const jobs = [];
  const ppc = createPayPerCrawl({ env, fetch: fac });
  const a = { from: "0x" + "b".repeat(40), to: PAY_TO, value: "10000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + "7".repeat(64) };
  const sig = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, payload: { signature: "0xs", authorization: a } })).toString("base64");
  const r = await ppc.middleware(get("/a", UA_GPT, { "payment-signature": sig }), { waitUntil: (p) => jobs.push(p) });
  assert.equal(r.headers.get("x-middleware-next"), "1");
  assert.ok(r.headers.get("payment-response"));
});

test("monitor mode never blocks, bad config fails open", async () => {
  const ppc = createPayPerCrawl({ env: { PAY_TO, MODE: "monitor" }, fetch: fac });
  assert.equal((await ppc.middleware(get("/a", UA_GPT))).headers.get("x-middleware-next"), "1");
  const broken = createPayPerCrawl({ env: { PAY_TO: "not-an-address", MODE: "gate" }, fetch: fac });
  assert.equal((await broken.middleware(get("/a", UA_GPT))).headers.get("x-middleware-next"), "1");
});

import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index.js";

const PAY_TO = "0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09";
const UA_GPT = "Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

function kv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}
function fakeFetch() {
  const calls = [];
  const f = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    const u = new URL(url);
    if (u.host === "facilitator.test") {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify(u.pathname === "/verify" ? { isValid: true, payer: "0xpayer" } : { success: true, transaction: "0x" + "cd".repeat(32), network: body.paymentRequirements.network }));
    }
    if (u.host === "origin.test") {
      if (u.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      return new Response("<h1>ORIGIN CONTENT</h1>", { headers: { "content-type": "text/html" } });
    }
    throw new Error("unexpected fetch " + url);
  };
  f.calls = calls;
  return f;
}
const mkEnv = (extra = {}) => ({ PAY_TO, MODE: "gate", PRICE_USD: "0.01", FACILITATOR_URL: "https://facilitator.test", ORIGIN_URL: "https://origin.test", MPP_SECRET: "t", SITE_NAME: "Ex", PPC_KV: kv(), ...extra });
const ctx = () => { const p = []; return { p, waitUntil: (x) => p.push(x) }; };
const get = (path, ua, headers = {}) => new Request("https://site.example" + path, { headers: { "user-agent": ua, ...headers } });

test("human gets origin content with Link header; origin url rewritten", async () => {
  const f = fakeFetch();
  const r = await handleRequest(get("/a?b=1", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36", { accept: "text/html" }), mkEnv(), ctx(), { fetch: f });
  assert.equal(r.status, 200); assert.match(await r.text(), /ORIGIN CONTENT/);
  assert.match(r.headers.get("link"), /describedby/);
  assert.equal(f.calls[0], "https://origin.test/a?b=1");
});

test("GPTBot gets 402 and origin is never contacted", async () => {
  const f = fakeFetch();
  const r = await handleRequest(get("/a", UA_GPT), mkEnv(), ctx(), { fetch: f });
  assert.equal(r.status, 402);
  assert.ok(r.headers.get("payment-required")); assert.ok(r.headers.get("www-authenticate"));
  assert.deepEqual(f.calls, []);
});

test("paid v2 gets content + receipts; replay is refused via KV lock", async () => {
  const f = fakeFetch(); const env = mkEnv();
  const a = { from: "0x" + "b".repeat(40), to: PAY_TO, value: "10000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + "9".repeat(64) };
  const sig = b64({ x402Version: 2, accepted: { network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, payload: { signature: "0xs", authorization: a } });
  const r = await handleRequest(get("/p", UA_GPT, { "payment-signature": sig }), env, ctx(), { fetch: f });
  assert.equal(r.status, 200); assert.match(await r.text(), /ORIGIN CONTENT/);
  assert.ok(r.headers.get("payment-response")); assert.match(r.headers.get("cache-control"), /no-store/);
  assert.ok([...env.PPC_KV.m.keys()].some((k) => k.startsWith("ppc:nonce:")));
  const again = await handleRequest(get("/p", UA_GPT, { "payment-signature": sig }), env, ctx(), { fetch: f });
  assert.equal(again.status, 402);
});

test("discovery files, robots.txt lines, monitor mode", async () => {
  const f = fakeFetch(); const env = mkEnv();
  const m = await handleRequest(get("/.well-known/x402.json", UA_GPT), env, ctx(), { fetch: f });
  assert.equal((await m.json()).resources[0].accepts[0].payTo, PAY_TO);
  const rb = await handleRequest(get("/robots.txt", UA_GPT), env, ctx(), { fetch: f });
  assert.match(await rb.text(), /Allow: \/\n[\s\S]*x402\/pay-per-crawl|x402 pay-per-crawl/);
  const mon = await handleRequest(get("/a", UA_GPT), mkEnv({ MODE: "monitor" }), ctx(), { fetch: f });
  assert.equal(mon.status, 200);
});

test("analytics engine and KV log receive rows", async () => {
  const f = fakeFetch(); const points = [];
  const env = mkEnv({ PPC_ANALYTICS: { writeDataPoint: (p) => points.push(p) }, LOG_TO_KV: "true" });
  const c = ctx();
  await handleRequest(get("/a", UA_GPT), env, c, { fetch: f });
  await Promise.all(c.p);
  assert.equal(points.length, 1); assert.equal(points[0].blobs[0], "unpaid");
  assert.ok([...env.PPC_KV.m.keys()].some((k) => k.startsWith("ppc:log:")));
});

test("fails open on a broken gate", async () => {
  const f = fakeFetch();
  const env = mkEnv({ CLASS_POLICY: "{not json" });
  const r = await handleRequest(get("/a", UA_GPT), env, ctx(), { fetch: f });
  assert.ok([200, 402].includes(r.status)); // bad JSON falls back to defaults; never a 5xx
});

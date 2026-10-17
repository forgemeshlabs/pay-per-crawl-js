import test from "node:test";
import assert from "node:assert/strict";
import { createGate, createProReporter, memoryStore, resolveSettings, parseConfig } from "../src/index.js";
import { PAY_TO, UA_GPT, UA_HUMAN, authz, v1Header, v2Header, mppHeader, mockFacilitator, req } from "./helpers.js";

const mk = (o = {}) => {
  const fac = mockFacilitator(o.fac);
  const events = [];
  const gate = createGate({ payTo: PAY_TO, mode: "gate", priceUsd: 0.01, siteName: "Example", mppSecret: "s", fetch: fac, onEvent: (e) => events.push(e), logger: { warn() {} }, ...o.opts });
  return { gate, fac, events };
};
const U = "https://example.test/post/";
const dec = (h) => JSON.parse(Buffer.from(h, "base64").toString());

test("human passes, GPTBot gets all three challenge forms", async () => {
  const { gate } = mk();
  const h = await gate.handle(req(U, UA_HUMAN, { accept: "text/html" }));
  assert.equal(h.type, "pass");
  const r = await gate.handle(req(U, UA_GPT));
  assert.equal(r.type, "respond"); assert.equal(r.response.status, 402);
  const env = dec(r.response.headers.get("payment-required"));
  assert.deepEqual([env.x402Version, env.accepts[0].network, env.accepts[0].amount, env.accepts[0].payTo, env.resource.url], [2, "eip155:8453", "10000", PAY_TO, U]);
  const body = await r.response.json();
  assert.deepEqual([body.x402Version, body.accepts[0].network, body.accepts[0].resource], [1, "base", U]);
  assert.match(r.response.headers.get("www-authenticate"), /^Payment id=".*realm="example.test".*method="evm".*intent="charge".*request="/);
  assert.match(r.response.headers.get("link"), /x402\.json.*describedby/);
  assert.match(r.response.headers.get("cache-control"), /no-store/);
});

test("HEAD gets 402 without a body", async () => {
  const { gate } = mk();
  const r = await gate.handle(req(U, UA_GPT, {}, "HEAD"));
  assert.equal(r.response.status, 402); assert.equal(await r.response.text(), "");
});

test("free classes, fake Googlebot, overrides, block", async () => {
  const { gate } = mk({ opts: { botOverrides: { Slackbot: "paid", curl: "block" } } });
  assert.equal((await gate.handle(req(U, "facebookexternalhit/1.1"))).type, "pass");
  assert.equal((await gate.handle(req(U, "Slackbot-LinkExpanding 1.0"))).response.status, 402);
  assert.equal((await gate.handle(req(U, "curl/8.5"))).response.status, 403);
  const res = { reverse: async () => [], forward: async () => [] };
  const g2 = mk({ opts: { resolver: res } }).gate;
  const r = await g2.handle(req(U, "Mozilla/5.0 (compatible; Googlebot/2.1)", { "x-forwarded-for": "203.0.113.9" }), { ip: "203.0.113.9" });
  assert.equal(r.response.status, 402, "impostor Googlebot is charged");
});

test("discovery files and exempt paths", async () => {
  const { gate } = mk();
  const man = await gate.discovery(req("https://example.test/.well-known/x402.json", UA_GPT)).json();
  assert.deepEqual([man.x402Version, man.resources[0].accepts[0].payTo, man.resources[0].metadata.paid], [2, PAY_TO, true]);
  assert.match(await gate.discovery(req("https://example.test/llms.txt", UA_GPT)).text(), /answer HTTP 402/);
  assert.match(await gate.discovery(req("https://example.test/agents.txt", UA_GPT)).text(), /Payments: required/);
  assert.equal(gate.discovery(req(U, UA_GPT)), null);
  for (const p of ["/robots.txt", "/sitemap.xml", "/favicon.ico", "/app.css", "/img/a.png"]) assert.equal((await gate.handle(req("https://example.test" + p, UA_GPT))).type, "pass", p);
  const g2 = mk({ opts: { allowPaths: ["/free/"] } }).gate;
  assert.equal((await g2.handle(req("https://example.test/free/x", UA_GPT))).type, "pass");
  assert.equal((await mk({ opts: { gateAssets: true } }).gate.handle(req("https://example.test/a.png", UA_GPT))).response.status, 402);
  assert.equal((await gate.handle(req(U, UA_GPT, {}, "POST"))).type, "pass", "non GET/HEAD not gated");
});

test("paid v2, replay, v1 forwarded as v1, underpayment, MPP, receipts", async () => {
  const { gate, fac, events } = mk();
  const a = authz();
  let r = await gate.handle(req(U, UA_GPT, { "payment-signature": v2Header(a) }));
  assert.equal(r.type, "pass");
  assert.equal(dec(r.headers.get("payment-response")).transaction, "0x" + "ab".repeat(32));
  assert.ok(r.headers.get("x-payment-response")); assert.match(r.headers.get("cache-control"), /no-store/);
  assert.equal(events.at(-1).status, "paid"); assert.equal(events.at(-1).amount_units, 10000);
  r = await gate.handle(req(U, UA_GPT, { "payment-signature": v2Header(a) }));
  assert.equal(r.response.status, 402);
  assert.equal((await r.response.json()).invalidReason, "payment_in_flight");

  r = await gate.handle(req(U, "x402-fetch/1.2.0", { "x-payment": v1Header() }));
  assert.equal(r.type, "pass");
  assert.equal(fac.calls.at(-1).body.x402Version, 1);

  r = await gate.handle(req(U, "x402-fetch/1.2.0", { "x-payment": v1Header(authz("5000")) }));
  assert.equal(r.response.status, 402); assert.equal((await r.response.json()).invalidReason, "wrong_amount");

  const ch = await gate.handle(req(U, UA_GPT));
  const mpp = mppHeader(ch.response.headers.get("www-authenticate"));
  r = await gate.handle(req(U, "mpp-client/1", { authorization: mpp }));
  assert.equal(r.type, "pass"); assert.ok(r.headers.get("payment-receipt"));
  r = await gate.handle(req(U, "mpp-client/1", { authorization: mpp }));
  assert.equal(r.response.status, 402);
  assert.equal(r.response.headers.get("content-type"), "application/problem+json; charset=utf-8");
});

test("facilitator down releases the lock; verify failure keeps it", async () => {
  const a = authz();
  const down = mk({ fac: "down" });
  let r = await down.gate.handle(req(U, UA_GPT, { "payment-signature": v2Header(a) }));
  assert.equal((await r.response.json()).invalidReason, "facilitator_unreachable");
  assert.equal(await down.gate.store.get("ppc:nonce:" + (await import("../src/util.js")).sha256Hex(a.nonce)), null);
  const rej = mk({ fac: "reject" });
  r = await rej.gate.handle(req(U, UA_GPT, { "payment-signature": v2Header() }));
  assert.equal((await r.response.json()).invalidReason, "insufficient_funds");
  const notx = mk({ fac: "notx" });
  r = await notx.gate.handle(req(U, UA_GPT, { "payment-signature": v2Header() }));
  assert.equal(r.type, "respond", "no tx hash, no content");
});

test("monitor mode logs would-have-earned and serves", async () => {
  const { gate, events } = mk({ opts: { mode: "monitor" } });
  const r = await gate.handle(req(U, UA_GPT));
  assert.equal(r.type, "pass");
  assert.deepEqual([events.at(-1).status, events.at(-1).amount_units], ["monitor", 10000]);
  assert.equal(gate.settings.paid, false);
});

test("trusted multi-value header uses the right-most entry (X-Forwarded-For spoof)", async () => {
  const resolver = {
    reverse: async (ip) => (ip === "66.249.66.1" ? ["crawl-66-249-66-1.googlebot.com"] : []),
    forward: async (h) => (h.endsWith("googlebot.com") ? ["66.249.66.1"] : []),
  };
  const { gate, events } = mk({ opts: { trustHeader: "x-forwarded-for", resolver } });
  const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const spoof = await gate.handle(req(U, ua, { "x-forwarded-for": "66.249.66.1, 203.0.113.9" }));
  assert.equal(spoof.type, "respond", "spoofed left-most Googlebot IP does not get the free lane");
  assert.equal(spoof.response.status, 402);
  assert.deepEqual([events.at(-1).ua_class, events.at(-1).verified], ["automation", false]);
  const real = await gate.handle(req(U, ua, { "x-forwarded-for": "203.0.113.9, 66.249.66.1" }));
  assert.equal(real.type, "pass", "genuine Googlebot IP appended by our proxy is verified");
  assert.deepEqual([events.at(-1).ua_class, events.at(-1).verified], ["search", true]);
});

test("config safety: floor, missing wallet, trust header", async () => {
  const s = resolveSettings({ mode: "gate", payTo: "nope", priceUsd: 0.001, mppSecret: "x" });
  assert.deepEqual([s.mode, s.priceUsd, s.warnings.length], ["monitor", 0.005, 2]);
  const { gate, events } = mk({ opts: { trustHeader: "cf-connecting-ip" } });
  await gate.handle(req(U, UA_GPT, { "cf-connecting-ip": "198.51.100.4, 10.0.0.1" }));
  const a = events.at(-1).ip_hash;
  await gate.handle(req(U, UA_GPT, { "cf-connecting-ip": "198.51.100.5" }));
  assert.notEqual(events.at(-1).ip_hash, a); assert.equal(a.length, 16);
  const o = parseConfig({ PAY_TO: PAY_TO, PRICE_USD: "0.02", MODE: "gate", CLASS_POLICY: '{"ai":"block"}', ALLOW_PATHS: "/a/, /b/" });
  assert.deepEqual([o.priceUsd, o.classPolicy.ai, o.allowPaths], [0.02, "block", ["/a/", "/b/"]]);
});

test("pro reporter batches rollups + settlements and posts them", async () => {
  const posts = [];
  const f = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === "POST") posts.push({ path, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    if (path === "/api/wp/license/verify") return new Response(JSON.stringify({ ok: true, status: "active" }));
    if (path === "/api/wp/ingest") return new Response(JSON.stringify({ ok: true }));
    if (path === "/api/wp/intel") return new Response(JSON.stringify({ ok: true, version: "v1", agents: [{ name: "NewBot", class: "ai", match: ["newbot/"] }, { name: "bad", class: "nope", match: ["x"] }] }));
    return new Response("{}", { status: 404 });
  };
  const key = "fmppc_" + "a".repeat(30);
  const store = memoryStore();
  const pro = createProReporter({ key, store, fetch: f, site: { host: "example.test", url: "https://example.test/", name: "Example", mode: "gate", price_usd: 0.01, pay_to: PAY_TO } });
  const { gate } = mk({ opts: { onEvent: (e) => pro.record(e) } });
  const ip = { ip: "198.51.100.4" };
  await gate.handle(req(U, UA_GPT), ip);
  await gate.handle(req(U, UA_GPT, { "payment-signature": v2Header() }), ip);
  await gate.handle(req(U, UA_HUMAN, { accept: "text/html" }));
  await new Promise((r) => setTimeout(r, 20));
  const out = await pro.flush({ force: true });
  assert.equal(out.ok, true);
  const ing = posts.find((p) => p.path === "/api/wp/ingest");
  assert.equal(ing.auth, "Bearer " + key);
  assert.equal(ing.body.site.host, "example.test");
  const today = ing.body.daily.find((d) => d.day === new Date().toISOString().slice(0, 10));
  const row = today.rows.find((r) => r.bot_name === "GPTBot");
  assert.deepEqual([row.hits, row.paid, row.unpaid, row.revenue_units, row.sources], [2, 1, 1, 10000, 1]);
  assert.equal(today.rows.some((r) => r.ua_class === "human"), false);
  assert.equal(ing.body.settlements.length, 1);
  assert.deepEqual(Object.keys(ing.body.settlements[0]).sort(), ["amount_units", "bot_name", "path", "payer", "rail", "ts", "tx_hash", "ua_class"]);
  assert.equal(await store.get("ppc:settlements"), "[]", "sent settlements cleared");
  assert.equal((await pro.catalog()).some((e) => e.name === "NewBot"), true, "intel pulled into catalog");
  assert.equal((await pro.flush()).skipped, "throttled");
  assert.equal(createProReporter({ key: "nope", site: {} }).enabled, false);
});

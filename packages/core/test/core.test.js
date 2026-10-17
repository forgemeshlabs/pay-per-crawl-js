import test from "node:test";
import assert from "node:assert/strict";
import { keccakHex, classify, X402, usdToUnits, dohResolver, memoryStore, expandIpv6, arpaName, mergeCatalog, SHIPPED_CATALOG } from "../src/index.js";
import { PAY_TO, authz, v1Header, v2Header, mppHeader, mockFacilitator } from "./helpers.js";

const cfg = { payTo: PAY_TO, priceUsd: 0.01, mppSecret: "unit-secret", realm: "example.test", siteName: "Example", manifestUrl: "https://example.test/.well-known/x402.json" };

test("keccak256 vectors (same as the PHP tests)", () => {
  assert.equal(keccakHex(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccakHex("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(keccakHex("a".repeat(135)), "0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446");
  assert.equal(keccakHex("xyz".repeat(100)), "0xcc0b928a8fb33dca301e35d6070e6cccfda8a90b0ce76912018dd71168c42ad2");
});

test("catalog has the 85 shipped agents", () => assert.equal(SHIPPED_CATALOG.length, 85));

test("classifier", async () => {
  const c = (ua, h, ip, o) => classify(ua, h, ip, o);
  assert.equal((await c("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", { accept: "text/html,application/xhtml+xml" })).class, "human");
  let r = await c("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)");
  assert.deepEqual([r.class, r.name], ["ai", "GPTBot"]);
  r = await c("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)");
  assert.deepEqual([r.class, r.name], ["ai", "ClaudeBot"]);
  r = await c("curl/8.5.0"); assert.deepEqual([r.class, r.name], ["automation", "curl"]);
  assert.equal((await c("")).class, "automation");
  assert.equal((await c("facebookexternalhit/1.1")).class, "social");
  assert.equal((await c("Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)")).class, "seo");
  r = await c("SomethingNewCrawler/2.0 (+https://example.com/bot)"); assert.deepEqual([r.class, r.name], ["bot", "SomethingNewCrawler"]);
  r = await c("Mozilla/5.0 (compatible; Googlebot/2.1)", {}, ""); assert.equal(r.class, "search"); assert.equal(r.verified, null);
  assert.equal((await c("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", { accept: "application/json" })).class, "automation");
});

test("rDNS verification with an injected resolver", async () => {
  const ua = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const good = { reverse: async () => ["crawl-66-249-66-1.googlebot.com."], forward: async () => ["66.249.66.1"] };
  let r = await classify(ua, {}, "66.249.66.1", { resolver: good });
  assert.equal(r.class, "search"); assert.equal(r.verified, true);
  const fake = { reverse: async () => [], forward: async () => [] };
  r = await classify(ua, {}, "203.0.113.9", { resolver: fake });
  assert.equal(r.class, "automation"); assert.equal(r.impersonation, true);
  const spoof = { reverse: async () => ["evil.googlebot.com"], forward: async () => ["198.51.100.7"] };
  r = await classify(ua, {}, "203.0.113.10", { resolver: spoof });
  assert.equal(r.impersonation, true, "forward-confirm mismatch is demoted");
  const broken = { reverse: async () => { throw new Error("dns down"); }, forward: async () => [] };
  r = await classify(ua, {}, "203.0.113.11", { resolver: broken });
  assert.equal(r.class, "search"); assert.equal(r.verified, null, "DNS outage: claim kept, unverified");
  const v6 = { reverse: async () => ["crawl.googlebot.com"], forward: async () => ["2001:4860:4801:10::1"] };
  r = await classify(ua, {}, "2001:4860:4801:0010:0000:0000:0000:0001", { resolver: v6 });
  assert.equal(r.verified, true, "ipv6 compared in normalised form");
});

test("rDNS result is cached in the store", async () => {
  let n = 0;
  const res = { reverse: async () => { n++; return ["a.googlebot.com"]; }, forward: async () => ["203.0.113.50"] };
  const store = memoryStore();
  const ua = "Googlebot/2.1";
  await classify(ua, {}, "203.0.113.50", { resolver: res, store });
  await classify(ua, {}, "203.0.113.50", { resolver: res, store });
  assert.equal(n, 1);
});

test("DoH resolver parses PTR and A/AAAA answers", async () => {
  const seen = [];
  const f = async (url) => {
    seen.push(url);
    const u = new URL(url); const t = u.searchParams.get("type");
    const ans = t === "PTR" ? [{ type: 12, data: "crawl-1.googlebot.com." }] : t === "A" ? [{ type: 5, data: "x." }, { type: 1, data: "66.249.66.1" }] : [];
    return new Response(JSON.stringify({ Status: 0, Answer: ans }), { status: 200 });
  };
  const d = dohResolver({ fetch: f });
  assert.deepEqual(await d.reverse("66.249.66.1"), ["crawl-1.googlebot.com"]);
  assert.match(seen[0], /name=1\.66\.249\.66\.in-addr\.arpa&type=PTR/);
  assert.deepEqual(await d.forward("crawl-1.googlebot.com"), ["66.249.66.1"]);
  assert.equal(arpaName("2001:db8::1").endsWith(".ip6.arpa"), true);
  assert.equal(expandIpv6("::1"), "0000:0000:0000:0000:0000:0000:0000:0001");
});

test("envelopes", () => {
  const x = new X402(cfg);
  const env = x.envelopeV2("https://example.test/post/", "Example: page");
  assert.deepEqual([env.x402Version, env.accepts[0].amount, env.accepts[0].network], [2, "10000", "eip155:8453"]);
  const b = x.bodyV1("https://example.test/post/", "Example: page");
  assert.deepEqual([b.x402Version, b.accepts[0].network, b.accepts[0].maxAmountRequired, b.accepts[0].resource], [1, "base", "10000", "https://example.test/post/"]);
  assert.equal(usdToUnits(0.005), "5000"); assert.equal(usdToUnits("0.01"), "10000");
  assert.equal(x.facilitatorUrl(), "https://facilitator.payai.network");
  assert.equal(x.bodyV1("u", "d", "e", "wrong_amount").invalidReason, "wrong_amount");
});

test("MPP challenge + credential round trip", () => {
  const x = new X402(cfg);
  const hdr = x.mppChallenge("Example: page");
  const m = /^Payment id="([^"]+)", realm="example.test", method="evm", intent="charge", expires="([^"]+)", request="([^"]+)"$/.exec(hdr);
  assert.ok(m, "challenge header shape");
  const p = x.extractPayment({ authorization: mppHeader(hdr) }, "https://example.test/post/");
  assert.equal(p.rail, "mpp"); assert.equal(p.error, undefined);
  assert.equal(p.payload.x402Version, 2);
  assert.equal(p.payload.payload.authorization.nonce, keccakHex(m[1] + "example.test"));
  assert.equal(x.precheck(p), null);
  // bad nonce
  const cred = JSON.parse(Buffer.from(mppHeader(hdr).slice(8), "base64url"));
  cred.payload.nonce = "0x" + "1".repeat(64);
  assert.equal(x.extractPayment({ authorization: "Payment " + Buffer.from(JSON.stringify(cred)).toString("base64url") }, "u").error, "verification-failed");
  cred.payload.nonce = keccakHex(m[1] + "example.test"); cred.challenge.id = "tampered";
  assert.equal(x.extractPayment({ authorization: "Payment " + Buffer.from(JSON.stringify(cred)).toString("base64url") }, "u").error, "invalid-challenge");
  // a different secret cannot validate our challenge
  assert.equal(new X402({ ...cfg, mppSecret: "other" }).extractPayment({ authorization: mppHeader(hdr) }, "u").error, "invalid-challenge");
});

test("v2 + v1 extraction and precheck", () => {
  const x = new X402(cfg);
  let p = x.extractPayment({ "payment-signature": v2Header() }, "u");
  assert.equal(p.rail, "x402v2"); assert.equal(x.precheck(p), null);
  p = x.extractPayment({ "x-payment": v1Header() }, "u");
  assert.equal(p.rail, "x402v1"); assert.equal(x.precheck(p), null);
  p = x.extractPayment({ "payment-signature": v2Header(authz("10000", { to: "0x" + "c".repeat(40) })) }, "u");
  assert.equal(x.precheck(p), "wrong_pay_to");
  p = x.extractPayment({ "payment-signature": v2Header(authz("9999")) }, "u");
  assert.equal(x.precheck(p), "wrong_amount");
  p = x.extractPayment({ "payment-signature": v2Header(authz("10000", { validBefore: "1" })) }, "u");
  assert.equal(x.precheck(p), "authorization_expired");
  p = x.extractPayment({ "x-payment": v1Header(authz("20000")) }, "u");
  assert.equal(x.precheck(p), null, "v1 overpayment accepted");
  p = x.extractPayment({ "payment-signature": v2Header(authz("20000")) }, "u");
  assert.equal(x.precheck(p), "wrong_amount", "v2 must be exact");
  assert.equal(x.extractPayment({ "payment-signature": "zzz" }, "u").error, "malformed_payment_signature");
  assert.equal(x.extractPayment({}, "u"), null);
});

test("facilitator flow: verify then settle, tx required, v1 stays v1", async () => {
  const f = mockFacilitator();
  const x = new X402({ ...cfg, fetch: f });
  let p = x.extractPayment({ "payment-signature": v2Header() }, "https://example.test/x");
  let r = await x.verifyAndSettle(p, "https://example.test/x");
  assert.equal(r.ok, true); assert.equal(r.tx, "0x" + "ab".repeat(32));
  assert.equal(f.calls.length, 2);
  assert.deepEqual([f.calls[0].body.x402Version, f.calls[0].body.paymentRequirements.network, f.calls[1].path], [2, "eip155:8453", "/settle"]);
  f.calls.length = 0;
  p = x.extractPayment({ "x-payment": v1Header() }, "https://example.test/x");
  r = await x.verifyAndSettle(p, "https://example.test/x");
  assert.deepEqual([r.ok, f.calls[0].body.x402Version, f.calls[0].body.paymentRequirements.network, f.calls[0].body.paymentRequirements.maxAmountRequired], [true, 1, "base", "10000"]);
  r = await new X402({ ...cfg, fetch: mockFacilitator("notx") }).verifyAndSettle(p, "u");
  assert.deepEqual([r.ok, r.reason], [false, "settlement_failed"]);
  r = await new X402({ ...cfg, fetch: mockFacilitator("reject") }).verifyAndSettle(p, "u");
  assert.deepEqual([r.ok, r.reason], [false, "insufficient_funds"]);
  r = await new X402({ ...cfg, fetch: mockFacilitator("down") }).verifyAndSettle(p, "u");
  assert.equal(r.reason, "facilitator_unreachable");
});

test("pro intel merge", () => {
  const merged = mergeCatalog(SHIPPED_CATALOG, [
    { name: "GPTBot", class: "ai", match: ["gptbot", "gptbot-next"], verify: [] },
    { name: "Brand New Crawler", class: "seo", match: ["brandnewcrawler/"], verify: [] },
  ]);
  const names = merged.map((e) => e.name);
  assert.ok(names.includes("Brand New Crawler"));
  assert.equal(names.filter((n) => n === "GPTBot").length, 1);
  assert.ok(merged[names.indexOf("GPTBot")].match.includes("gptbot-next"));
  assert.equal(SHIPPED_CATALOG.length, 85, "input not mutated");
});

import test from "node:test";
import assert from "node:assert/strict";
import ppc from "../pay-per-crawl.js";

test("njs keccak256 matches the core vectors", () => {
  assert.equal(ppc.keccak256Hex(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(ppc.keccak256Hex("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(ppc.keccak256Hex("a".repeat(135)), "0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446");
  assert.equal(ppc.keccak256Hex("xyz".repeat(100)), "0xcc0b928a8fb33dca301e35d6070e6cccfda8a90b0ce76912018dd71168c42ad2");
});

test("njs exemption is anchored", () => {
  const f = (p, a) => ppc.isFreePath(p, a || ["/pricing"]);
  assert.ok(f("/robots.txt") && f("/sitemap.xml") && f("/wp-sitemap-posts-post-1.xml") && f("/.well-known/x402.json"));
  assert.ok(f("/pricing") && f("/pricing/plans"));
  for (const p of ["/robots.txt.html", "/sitemapfoo", "/llms.txtx", "/.well-known/../post", "/.well-known/%2e%2e/post", "/.well-known/%2E%2E/post", "/pricing-secret", "//robots.txt"]) assert.ok(!f(p), p);
});

# @forgemesh/pay-per-crawl-core

Framework-neutral engine for x402 / MPP pay-per-crawl. Web-standard `Request`/`Response`; runs on Node 20+, Cloudflare Workers and the Next.js edge runtime. One runtime dependency (`@noble/hashes`, for keccak256 and HMAC).

```
npm install @forgemesh/pay-per-crawl-core
```

```js
import { createGate, dohResolver } from "@forgemesh/pay-per-crawl-core";

const gate = createGate({
  payTo: "0xYourWallet", priceUsd: 0.01, mode: "gate",     // "monitor" logs only
  resolver: dohResolver(),                                  // rDNS for search engines (or nodeResolver())
  trustHeader: "cf-connecting-ip",                          // see "Trusted client IP" in the root README
});

const disc = gate.discovery(request);        // /.well-known/x402.json, /llms.txt, /agents.txt
if (disc) return disc;
const r = await gate.handle(request, { ip });
if (r.type === "respond") return r.response; // 402 / 403
// r.headers: Link + payment receipts, add them to the response you serve
```

## Options

`payTo`, `priceUsd` (min 0.005), `mode` (`monitor` | `gate`), `facilitatorUrl` (default PayAI), `facilitatorAuth`, `classPolicy`, `botOverrides`, `allowPaths`, `gateAssets`, `gateAllMethods`, `discovery`, `siteName`, `siteDescription`, `contact`, `llmsLinks`, `mppSecret`, `trustHeader`, `baseUrl`, `store`, `resolver`, `fetch`, `catalog`, `onEvent`. A bad config (no wallet in gate mode, price under the floor) downgrades safely and logs a warning instead of throwing.

`parseConfig(env)` maps `PAY_TO`, `PRICE_USD`, `MODE`, `FACILITATOR_URL`, `CLASS_POLICY` (JSON), `BOT_OVERRIDES` (JSON), `ALLOW_PATHS`, `TRUST_HEADER`, `MPP_SECRET`, `SITE_NAME`, `BASE_URL`, `GATE_ASSETS`, `DISCOVERY` onto these options. Set `MPP_SECRET` to a long random string.

## Pieces

- `classify(ua, headers, ip, {resolver, store, catalog})` with the 85-agent catalog and rDNS verification. `dohResolver()` (DNS-over-HTTPS, works anywhere) or `nodeResolver()` from `@forgemesh/pay-per-crawl-core/node-dns` (Node only).
- `X402` class: `envelopeV2`, `bodyV1`, `mppChallenge`, `extractPayment`, `precheck`, `verifyAndSettle`, `mppReceipt`.
- `memoryStore()`, `kvStore(kvNamespace)`: replay lock and rDNS cache. KV is eventually consistent, so the lock is best effort; the on-chain EIP-3009 nonce is the hard guard against double spend.
- `createProReporter({key, site, store})`: optional batched reporting to the hosted dashboard. Never required.

## How money flows

Payments go from the crawler to `payTo`. The facilitator only relays the signed authorization. No account, no custody, no revenue share.

MIT.

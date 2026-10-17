# ForgeMesh Pay-per-Crawl for JavaScript

Charge AI crawlers and scrapers per page, in USDC on Base, using the open [x402](https://x402.org) and MPP protocols. Humans and verified search engines stay free. **You keep 100%**: payments go straight to your wallet, there is no account, no custody and no revenue share.

Same behaviour as the ForgeMesh WordPress plugin, for every other stack:

| Package | Use it for |
|---|---|
| [`@forgemesh/pay-per-crawl-worker`](packages/cloudflare-worker) | Cloudflare Worker in front of any origin (5-minute deploy) |
| [`@forgemesh/pay-per-crawl-next`](packages/next) | Next.js middleware (edge runtime) and Next 16 `proxy` |
| [`@forgemesh/pay-per-crawl-node`](packages/node) | Express, Fastify, Hono, Koa |
| [`nginx/`](nginx) | nginx via njs (config snippet, not a package) |
| [`@forgemesh/pay-per-crawl-core`](packages/core) | The framework-neutral engine the others wrap |

## How money flows

1. A crawler requests a page. The gate classifies it (human, search, social, monitor, seo, ai, automation, bot).
2. Free classes pass. Paid classes get `402 Payment Required` with three machine-readable offers: x402 v2 (`PAYMENT-REQUIRED` header), x402 v1 (JSON body) and MPP (`WWW-Authenticate: Payment`).
3. The crawler signs a USDC (EIP-3009) authorization and retries. The gate checks it locally, then asks the facilitator (PayAI by default, no API key) to verify and settle. The page is served **only** when settlement returns a transaction hash.
4. USDC lands in your `PAY_TO` wallet. Nothing passes through ForgeMesh.

Start in `monitor` mode: nothing is charged, every bot is logged with what it would have paid. Switch to `gate` when you like the numbers.

## Defaults

Free: humans, verified search engines (reverse-DNS checked, impostors are charged), social link previews, uptime monitors. Paid: AI crawlers, SEO crawlers, generic automation, unknown bots. Static assets (css, js, images) and non-GET/HEAD methods pass. Minimum price is $0.005. Override per class (`CLASS_POLICY`) or per bot (`BOT_OVERRIDES`): `free`, `paid` or `block`.

## Trusted client IP

Search-engine verification needs the real client IP. Set `TRUST_HEADER` only to a header **your own proxy overwrites or appends**. For multi-value headers such as `X-Forwarded-For` the gate uses the **right-most** entry (the one your proxy added); the left-most is client-controlled and is never trusted. Single-value edge headers (`CF-Connecting-IP`, `X-Real-IP`, `True-Client-IP`) are used as-is. If no trusted header is set, the connection address is used.

## Real settlements

Real mainnet payments through the Next.js example (PayAI facilitator, $0.01 each, to the ForgeMesh wallet `0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09`), verified on Base:

| Rail | Transaction |
|---|---|
| x402 v1 (`X-PAYMENT`, stock `x402-fetch` 1.x) | `0x5eb3ae89264f754793de655ade581cf9e4b885946d415d1d29d8d9e079077e7c` |
| x402 v2 (`PAYMENT-SIGNATURE`, `@x402/core`) | `0x6f6e08909ef5e70e023649501721536e5e619a1008e2446f8a02830fdcc066c1` |

## Pro (optional)

A hosted dashboard, weekly digest and crawler-intel feed are available with a license key (`PRO_KEY`). Never required; the free engine does not call out.

## Develop

```
npm install
npm test            # core, worker, next, node adapters, nginx script
scripts/matrix.sh <base-url> <mock-facilitator-log>   # curl matrix against a running gate
```
`scripts/mock-facilitator.mjs` is a local facilitator for the matrix. Never run `next dev` on a small server; the example uses `next build` and `next start`.

MIT licensed. Report issues at https://github.com/forgemeshlabs/pay-per-crawl-js/issues.

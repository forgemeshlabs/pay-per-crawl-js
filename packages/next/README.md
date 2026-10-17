# @forgemeshlabs/pay-per-crawl-next

Next.js middleware that charges AI crawlers per page with x402 and MPP. Edge-runtime compatible (Web APIs only, DNS-over-HTTPS for search-engine verification). **You keep 100%**: no account, no custody.

```
npm install @forgemeshlabs/pay-per-crawl-next
```

`middleware.js` (Next 14/15):

```js
import { createPayPerCrawl } from "@forgemeshlabs/pay-per-crawl-next";

const ppc = createPayPerCrawl({ siteName: "My Site" }); // PAY_TO, PRICE_USD, MODE ... come from env; options win
export const middleware = ppc.middleware;

// Next needs `config` as a literal in this file; it cannot be re-exported.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

Next 16 renamed middleware to `proxy.js` (Node runtime): `export const proxy = ppc.proxy;`. Both were built and tested (Next 15.5 edge middleware, Next 16.2 proxy).

Environment (all optional if passed as options): `PAY_TO`, `PRICE_USD` (min 0.005), `MODE` (`monitor` default, `gate` to charge), `FACILITATOR_URL`, `CLASS_POLICY`, `BOT_OVERRIDES`, `ALLOW_PATHS`, `TRUST_HEADER`, `MPP_SECRET`, `PRO_KEY`. Start in `monitor`.

The middleware also serves `/.well-known/x402.json`, `/llms.txt` and `/agents.txt`. Prefer route handlers? `export const { GET } = ppc.handlers.x402Json;` in `app/.well-known/x402.json/route.js` (and `llmsTxt`, `agentsTxt`).

## Notes

- `TRUST_HEADER` defaults to `x-forwarded-for` and the **right-most** entry is used (what your platform appended). On Vercel the platform sets it. If your server is exposed directly to the internet, set `trustHeader: ""` so a client cannot forge an IP.
- Replay lock and rDNS cache are per-process memory by default; pass `store` (any `{get, put, delete}`) for a shared one across instances. On serverless this is best effort; the on-chain nonce is the hard guard.
- Static assets, `/_next/*` and non-GET/HEAD requests pass free. Bugs and bad config fail open.
- Example app: `examples/next-app`, built with `next build` and run with `next start`.

## How money flows

Crawler signs a USDC authorization; the middleware has the facilitator (PayAI by default) verify and settle, and serves the page only on a settlement transaction hash. USDC lands in `PAY_TO`.

MIT.

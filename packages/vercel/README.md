# @forgemeshlabs/pay-per-crawl-vercel

Vercel Edge Middleware that charges AI crawlers per page with x402 and MPP. Works in front of **anything Vercel serves**: a static site, Astro, SvelteKit, Vite, Nuxt, Remix, Hugo, Docusaurus. (Next.js projects: use [`@forgemeshlabs/pay-per-crawl-next`](../next), same engine.) Only Web APIs, DNS-over-HTTPS for search-engine verification. **You keep 100%**: no account, no custody.

```
npm install @forgemeshlabs/pay-per-crawl-vercel
```

`middleware.js` at the project root (next to `package.json`):

```js
import { createPayPerCrawl } from "@forgemeshlabs/pay-per-crawl-vercel";
const ppc = createPayPerCrawl({ siteName: "My Site" }); // PAY_TO, PRICE_USD, MODE ... come from env; options win
export default ppc.middleware;
// Vercel needs `config` as a literal in this file; it cannot be re-exported.
export const config = { matcher: ["/((?!_vercel|favicon.ico).*)"] };
```

Then in the Vercel project settings → Environment Variables: `PAY_TO` = your wallet (0x address on Base), `PRICE_USD` = `0.01`, `MODE` = `monitor`. Deploy. Watch the function logs for what bots would have paid, then set `MODE=gate` and redeploy to charge.

Environment (all optional if passed as options): `PAY_TO`, `PRICE_USD` (min 0.005), `MODE` (`monitor` default, `gate` to charge), `FACILITATOR_URL`, `CLASS_POLICY`, `BOT_OVERRIDES`, `ALLOW_PATHS`, `TRUST_HEADER`, `MPP_SECRET`, `PRO_KEY`.

The middleware also serves `/.well-known/x402.json`, `/llms.txt` and `/agents.txt`. Prefer Edge Functions for those? `export default ppc.handlers.x402Json;` in `api/x402.js` with a rewrite, or just let the middleware do it.

## Notes

- A pure static project needs a `package.json` for the dependency; `vercel.json` with `"outputDirectory": "public"` (or your folder) keeps the HTML where it was. See `examples/vercel-static`.
- `TRUST_HEADER` defaults to `x-forwarded-for` and the **right-most** entry is used, which is the one Vercel appended. A client cannot forge a search-engine IP by prepending it.
- Replay lock and rDNS cache are per-isolate memory; pass `store` (any `{get, put, delete}`, e.g. Vercel KV / Upstash) for a shared one. On serverless this is best effort; the on-chain nonce is the hard guard.
- `/_vercel/*`, static assets and non-GET/HEAD requests pass free. Bugs and bad config fail open: the site never goes down because of the gate.
- Edge Middleware runs on every matched request, including bots that never pay. Vercel's Edge Middleware invocations are metered on paid plans; the free Hobby plan has a generous allowance.

## Real settlement

Verified on Vercel (production alias of a static project, Edge Middleware), PayAI facilitator, $0.01 USDC on Base to the ForgeMesh wallet `0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09`, October 2026:

| Rail | Transaction |
|---|---|
| x402 v2 (`PAYMENT-SIGNATURE`, `@x402/core`) | `0xcc37097ef97b74f5ff0361cc98344bffce8fbba48bfdf3354c9094b1eec93766` |

## How money flows

Crawler signs a USDC authorization; the middleware has the facilitator (PayAI by default) verify and settle, and serves the page only on a settlement transaction hash. USDC lands in `PAY_TO`.

MIT.

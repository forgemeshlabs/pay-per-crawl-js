# @forgemesh/pay-per-crawl-node

Express, Fastify, Hono and Koa adapters for x402 / MPP pay-per-crawl. Thin wrappers over `@forgemesh/pay-per-crawl-core`: same options, same discovery routes (`/.well-known/x402.json`, `/llms.txt`, `/agents.txt`). **You keep 100%**: no account, no custody.

```
npm install @forgemesh/pay-per-crawl-node
```

```js
// Express
import { payPerCrawl } from "@forgemesh/pay-per-crawl-node/express";
app.use(payPerCrawl({ payTo: "0xYourWallet", mode: "monitor" })); // before your routes

// Fastify
import { payPerCrawl } from "@forgemesh/pay-per-crawl-node/fastify";
await app.register(payPerCrawl, { payTo: "0x...", mode: "gate" });

// Hono (Node, Bun, Deno, Workers)
import { payPerCrawl } from "@forgemesh/pay-per-crawl-node/hono";
app.use("*", payPerCrawl({ payTo: "0x..." }));

// Koa
import { payPerCrawl } from "@forgemesh/pay-per-crawl-node/koa";
app.use(payPerCrawl({ payTo: "0x..." }));
```

Options are the core options (see the core README); anything not passed is read from env (`PAY_TO`, `PRICE_USD`, `MODE`, `FACILITATOR_URL`, `CLASS_POLICY`, `BOT_OVERRIDES`, `ALLOW_PATHS`, `TRUST_HEADER`, `MPP_SECRET`, `PRO_KEY`). Examples in `examples/node`.

## Notes

- Express, Fastify and Koa verify search engines with Node DNS; Hono uses DNS-over-HTTPS so it also runs on edge runtimes. Pass `resolver` to override.
- `trustHeader` (e.g. `x-forwarded-for`) must be a header your own proxy overwrites or appends. The **right-most** entry is used; the client-controlled left-most is never trusted. Without it the socket address is used.
- Replay lock is in memory per process; pass `store` for a shared one across instances.
- Bugs and bad config fail open.

## How money flows

Crawler signs a USDC authorization; the adapter has the facilitator verify and settle, and serves the page only on a settlement transaction hash. USDC lands in `payTo`.

MIT.

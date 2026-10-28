# @forgemeshlabs/pay-per-crawl-worker

A Cloudflare Worker that sits in front of any origin and answers crawlers with an HTTP 402 price (x402 and MPP) and charges the ones that can pay. Today that means x402-capable agents; the big AI labs' crawlers do not pay per page yet. Humans and verified search engines pass free. **You keep 100%**: USDC goes straight to your wallet; no account, no custody.

## Before you start: turn Cloudflare's own bot blocking OFF

Cloudflare's **"Block AI bots"**, **AI Crawl Control** (and "Pay per crawl") for the zone must be **off**. If they are on, crawlers are blocked or challenged at the edge before they reach this Worker and can never pay. Also check Security > Bots and any WAF rule that challenges unknown user agents.

## Deploy in 5 minutes

You need a Cloudflare account, Node 20+, and a Base USDC wallet address.

```bash
git clone https://github.com/forgemeshlabs/pay-per-crawl-js && cd pay-per-crawl-js
npm install
cd packages/cloudflare-worker
```

1. Edit `wrangler.toml`: set `PAY_TO` and choose how to attach the Worker (a `routes` entry for a zone on Cloudflare, a custom domain, or `ORIGIN_URL` on workers.dev).
2. `npx wrangler secret put MPP_SECRET` (any long random string).
3. `npx wrangler deploy`.
4. Leave `MODE = "monitor"` for a few days: bots are logged with what they would have paid, nothing is charged. Then set `MODE = "gate"` and redeploy.

Or from your own project: `npm i @forgemeshlabs/pay-per-crawl-worker`, then `src/worker.js` is just `export { default } from "@forgemeshlabs/pay-per-crawl-worker";`, with the same `wrangler.toml`.

Check it:

```bash
curl -i -A "GPTBot" https://your-site.example/          # 402 with PAYMENT-REQUIRED, WWW-Authenticate, JSON body
curl -i https://your-site.example/.well-known/x402.json  # manifest
```

## Configuration (env vars)

| Var | Meaning |
|---|---|
| `PAY_TO` | Your wallet (0x...). Required for `gate`. |
| `PRICE_USD` | Per page, default `0.01`, minimum `0.005`. |
| `MODE` | `monitor` (default) or `gate`. |
| `FACILITATOR_URL` | Default PayAI, no API key. |
| `CLASS_POLICY` | JSON, e.g. `{"seo":"free"}`. Classes: search, social, monitor, seo, ai, automation, bot. Values: free, paid, block. |
| `BOT_OVERRIDES` | JSON per bot name, wins over class: `{"GPTBot":"paid","Bytespider":"block"}`. |
| `ALLOW_PATHS` | Comma list of always-free path prefixes. |
| `TRUST_HEADER` | Client IP header, default `cf-connecting-ip`. |
| `MPP_SECRET` | Secret (use `wrangler secret`). |
| `ORIGIN_URL` | Rewrite to this origin (workers.dev setups). Otherwise the Worker passes `fetch(request)` to the zone origin. |
| `PRO_KEY` | Optional hosted-dashboard license key (secret). |

Bindings, all optional: `PPC_KV` (KV namespace: payment replay lock shared across isolates, Pro batching, `LOG_TO_KV=true` for per-request rows), `PPC_ANALYTICS` (Workers Analytics Engine: one data point per bot request). Without KV the Worker falls back to per-isolate memory, which is fine for monitor mode and low traffic; bind KV for production gating.

Static assets (css, js, images) and non-GET/HEAD requests pass free. The Worker also serves `/.well-known/x402.json`, `/llms.txt`, `/agents.txt` and appends discovery comments to your `robots.txt`. A bug or bad config fails open (the request goes to your origin).

## How money flows

Crawler signs a USDC authorization, the Worker has the facilitator verify and settle it, and serves the page only if settlement returns a transaction hash. USDC arrives in `PAY_TO`. ForgeMesh is not in the path.

## Tests

`npm test` runs the handler against a fake env, KV and fetch. The curl matrix (`scripts/matrix.sh`) was also run against `wrangler dev` (workerd) with a mock facilitator.

MIT.

# Changelog

## 0.1.1

Security fix: exempt-path matching is anchored. `/robots.txt.x`, `/sitemapfoo`, `/.well-known/../post` and an allow path `/pricing` matching `/pricing-secret` used to let crawlers read gated pages free. Exact files, root-level sitemap `.xml`, the `/.well-known/` directory and allow paths (segment boundary) are exempt; paths with dot segments or `%2e` / `%2f` are gated. Applies to core, worker, next, node and the nginx njs script.

## 0.1.0

First release. JavaScript editions of ForgeMesh Pay-per-Crawl, at behaviour parity with the WordPress plugin.

- `@forgemesh/pay-per-crawl-core`: 85-agent crawler classifier with reverse-DNS verification (injected resolver, DNS-over-HTTPS included), x402 v2 `PAYMENT-REQUIRED` header, x402 v1 JSON body with `invalidReason`, MPP `WWW-Authenticate: Payment` challenge and credential validation (keccak256 nonce binding), PayAI facilitator verify then settle gated on a non-empty transaction hash, v1 payments forwarded in v1 shape, nonce replay lock, receipts (`PAYMENT-RESPONSE`, `X-PAYMENT-RESPONSE`, `Payment-Receipt`), discovery files, optional Pro reporter.
- `@forgemesh/pay-per-crawl-worker`: Cloudflare Worker, env-var configuration, KV replay lock, optional Analytics Engine, `ORIGIN_URL` for workers.dev setups.
- `@forgemesh/pay-per-crawl-next`: Next.js middleware (edge) and Next 16 `proxy`, discovery route handlers.
- `@forgemesh/pay-per-crawl-node`: Express, Fastify, Hono and Koa adapters.
- `nginx/`: njs script and sample `nginx.conf` (config snippet, not a package).
- A trusted multi-value client-IP header (`X-Forwarded-For`) uses the right-most entry, never the client-controlled left-most.

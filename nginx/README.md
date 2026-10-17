# nginx edition (njs)

A config snippet, not an npm package: `pay-per-crawl.js` (an njs script for `ngx_http_js_module`) plus `nginx.conf.example`. It issues the 402 challenge (x402 v2 header, x402 v1 body, MPP `WWW-Authenticate`), accepts x402 v1/v2 and MPP payments, has the facilitator verify and settle, and proxies to your origin only when settlement returns a transaction hash. **You keep 100%**: USDC goes straight to `ppc_pay_to`; no account, no custody.

## Install

1. nginx with the njs module (njs 0.8.0 or newer): `apt install nginx-module-njs` from the nginx.org repository, or a distribution package that includes `ngx_http_js_module`.
2. Copy `pay-per-crawl.js` to `/etc/nginx/njs/`.
3. Merge `nginx.conf.example` into your config: set `ppc_pay_to`, `ppc_mpp_secret`, the upstream, and keep `ppc_mode "monitor"` until you like the numbers, then `gate`.
4. `nginx -t && nginx -s reload`.

Check: `curl -i -A GPTBot https://your-site/` returns 402 with `PAYMENT-REQUIRED`, `WWW-Authenticate: Payment ...` and the v1 JSON body.

## Behaviour

Same policy as the other editions: humans, verified search engines, social previews and monitors free; AI, SEO, automation and unknown bots paid; per-class (`ppc_class_policy`) and per-bot (`ppc_bot_overrides`) overrides; static assets and non-GET/HEAD pass; discovery files served at `/.well-known/x402.json`, `/llms.txt`, `/agents.txt`; replay lock in a shared dict; fail-open on script errors. Search-engine claims are verified by reverse DNS through DNS-over-HTTPS (`ppc_doh_url`), cached 24 h in a shared dict. The log variables `$ppc_status`, `$ppc_class`, `$ppc_bot`, `$ppc_tx`, `$ppc_reason` are available to `log_format`.

`ppc_trust_header` (e.g. `x-forwarded-for`) must be a header your proxy overwrites or appends; the **right-most** entry is used, never the client-controlled left-most.

Not included: the Pro reporter (use the Worker, Next or Node editions for that).

## Tested

Built nginx 1.26.2 with njs 0.8.9 and ran the repo's curl matrix (`scripts/matrix.sh`, 37 checks: human 200, bot 402 with all three challenge forms, HEAD, discovery files, paid v1/v2/MPP through the mock facilitator with receipts, replay 402, underpayment 402) plus the Googlebot impostor checks, all passing. That test build had no OpenSSL, so HTTPS fetches (the live PayAI facilitator and cloudflare-dns.com) were not exercised on nginx; they use the same `ngx.fetch` call over `http://` in the test. Needs `resolver` and `js_fetch_trusted_certificate` as in the sample config.

`node --test` in this directory checks the script's keccak256 against the core vectors. `node gen-catalog.mjs` regenerates the crawler catalog block from the core package.

MIT.

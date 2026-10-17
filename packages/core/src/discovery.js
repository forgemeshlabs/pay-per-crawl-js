// Discovery files on the site's own domain so paying agents and x402 indexes find
// the paid copy: /.well-known/x402.json, /llms.txt, /agents.txt, robots.txt lines.
import { NETWORK_V2, USDC, USDC_NAME, USDC_VERSION, TIMEOUT_SECS, usdToUnits } from "./x402.js";
import { priceString } from "./util.js";

export const DISCOVERY_PATHS = ["/.well-known/x402.json", "/llms.txt", "/agents.txt"];

/** @param {object} s resolved gate settings; base = site origin with trailing slash */
export function manifest(s, base, version) {
  const host = new URL(base).host;
  const price = Number(s.priceUsd);
  return {
    x402Version: 2,
    provider: { name: s.siteName, url: base, description: s.siteDescription || "", contact: s.contact || null },
    resources: [
      {
        resource: base + "{path}",
        type: "http",
        metadata: {
          method: "GET",
          name: `${s.siteName}: page fetch`,
          description: `Any page on ${host}, served as HTML to automated clients after an x402 payment of $${priceString(price)} USDC on Base. Humans and verified search engines read free.`,
          priceUsd: price,
          mimeType: "text/html",
          paid: s.paid,
        },
        accepts: [
          {
            scheme: "exact",
            network: NETWORK_V2,
            amount: usdToUnits(price),
            asset: USDC,
            payTo: s.payTo || "",
            maxTimeoutSeconds: TIMEOUT_SECS,
            extra: { name: USDC_NAME, version: USDC_VERSION },
          },
        ],
      },
    ],
    protocols: ["x402", "mpp"],
    generator: `forgemesh-pay-per-crawl-js/${version}`,
    sitemap: base + "sitemap.xml",
  };
}

export function llmsTxt(s, base) {
  const l = [`# ${s.siteName}`, ""];
  if (s.siteDescription) l.push(`> ${s.siteDescription}`, "");
  l.push(`Site: ${base}`, `Sitemap: ${base}sitemap.xml`, "", "## Access for automated clients", "");
  if (s.paid) {
    l.push(`Pages on this site answer HTTP 402 to crawlers and agents. Pay $${priceString(s.priceUsd)} USDC on Base per page with x402 (PAYMENT-SIGNATURE or X-PAYMENT header) or MPP (Authorization: Payment) and retry the same URL.`);
  } else {
    l.push("This site is instrumented for x402 pay-per-crawl; charging is not enabled yet. Terms will appear in the manifest below when it is.");
  }
  l.push("Verified search engines and humans are never charged.", "");
  l.push(`Manifest: ${base}.well-known/x402.json`, `Agents: ${base}agents.txt`, "Protocol: https://x402.org");
  if (s.llmsLinks && s.llmsLinks.length) {
    l.push("", "## Pages", "");
    for (const p of s.llmsLinks) l.push(`- [${p.title}](${p.url})`);
  }
  return l.join("\n") + "\n";
}

export function agentsTxt(s, base) {
  const host = new URL(base).host;
  return [
    `# agents.txt — ${host}`,
    "# Standard: https://agents-txt.com",
    "",
    `Name: ${s.siteName}`,
    `Provider: ${s.siteName} (${base})`,
    "Protocols: x402, mpp, http",
    `Payments: ${s.paid ? "required" : "none"}`,
    "",
    `LLMs: ${base}llms.txt`,
    `x402: ${base}.well-known/x402.json`,
    `Sitemap: ${base}sitemap.xml`,
    "",
    "## Payment",
    "Protocol: x402 (HTTP 402 challenge; pay and retry with PAYMENT-SIGNATURE) and MPP (WWW-Authenticate: Payment)",
    `Network: ${NETWORK_V2}`,
    `Asset: ${USDC} (USDC)`,
    `Price: $${priceString(s.priceUsd)} per page`,
    `PayTo: ${s.payTo || ""}`,
    "",
  ].join("\n");
}

/** Lines to append to an existing robots.txt (comments only, safe for any parser). */
export function robotsLines(base) {
  return `\n# x402 pay-per-crawl (forgemesh-pay-per-crawl-js)\n# Manifest: ${base}.well-known/x402.json\n# LLMs: ${base}llms.txt\n# Agents: ${base}agents.txt\n`;
}

/**
 * Response for a discovery path, or null when the path is not one.
 * @param {string} pathname
 */
export function discoveryResponse(pathname, s, base, version) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let type, body;
  if (path === "/.well-known/x402.json") {
    type = "application/json; charset=utf-8";
    body = JSON.stringify(manifest(s, base, version), null, 2);
  } else if (path === "/llms.txt") {
    type = "text/plain; charset=utf-8";
    body = llmsTxt(s, base);
  } else if (path === "/agents.txt") {
    type = "text/plain; charset=utf-8";
    body = agentsTxt(s, base);
  } else {
    return null;
  }
  return new Response(body, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}

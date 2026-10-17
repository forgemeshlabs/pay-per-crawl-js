// Node resolver for rDNS verification (uses dns.promises). Import from
// "@forgemeshlabs/pay-per-crawl-core/node-dns"; do not import it in edge/Workers code.
import dns from "node:dns/promises";

export function nodeResolver() {
  return {
    async reverse(ip) {
      try {
        return await dns.reverse(ip);
      } catch (e) {
        if (e && (e.code === "ENOTFOUND" || e.code === "ENODATA")) return [];
        throw e;
      }
    },
    async forward(host) {
      const out = [];
      for (const fn of [dns.resolve4, dns.resolve6]) {
        try {
          out.push(...(await fn.call(dns, host)));
        } catch (e) {
          if (!e || (e.code !== "ENOTFOUND" && e.code !== "ENODATA")) throw e;
        }
      }
      return out;
    },
  };
}

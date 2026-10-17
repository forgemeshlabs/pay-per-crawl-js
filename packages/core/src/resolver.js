// DNS resolvers for reverse-DNS verification of search engines. A resolver is
// { reverse(ip) -> Promise<string[]>, forward(host) -> Promise<string[]> } (A + AAAA).
// dohResolver works anywhere fetch does (Workers, Next edge, Node); the Node
// dns.promises resolver lives in "@forgemesh/pay-per-crawl-core/node-dns".

export function isIp(ip) {
  return isIpv4(ip) || isIpv6(ip);
}

export function isIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip));
  return !!m && m.slice(1).every((n) => Number(n) <= 255);
}

export function isIpv6(ip) {
  const s = String(ip);
  return s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s) && expandIpv6(s) !== null;
}

/** Full 8-group lowercase form, or null when malformed. Handles :: and a trailing IPv4 part. */
export function expandIpv6(ip) {
  let s = String(ip).toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (!isIpv4(v4[1])) return null;
    const o = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(fill).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

export function normalizeIp(ip) {
  return isIpv4(ip) ? String(ip) : expandIpv6(ip) || String(ip).toLowerCase();
}

export function arpaName(ip) {
  if (isIpv4(ip)) return ip.split(".").reverse().join(".") + ".in-addr.arpa";
  const full = expandIpv6(ip);
  return full.replace(/:/g, "").split("").reverse().join(".") + ".ip6.arpa";
}

const DNS_TYPE = { A: 1, PTR: 12, AAAA: 28 };

/**
 * DNS-over-HTTPS resolver using the JSON API (cloudflare-dns.com by default).
 * @param {{fetch?: typeof fetch, endpoint?: string, timeoutMs?: number}} [opts]
 */
export function dohResolver(opts = {}) {
  const endpoint = opts.endpoint || "https://cloudflare-dns.com/dns-query";
  const timeoutMs = opts.timeoutMs ?? 2500;
  async function query(name, type) {
    const f = opts.fetch || globalThis.fetch;
    const r = await f(`${endpoint}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (!r.ok) throw new Error(`doh http ${r.status}`);
    const j = await r.json();
    if (j.Status !== 0 && j.Status !== 3) throw new Error(`doh status ${j.Status}`); // 3 = NXDOMAIN (no record)
    return (j.Answer || []).filter((a) => a.type === DNS_TYPE[type]).map((a) => String(a.data));
  }
  return {
    async reverse(ip) {
      return (await query(arpaName(ip), "PTR")).map((h) => h.replace(/\.$/, ""));
    },
    async forward(host) {
      const [a, aaaa] = await Promise.all([query(host, "A"), query(host, "AAAA")]);
      return [...a, ...aaaa];
    },
  };
}

// Request classifier: who is asking, and is it who it says it is.
// Classes: human, search, social, monitor, seo, ai, automation, bot.
import { SHIPPED_CATALOG } from "./catalog.js";
import { isIp, normalizeIp } from "./resolver.js";
import { sha256Hex } from "./util.js";

const BOT_WORDS = /\b(bot|crawler|spider|scraper|fetcher|crawl|agent|archiver|indexer)\b/i;
const BROWSER_TOKENS = /(chrome|safari|firefox|edg|opera|opr|msie|trident|samsungbrowser|ucbrowser)/;

const rdnsMemory = new Map(); // ip|suffixes -> {v: boolean, exp: ms}

/** First token of an unknown UA, for the bot-name column. */
export function shortName(ua) {
  const t = String(ua || "").trim();
  const m = /^([A-Za-z0-9_.-]+)/.exec(t);
  return (m ? m[1] : t).slice(0, 60);
}

/**
 * Reverse + forward DNS check, cached for a day. Returns true/false, or null when
 * DNS is unavailable (then the claim is taken at face value).
 * @param {string} ip
 * @param {string[]} suffixes
 * @param {{resolver: object, store?: object, now?: number}} o
 */
export async function verifyRdns(ip, suffixes, { resolver, store } = {}) {
  if (!resolver || !isIp(ip)) return null;
  const key = `${normalizeIp(ip)}|${suffixes.join(",")}`;
  const mem = rdnsMemory.get(key);
  if (mem && mem.exp > Date.now()) return mem.v;
  const skey = store ? "ppc:rdns:" + sha256Hex(key).slice(0, 32) : null;
  if (store) {
    try {
      const c = await store.get(skey);
      if (c === "y" || c === "n") return c === "y";
    } catch { /* cache is best effort */ }
  }
  let result;
  try {
    const hosts = await resolver.reverse(ip);
    const host = hosts && hosts[0] ? String(hosts[0]).toLowerCase().replace(/\.$/, "") : "";
    if (!host || host === ip) {
      result = false; // no PTR at all: not a search engine.
    } else if (!suffixes.some((s) => host.endsWith(String(s).toLowerCase()))) {
      result = false;
    } else {
      const forward = (await resolver.forward(host)) || [];
      const want = normalizeIp(ip);
      result = forward.some((f) => normalizeIp(f) === want);
    }
  } catch {
    return null; // DNS trouble: do not punish, do not cache.
  }
  rdnsMemory.set(key, { v: result, exp: Date.now() + 86_400_000 });
  if (store) {
    try { await store.put(skey, result ? "y" : "n", { ttl: 86_400 }); } catch { /* ignore */ }
  }
  return result;
}

/**
 * @param {string} ua
 * @param {Record<string,string>} headers lowercased header map
 * @param {string} ip remote address, for search-engine verification
 * @param {{catalog?: object[], resolver?: object, store?: object}} [opts] Pass a resolver to verify search engines.
 * @returns {Promise<{class:string, name:string, verified:boolean|null, impersonation:boolean}>}
 */
export async function classify(ua, headers = {}, ip = "", opts = {}) {
  const uaL = String(ua || "").trim().toLowerCase();
  const catalog = opts.catalog || SHIPPED_CATALOG;

  for (const entry of catalog) {
    if (!entry.match.some((needle) => uaL.includes(needle))) continue;
    let cls = entry.class;
    let verified = null;
    let imp = false;
    if (entry.verify && entry.verify.length && ip) {
      verified = await verifyRdns(ip, entry.verify, opts);
      if (verified === false) {
        cls = "automation"; // claimed a search engine, failed rDNS.
        imp = true;
      }
    }
    return { class: cls, name: entry.name, verified, impersonation: imp };
  }

  if (uaL === "") return { class: "automation", name: "Empty User-Agent", verified: null, impersonation: false };

  if (BOT_WORDS.test(uaL)) return { class: "bot", name: shortName(ua), verified: null, impersonation: false };

  if (uaL.includes("mozilla/") && BROWSER_TOKENS.test(uaL)) {
    const accept = String(headers.accept || "").toLowerCase();
    // A real navigation sends text/html; API-ish Accept with a browser UA is a tool.
    if (accept !== "" && !accept.includes("text/html") && !accept.includes("*/*") && !accept.includes("image/")) {
      return { class: "automation", name: "Browser-UA tool", verified: null, impersonation: false };
    }
    return { class: "human", name: "", verified: null, impersonation: false };
  }

  return { class: "bot", name: shortName(ua), verified: null, impersonation: false };
}

/** Merge an intel feed (Pro) into a catalog: new names appended, known names extended. */
export function mergeCatalog(catalog, agents) {
  const out = catalog.map((e) => ({ ...e, match: [...e.match] }));
  const by = new Map(out.map((e, i) => [e.name, i]));
  for (const a of agents || []) {
    if (by.has(a.name)) {
      const e = out[by.get(a.name)];
      e.match = [...new Set([...e.match, ...a.match])];
      if (a.verify && a.verify.length) e.verify = a.verify;
    } else {
      out.push(a);
    }
  }
  return out;
}

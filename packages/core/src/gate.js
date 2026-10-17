// The gate: classify the request, apply policy, answer 402 or let it through.
// Framework neutral: takes a Web Request, returns {type:"pass"|"respond"}.
import { classify } from "./classify.js";
import { SHIPPED_CATALOG } from "./catalog.js";
import { discoveryResponse, DISCOVERY_PATHS } from "./discovery.js";
import { memoryStore, takeLock } from "./stores.js";
import { isIp } from "./resolver.js";
import { MIN_PRICE_USD, MPP_PROBLEMS, X402, DEFAULT_FACILITATOR, usdToUnits } from "./x402.js";
import { b64Encode, sha256Hex } from "./util.js";

export const VERSION = "0.1.1";

export const DEFAULT_CLASS_POLICY = Object.freeze({
  search: "free", social: "free", monitor: "free", seo: "paid", ai: "paid", automation: "paid", bot: "paid",
});

const POLICIES = ["free", "paid", "block"];
const FREE_FILES = new Set(["/robots.txt", "/llms.txt", "/agents.txt", "/favicon.ico"]);
const SITEMAP_RE = /^\/[a-z0-9_-]*sitemap[a-z0-9_-]*\.xml$/;

/** Resolve "." and ".." segments (no decoding). */
function normalizePath(p) {
  const out = [];
  const segs = p.split("/");
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if (s === "..") out.pop();
    else if (s !== ".") out.push(s);
  }
  return "/" + out.join("/");
}

function under(norm, allow) {
  if (allow.endsWith("/")) return norm.startsWith(allow);
  return norm === allow || norm.startsWith(allow + "/");
}

/**
 * Anchored exemption check: exact files, root-level sitemap .xml files, the /.well-known/ directory and
 * allowPaths (path-segment boundary, so "/pricing" never matches "/pricing-secret"). Paths with dot
 * segments, doubled slashes or %2e / %2f are never exempt.
 */
/** The path as written in the request URL (before URL normalisation), when the URL string is absolute. */
function rawPathOf(href, url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(href);
  return m ? m[1] || "/" : url.pathname;
}

export function isFreePath(raw, allowPaths = []) {
  if (typeof raw !== "string" || raw[0] !== "/" || /%2[ef]/i.test(raw)) return false;
  const norm = normalizePath(raw);
  if (norm.replace(/\/+$/, "") !== raw.replace(/\/+$/, "")) return false;
  if (FREE_FILES.has(norm) || SITEMAP_RE.test(norm) || norm === "/.well-known" || under(norm, "/.well-known/")) return true;
  return allowPaths.some((p) => (p = p.trim()) && under(norm, p));
}
const ASSET_EXT = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg)$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Validate and fill defaults. Never throws: a bad config downgrades to monitor and says why in `warnings`. */
export function resolveSettings(o = {}) {
  const warnings = [];
  let mode = o.mode === "gate" ? "gate" : "monitor";
  const payTo = String(o.payTo || "");
  if (mode === "gate" && !ADDRESS.test(payTo)) {
    warnings.push("mode is gate but payTo is not a valid 0x address; running in monitor mode");
    mode = "monitor";
  }
  let priceUsd = Number(o.priceUsd ?? 0.01);
  if (!Number.isFinite(priceUsd) || priceUsd < MIN_PRICE_USD) {
    warnings.push(`priceUsd below the $${MIN_PRICE_USD} floor; using $${MIN_PRICE_USD}`);
    priceUsd = MIN_PRICE_USD;
  }
  const classPolicy = { ...DEFAULT_CLASS_POLICY };
  for (const [k, v] of Object.entries(o.classPolicy || {})) if (POLICIES.includes(v)) classPolicy[k] = v;
  const botOverrides = {};
  for (const [k, v] of Object.entries(o.botOverrides || {})) if (POLICIES.includes(v)) botOverrides[k] = v;
  const mppSecret = o.mppSecret || sha256Hex(`forgemesh-ppc|${payTo.toLowerCase()}|${o.siteName || ""}`);
  if (!o.mppSecret) warnings.push("mppSecret not set; derived from payTo. Set MPP_SECRET to a random value.");
  return {
    mode,
    paid: mode === "gate" && ADDRESS.test(payTo),
    payTo,
    priceUsd,
    facilitatorUrl: String(o.facilitatorUrl || DEFAULT_FACILITATOR).replace(/\/+$/, ""),
    facilitatorAuth: o.facilitatorAuth || "",
    classPolicy,
    botOverrides,
    allowPaths: (o.allowPaths || []).map(String).filter(Boolean),
    gateAssets: !!o.gateAssets,
    gateAllMethods: !!o.gateAllMethods,
    discovery: o.discovery !== false,
    siteName: o.siteName || "",
    siteDescription: o.siteDescription || "",
    contact: o.contact || null,
    llmsLinks: o.llmsLinks || [],
    mppSecret,
    trustHeader: o.trustHeader ? String(o.trustHeader).toLowerCase() : "",
    logHumans: !!o.logHumans,
    baseUrl: o.baseUrl ? String(o.baseUrl).replace(/\/*$/, "/") : "",
    warnings,
  };
}

/**
 * @param {object} options see README. payTo, priceUsd, mode, classPolicy, botOverrides, allowPaths,
 *   facilitatorUrl, trustHeader, mppSecret, siteName, store, resolver, fetch, catalog, onEvent, baseUrl
 */
export function createGate(options = {}) {
  const s = resolveSettings(options);
  const store = options.store || memoryStore();
  const fetchFn = options.fetch || globalThis.fetch;
  const log = options.logger || console;
  for (const w of s.warnings) log.warn && log.warn(`[pay-per-crawl] ${w}`);

  const baseOf = (url) => s.baseUrl || url.origin + "/";
  const x402For = (base, realm) =>
    new X402({
      payTo: s.payTo, priceUsd: s.priceUsd, facilitatorUrl: s.facilitatorUrl, facilitatorAuth: s.facilitatorAuth,
      mppSecret: s.mppSecret, realm, siteName: s.siteName || realm, manifestUrl: base + ".well-known/x402.json", fetch: fetchFn,
    });

  function exempt(path, method) {
    if (!s.gateAllMethods && method !== "GET" && method !== "HEAD") return true;
    if (isFreePath(path, s.allowPaths)) return true;
    if (!s.gateAssets && ASSET_EXT.test(path)) return true;
    return false;
  }

  function policyFor(c) {
    const over = s.botOverrides[c.name];
    if (c.name !== "" && over) return over;
    return s.classPolicy[c.class] || "paid";
  }

  function clientIp(request, ctx) {
    if (s.trustHeader) {
      const v = request.headers.get(s.trustHeader);
      if (v) {
        // Multi-value header (X-Forwarded-For): the RIGHT-MOST entry is the one our own proxy appended;
        // the left-most is client-controlled. Single-value edge headers (CF-Connecting-IP) are one entry.
        const parts = v.split(",").map((x) => x.trim()).filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && isIp(last)) return last;
      }
    }
    return (ctx && ctx.ip) || "";
  }

  const ipHash = (ip) => (ip ? sha256Hex(`${options.ipSalt || s.mppSecret}|${new Date().toISOString().slice(0, 10)}|${ip}`).slice(0, 16) : "");

  function linkHeader(base) {
    return `<${base}.well-known/x402.json>; rel="describedby"; type="application/json", <${base}llms.txt>; rel="llms-txt"; type="text/plain"`;
  }

  function respond402(x402, base, request, reason, detail, rail) {
    const desc = `${x402.cfg.siteName}: one page fetch (HTML)`;
    const headers = new Headers({
      "cache-control": "no-store",
      "payment-required": b64Encode(JSON.stringify(x402.envelopeV2(request.url, desc, reason || "Payment required"))),
      "www-authenticate": x402.mppChallenge(desc),
      link: `<${base}.well-known/x402.json>; rel="describedby"; type="application/json"`,
      "x-robots-tag": "noindex",
    });
    if (rail === "mpp" && reason) {
      headers.set("content-type", "application/problem+json; charset=utf-8");
      return new Response(JSON.stringify({ type: MPP_PROBLEMS + reason, title: "Payment Required", status: 402, detail: detail || reason }), { status: 402, headers });
    }
    headers.set("content-type", "application/json; charset=utf-8");
    const body = request.method === "HEAD" ? null : JSON.stringify(x402.bodyV1(request.url, desc, reason ? "Payment rejected" : "Payment required", reason || null));
    return new Response(body, { status: 402, headers });
  }

  const blocked = () =>
    new Response(JSON.stringify({ error: "forbidden", detail: "This crawler is not permitted on this site." }), {
      status: 403, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

  async function catalogNow() {
    const c = options.catalog;
    if (!c) return SHIPPED_CATALOG;
    return typeof c === "function" ? c() : c;
  }

  /**
   * Discovery files, or null. Call before handle().
   * @param {Request} request
   */
  function discovery(request) {
    if (!s.discovery || (request.method !== "GET" && request.method !== "HEAD")) return null;
    const url = new URL(request.url);
    if (!DISCOVERY_PATHS.includes(url.pathname.replace(/\/+$/, ""))) return null;
    const res = discoveryResponse(url.pathname, s, baseOf(url), VERSION);
    return request.method === "HEAD" && res ? new Response(null, { status: 200, headers: res.headers }) : res;
  }

  /**
   * @param {Request} request
   * @param {{ip?: string, waitUntil?: (p: Promise<unknown>) => void}} [ctx]
   * @returns {Promise<{type:"pass", headers: Headers, event?: object} | {type:"respond", response: Response, event?: object}>}
   */
  async function handle(request, ctx = {}) {
    const url = new URL(request.url);
    const base = baseOf(url);
    const passHeaders = new Headers();
    if (s.discovery) passHeaders.set("link", linkHeader(base));
    const pass = (event) => ({ type: "pass", headers: passHeaders, event });
    const method = request.method.toUpperCase();
    if (exempt(rawPathOf(request.url, url), method)) return pass();

    const h = Object.fromEntries(request.headers);
    const ua = h["user-agent"] || "";
    const ip = clientIp(request, ctx);
    const c = await classify(ua, h, ip, { catalog: await catalogNow(), resolver: options.resolver, store });
    const row = {
      ts: new Date().toISOString(), ua_class: c.class, bot_name: c.name, verified: c.verified, method,
      path: url.pathname.slice(0, 255), ip_hash: ipHash(ip), ua: ua.slice(0, 255),
    };
    const emit = (extra) => {
      const event = { ...row, ...extra };
      if (options.onEvent) {
        try {
          const p = options.onEvent(event);
          if (p && typeof p.then === "function") {
            const safe = p.catch((e) => log.warn && log.warn("[pay-per-crawl] onEvent failed:", e && e.message));
            if (ctx.waitUntil) ctx.waitUntil(safe);
          }
        } catch (e) {
          log.warn && log.warn("[pay-per-crawl] onEvent failed:", e && e.message);
        }
      }
      return event;
    };

    const realm = new URL(base).hostname;
    const x402 = x402For(base, realm);
    const payment = x402.extractPayment(h, request.url);

    if (c.class === "human" && !payment) {
      return pass(s.logHumans ? emit({ status: "passed" }) : undefined);
    }

    const policy = policyFor(c);

    // A payment on a free class is still honoured (and logged as revenue).
    if (policy === "free" && !payment) return pass(emit({ status: "passed" }));
    if (policy === "block") {
      const event = emit({ status: "blocked" });
      return { type: "respond", response: blocked(), event };
    }
    if (!payment) {
      if (s.mode === "monitor") return pass(emit({ status: "monitor", amount_units: Number(usdToUnits(s.priceUsd)) }));
      const event = emit({ status: "unpaid" });
      return { type: "respond", response: respond402(x402, base, request, null, null, null), event };
    }

    // Payment presented.
    row.rail = payment.rail;
    const reject = (status, reason, detail, extra = {}) => ({
      type: "respond",
      response: respond402(x402, base, request, reason, detail || null, payment.rail),
      event: emit({ status, reason, ...extra }),
    });
    if (payment.error) return reject("rejected", payment.error, payment.detail);
    const pre = x402.precheck(payment);
    if (pre) return reject("rejected", pre);

    const auth = X402.authorizationOf(payment);
    const lockKey = "ppc:nonce:" + sha256Hex(String(auth.nonce).toLowerCase());
    if (!(await takeLock(store, lockKey, 15 * 60))) {
      return reject("rejected", "payment_in_flight", "This authorization was already presented.");
    }

    const r = await x402.verifyAndSettle(payment, request.url);
    if (!r.ok) {
      if (r.reason === "facilitator_unreachable") await store.delete(lockKey); // let the client retry the same authorization.
      return reject("settle_failed", r.reason, r.detail, { payer: String(r.payer || auth.from || "") });
    }

    const event = emit({ status: "paid", amount_units: Number(auth.value), tx_hash: r.tx, payer: String(r.payer || auth.from || "") });
    const receipt = b64Encode(JSON.stringify(r.settle));
    passHeaders.set("payment-response", receipt);
    passHeaders.set("x-payment-response", receipt);
    if (payment.rail === "mpp") passHeaders.set("payment-receipt", x402.mppReceipt(r.tx));
    passHeaders.set("cache-control", "private, no-store");
    return pass(event);
  }

  return { settings: s, handle, discovery, linkHeader: (url) => linkHeader(baseOf(new URL(url))), store };
}

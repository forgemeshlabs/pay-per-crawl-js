// Shared helpers for the edge/server adapters.

const json = (v, fallback) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

const list = (v) => {
  if (Array.isArray(v)) return v.map(String);
  if (!v) return [];
  const parsed = typeof v === "string" && v.trim().startsWith("[") ? json(v, null) : null;
  return parsed ? parsed.map(String) : String(v).split(",").map((x) => x.trim()).filter(Boolean);
};

const bool = (v) => v === true || /^(1|true|yes|on)$/i.test(String(v || ""));

/**
 * Turn a flat env-style map (PAY_TO, PRICE_USD, MODE, FACILITATOR_URL, CLASS_POLICY json,
 * BOT_OVERRIDES json, ALLOW_PATHS, TRUST_HEADER, MPP_SECRET, SITE_NAME, ...) into gate options.
 */
export function parseConfig(env = {}) {
  return {
    payTo: env.PAY_TO,
    priceUsd: env.PRICE_USD === undefined || env.PRICE_USD === "" ? undefined : Number(env.PRICE_USD),
    mode: env.MODE,
    facilitatorUrl: env.FACILITATOR_URL,
    facilitatorAuth: env.FACILITATOR_AUTH,
    classPolicy: json(env.CLASS_POLICY, {}),
    botOverrides: json(env.BOT_OVERRIDES, {}),
    allowPaths: list(env.ALLOW_PATHS),
    trustHeader: env.TRUST_HEADER,
    mppSecret: env.MPP_SECRET,
    siteName: env.SITE_NAME,
    siteDescription: env.SITE_DESCRIPTION,
    baseUrl: env.BASE_URL,
    discovery: env.DISCOVERY === undefined ? true : bool(env.DISCOVERY),
    gateAssets: bool(env.GATE_ASSETS),
    logHumans: bool(env.LOG_HUMANS),
  };
}

/** Copy gate pass-through headers (Link, receipts) onto a response; returns a new Response. */
export function applyToResponse(res, headers) {
  const out = new Response(res.body, res);
  for (const [k, v] of headers) out.headers.set(k, v);
  return out;
}

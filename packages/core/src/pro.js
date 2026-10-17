// Optional Pro reporter: batches daily rollups + settlements and posts them to the
// hosted dashboard (Bearer license key). Never required; the gate works without it.
import { CLASSES, SHIPPED_CATALOG } from "./catalog.js";
import { mergeCatalog } from "./classify.js";
import { memoryStore } from "./stores.js";
import { VERSION } from "./gate.js";

export const PRO_BASE = "https://proxy.forgemesh.io";
const KEY_RE = /^fmppc_[A-Za-z0-9_-]{20,}$/;
const HOUR = 3600_000;
const DAY = 86_400_000;
const MAX_SOURCES = 200;

export const proEnabled = (key) => KEY_RE.test(String(key || ""));

const dayOf = (iso) => iso.slice(0, 10);
const sqlTs = (iso) => iso.slice(0, 19).replace("T", " ");

/**
 * @param {{key: string, site: {host:string,url:string,name:string,mode:string,price_usd:number,pay_to:string,listed?:boolean}, store?: object, fetch?: typeof fetch, base?: string}} o
 */
export function createProReporter(o) {
  const store = o.store || memoryStore();
  const base = (o.base || PRO_BASE).replace(/\/+$/, "");
  const f = () => o.fetch || globalThis.fetch;
  const enabled = proEnabled(o.key);
  const site = () => ({ plugin_version: `js-${VERSION}`, listed: o.site.listed !== false, ...o.site });

  async function request(method, path, body) {
    try {
      const r = await f()(base + path, {
        method,
        headers: { authorization: `Bearer ${o.key}`, "content-type": "application/json", accept: "application/json", "user-agent": `forgemesh-pay-per-crawl-js/${VERSION} (${o.site.host})` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(30_000) : undefined,
      });
      let json = null;
      try { json = await r.json(); } catch { /* not json */ }
      if (!json || typeof json !== "object") return { ok: false, error: `HTTP ${r.status}`, code: r.status };
      return { ...json, code: r.status, ok: r.status < 400 && json.ok !== false };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), code: 0 };
    }
  }

  const getJson = async (k, d) => { try { const v = await store.get(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const putJson = (k, v, ttl) => store.put(k, JSON.stringify(v), ttl ? { ttl } : undefined);

  /** Fold one gate event into today's rollup (and the pending settlements list). */
  async function record(ev) {
    if (!enabled || ev.ua_class === "human") return;
    const day = dayOf(ev.ts);
    const key = `ppc:rollup:${day}`;
    const roll = await getJson(key, { rows: {} });
    const rk = `${ev.bot_name}|${ev.ua_class}`;
    const r = (roll.rows[rk] ||= { bot_name: ev.bot_name, ua_class: ev.ua_class, hits: 0, paid: 0, unpaid: 0, rejected: 0, monitor: 0, revenue_units: 0, would_units: 0, src: [] });
    r.hits++;
    if (ev.status === "paid") { r.paid++; r.revenue_units += ev.amount_units || 0; }
    else if (ev.status === "unpaid") r.unpaid++;
    else if (ev.status === "rejected" || ev.status === "settle_failed") r.rejected++;
    else if (ev.status === "monitor") { r.monitor++; r.would_units += ev.amount_units || 0; }
    if (ev.ip_hash && r.src.length < MAX_SOURCES && !r.src.includes(ev.ip_hash)) r.src.push(ev.ip_hash);
    await putJson(key, roll, 3 * 86_400);
    if (ev.status === "paid" && ev.tx_hash) {
      const pend = await getJson("ppc:settlements", []);
      pend.push({ tx_hash: ev.tx_hash, ts: sqlTs(ev.ts), bot_name: ev.bot_name, ua_class: ev.ua_class, path: ev.path, rail: ev.rail || "", amount_units: ev.amount_units || 0, payer: ev.payer || "" });
      await putJson("ppc:settlements", pend.slice(-1000));
    }
  }

  async function verify() {
    const r = await request("POST", "/api/wp/license/verify");
    await putJson("ppc:pro-state", { verified_at: Date.now(), ok: !!r.ok, status: String(r.status || r.error || "error") });
    return r;
  }

  async function fetchIntel() {
    const r = await request("GET", "/api/wp/intel");
    if (!r.ok || !Array.isArray(r.agents)) return r;
    const clean = [];
    for (const a of r.agents.slice(0, 500)) {
      if (!a || !a.name || !Array.isArray(a.match) || !a.match.length || !CLASSES.includes(a.class)) continue;
      clean.push({
        name: String(a.name).slice(0, 64), class: a.class,
        match: a.match.slice(0, 8).map((m) => String(m).slice(0, 64).toLowerCase()).filter(Boolean),
        verify: (a.verify || []).map(String).filter(Boolean),
      });
    }
    await putJson("ppc:intel", { version: String(r.version || ""), agents: clean, at: Date.now() });
    return { ...r, count: clean.length };
  }

  /** Push rollups for yesterday + today and pending settlements. Safe to call often; `force` skips the hourly throttle. */
  async function flush({ force = false } = {}) {
    if (!enabled) return { skipped: "disabled" };
    const st = await getJson("ppc:pro-state", {});
    if (!force && st.synced_at && Date.now() - st.synced_at < HOUR) return { skipped: "throttled" };
    if (!st.verified_at || Date.now() - st.verified_at > DAY) {
      await verify();
      Object.assign(st, await getJson("ppc:pro-state", {}));
    }
    if (!st.ok) return { skipped: "license_not_ok", status: st.status };
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const daily = [];
    for (const day of [yesterday, today]) {
      const roll = await getJson(`ppc:rollup:${day}`, { rows: {} });
      const rows = Object.values(roll.rows).map(({ src, ...r }) => ({ ...r, sources: src.length })).sort((a, b) => b.hits - a.hits).slice(0, 500);
      daily.push({ day, rows });
    }
    const settlements = await getJson("ppc:settlements", []);
    const r = await request("POST", "/api/wp/ingest", { site: site(), daily, settlements });
    const patch = { synced_at: Date.now(), sync_ok: !!r.ok, sync_error: r.ok ? "" : String(r.error || `HTTP ${r.code}`) };
    if (r.ok) {
      const sent = new Set(settlements.map((s) => s.tx_hash));
      const now = await getJson("ppc:settlements", []);
      await putJson("ppc:settlements", now.filter((s) => !sent.has(s.tx_hash)));
    }
    await putJson("ppc:pro-state", { ...(await getJson("ppc:pro-state", {})), ...patch });
    const intel = await getJson("ppc:intel", null);
    if (!intel || Date.now() - (intel.at || 0) > DAY) await fetchIntel();
    return { ok: !!r.ok, response: r, settlements: settlements.length };
  }

  let memo = { at: 0, catalog: null };
  /** Shipped catalog plus the pulled intel feed (cached 10 minutes in memory). */
  async function catalog() {
    if (memo.catalog && Date.now() - memo.at < 600_000) return memo.catalog;
    const intel = enabled ? await getJson("ppc:intel", null) : null;
    memo = { at: Date.now(), catalog: intel ? mergeCatalog(SHIPPED_CATALOG, intel.agents) : SHIPPED_CATALOG };
    return memo.catalog;
  }

  return { enabled, record, flush, verify, fetchIntel, catalog };
}

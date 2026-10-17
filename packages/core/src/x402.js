// x402 (v1 + v2) and MPP wire formats: challenge envelopes, payment parsing,
// facilitator verify/settle. Behaviour parity with the ForgeMesh WordPress plugin.
import { keccak_256 } from "@noble/hashes/sha3";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { b64Encode, b64Json, b64urlEncode, b64urlEncodeBytes, b64urlJson, timingSafeEqual, utf8 } from "./util.js";

export const NETWORK_V2 = "eip155:8453";
export const NETWORK_V1 = "base";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_NAME = "USD Coin";
export const USDC_VERSION = "2";
export const USDC_DECIMALS = 6;
export const TIMEOUT_SECS = 300;
export const MPP_PROBLEMS = "https://paymentauth.org/problems/";
export const DEFAULT_FACILITATOR = "https://facilitator.payai.network";
export const MIN_PRICE_USD = 0.005;

export const usdToUnits = (usd) => String(Math.round(Number(usd) * 1_000_000));
export const unitsToUsd = (units) => Number(units) / 1_000_000;

/** keccak256 of a UTF-8 string, 0x-prefixed lowercase hex. */
export const keccakHex = (s) => "0x" + bytesToHex(keccak_256(utf8(s)));

const isDigits = (v) => /^\d+$/.test(String(v));
const nowSecs = () => Math.floor(Date.now() / 1000);

// RFC 8785-style canonical JSON, enough for the MPP request object.
function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export class X402 {
  /**
   * @param {object} cfg payTo, priceUsd, facilitatorUrl, facilitatorAuth, mppSecret, realm, siteName, manifestUrl, fetch
   */
  constructor(cfg) {
    this.cfg = cfg;
  }

  requirementsV2() {
    return {
      scheme: "exact",
      network: NETWORK_V2,
      amount: usdToUnits(this.cfg.priceUsd),
      asset: USDC,
      payTo: this.cfg.payTo,
      maxTimeoutSeconds: TIMEOUT_SECS,
      extra: { name: USDC_NAME, version: USDC_VERSION },
    };
  }

  requirementsV1(resourceUrl, description = "") {
    return {
      scheme: "exact",
      network: NETWORK_V1,
      maxAmountRequired: usdToUnits(this.cfg.priceUsd),
      asset: USDC,
      payTo: this.cfg.payTo,
      maxTimeoutSeconds: TIMEOUT_SECS,
      resource: resourceUrl,
      description,
      mimeType: "text/html",
      extra: { name: USDC_NAME, version: USDC_VERSION },
    };
  }

  /** v2 envelope that goes base64 into PAYMENT-REQUIRED. */
  envelopeV2(resourceUrl, description, error = "Payment required") {
    return {
      x402Version: 2,
      error,
      resource: { url: resourceUrl, description, mimeType: "text/html" },
      accepts: [this.requirementsV2()],
    };
  }

  /** v1 body for stock x402-fetch 1.x clients. */
  bodyV1(resourceUrl, description, error = "Payment required", invalidReason = null) {
    const body = {
      x402Version: 1,
      error,
      accepts: [this.requirementsV1(resourceUrl, description)],
      provider: { name: this.cfg.siteName, plugin: "forgemesh-pay-per-crawl" },
      docs: { x402: "https://x402.org", manifest: this.cfg.manifestUrl },
    };
    if (invalidReason) body.invalidReason = invalidReason;
    return body;
  }

  /**
   * Find a payment on the request. Returns null, or {rail, payload, error, detail, mpp}.
   * @param {Record<string,string>} h lowercased header map
   */
  extractPayment(h, resourceUrl) {
    if (h["payment-signature"]) {
      const p = b64Json(h["payment-signature"]);
      if (!p || Number(p.x402Version) !== 2 || !p.payload) return { rail: "x402v2", error: "malformed_payment_signature" };
      return { rail: "x402v2", payload: p };
    }
    if (h["x-payment"]) {
      const p = b64Json(h["x-payment"]);
      if (!p || Number(p.x402Version) !== 1 || !p.payload) return { rail: "x402v1", error: "malformed_x_payment" };
      return { rail: "x402v1", payload: p };
    }
    const m = h.authorization && /^Payment\s+([A-Za-z0-9_-]+)$/i.exec(String(h.authorization).trim());
    if (m) {
      const cred = b64urlJson(m[1]);
      const err = this.validateMpp(cred);
      if (err) return { rail: "mpp", error: err.problem, detail: err.detail };
      const pl = cred.payload;
      return {
        rail: "mpp",
        mpp: cred,
        payload: {
          x402Version: 2,
          resource: { url: resourceUrl },
          accepted: this.requirementsV2(),
          payload: {
            signature: pl.signature,
            authorization: { from: pl.from, to: pl.to, value: pl.value, validAfter: pl.validAfter, validBefore: pl.validBefore, nonce: pl.nonce },
          },
        },
      };
    }
    return null;
  }

  /** The EIP-3009 authorization inside any rail's payload, or null. */
  static authorizationOf(payment) {
    const a = payment && payment.payload && payment.payload.payload && payment.payload.payload.authorization;
    return a && typeof a === "object" ? a : null;
  }

  /** Cheap local checks before talking to the facilitator. Returns an error code or null. */
  precheck(payment, now = nowSecs()) {
    const auth = X402.authorizationOf(payment);
    if (!auth || !auth.to || auth.value === undefined || auth.value === null || !auth.nonce) return "malformed_authorization";
    if (String(auth.to).toLowerCase() !== this.cfg.payTo.toLowerCase()) return "wrong_pay_to";
    const want = usdToUnits(this.cfg.priceUsd);
    const val = String(auth.value);
    const v1Over = isDigits(val) && BigInt(val) >= BigInt(want) && payment.rail === "x402v1";
    if (val !== want && !v1Over) return "wrong_amount";
    const p = payment.payload;
    if (payment.rail === "x402v2") {
      const acc = p.accepted || {};
      if (acc.network !== NETWORK_V2 || String(acc.asset || "").toLowerCase() !== USDC.toLowerCase()) return "wrong_network_or_asset";
    } else if (payment.rail === "x402v1") {
      if (p.network !== NETWORK_V1 || p.scheme !== "exact") return "wrong_network_or_scheme";
    }
    if (auth.validBefore !== undefined && isDigits(auth.validBefore) && Number(auth.validBefore) < now) return "authorization_expired";
    return null;
  }

  facilitatorUrl() {
    const u = String(this.cfg.facilitatorUrl || "").trim();
    return (u || DEFAULT_FACILITATOR).replace(/\/+$/, "");
  }

  /**
   * POST verify then settle. Serve only on a non-empty transaction hash.
   * @returns {Promise<{ok:boolean, reason?:string, detail?:string, settle?:object, tx?:string, payer?:string}>}
   */
  async verifyAndSettle(payment, resourceUrl) {
    const p = { ...payment.payload };
    let req, version;
    if (payment.rail === "x402v1") {
      req = this.requirementsV1(resourceUrl, this.cfg.siteName);
      version = 1;
    } else {
      req = this.requirementsV2();
      version = 2;
      // The facilitator deep-compares `accepted` with requirements for v2; send ours.
      p.accepted = req;
      if (!p.resource) p.resource = { url: resourceUrl };
    }
    const body = { x402Version: version, paymentPayload: p, paymentRequirements: req };

    const v = await this.#post("/verify", body);
    if (v.error) return { ok: false, reason: "facilitator_unreachable", detail: v.error };
    if (!v.json.isValid) return { ok: false, reason: String(v.json.invalidReason || "verification_failed"), payer: v.json.payer };
    const s = await this.#post("/settle", body);
    if (s.error) return { ok: false, reason: "facilitator_unreachable", detail: s.error };
    const tx = String(s.json.transaction || "");
    if (!s.json.success || tx === "") return { ok: false, reason: String(s.json.errorReason || "settlement_failed"), settle: s.json };
    return { ok: true, settle: s.json, tx, payer: s.json.payer || v.json.payer };
  }

  async #post(path, body) {
    const f = this.cfg.fetch || globalThis.fetch;
    const headers = { "content-type": "application/json", accept: "application/json" };
    if (this.cfg.facilitatorAuth) headers.authorization = this.cfg.facilitatorAuth;
    try {
      const r = await f(this.facilitatorUrl() + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "manual",
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(45_000) : undefined,
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* handled below */ }
      if (!json || typeof json !== "object") return { error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
      return { json };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }

  // ── MPP ───────────────────────────────────────────────────────────────────

  challengeId(realm, requestB64, expires, digest = "", opaque = "") {
    const input = [realm, "evm", "charge", requestB64, expires, digest, opaque].join("|");
    return b64urlEncodeBytes(hmac(sha256, utf8(this.cfg.mppSecret), utf8(input)));
  }

  /** WWW-Authenticate: Payment ... header value. */
  mppChallenge(description = "") {
    const request = {
      amount: usdToUnits(this.cfg.priceUsd),
      currency: USDC,
      recipient: this.cfg.payTo,
      methodDetails: { chainId: 8453, credentialTypes: ["authorization"], decimals: USDC_DECIMALS },
    };
    if (description) request.description = description;
    const requestB64 = b64urlEncode(jcs(request));
    const expires = new Date(Date.now() + TIMEOUT_SECS * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const id = this.challengeId(this.cfg.realm, requestB64, expires);
    return `Payment id="${id}", realm="${this.cfg.realm}", method="evm", intent="charge", expires="${expires}", request="${requestB64}"`;
  }

  /** @returns {{problem:string, detail:string}|null} */
  validateMpp(cred) {
    const bad = (problem, detail) => ({ problem, detail });
    if (!cred || typeof cred !== "object" || !cred.challenge || typeof cred.challenge !== "object" || !cred.payload || typeof cred.payload !== "object") {
      return bad("malformed-credential", "Credential must contain challenge and payload objects.");
    }
    const ch = cred.challenge;
    if (ch.realm !== this.cfg.realm || ch.method !== "evm" || ch.intent !== "charge" || !ch.id || !ch.request || !ch.expires) {
      return bad("invalid-challenge", "Challenge fields missing or not issued by this realm.");
    }
    if (!(Date.parse(ch.expires) >= Date.now())) return bad("payment-expired", "Challenge has expired; retry with a fresh challenge.");
    const expected = this.challengeId(ch.realm, ch.request, ch.expires, ch.digest || "", ch.opaque || "");
    if (!timingSafeEqual(expected, ch.id)) return bad("invalid-challenge", "Challenge id does not match its parameters.");
    const request = b64urlJson(ch.request);
    if (!request || request.amount !== usdToUnits(this.cfg.priceUsd)
      || String(request.recipient || "").toLowerCase() !== this.cfg.payTo.toLowerCase()
      || String(request.currency || "").toLowerCase() !== USDC.toLowerCase()) {
      return bad("invalid-challenge", "Challenge request does not match this resource's payment terms.");
    }
    const pl = cred.payload;
    if (pl.type !== "authorization") return bad("verification-failed", 'Only credentialTypes ["authorization"] (EIP-3009) is accepted.');
    for (const f of ["from", "to", "value", "validAfter", "validBefore", "nonce", "signature"]) {
      if (typeof pl[f] !== "string" || pl[f] === "") return bad("verification-failed", `Payload field ${f} is required.`);
    }
    if (pl.nonce.toLowerCase() !== keccakHex(ch.id + ch.realm)) {
      return bad("verification-failed", "Payload nonce must equal keccak256(challenge.id || challenge.realm).");
    }
    return null;
  }

  mppReceipt(tx) {
    return b64urlEncode(JSON.stringify({ status: "success", method: "evm", timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), reference: tx }));
  }
}

export { b64Encode };

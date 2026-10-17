import { keccakHex, X402 } from "../src/index.js";
import { b64urlEncode, b64Encode } from "../src/util.js";

export const PAY_TO = "0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09";
export const UA_GPT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";
export const UA_HUMAN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

let n = 0;
export const randNonce = () => "0x" + (++n).toString(16).padStart(64, "0");

export function authz(value = "10000", extra = {}) {
  return { from: "0x" + "b".repeat(40), to: PAY_TO, value, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: randNonce(), ...extra };
}

export function v2Header(a = authz()) {
  const x = new X402({ payTo: PAY_TO, priceUsd: 0.01 });
  return b64Encode(JSON.stringify({ x402Version: 2, accepted: x.requirementsV2(), payload: { signature: "0xsig", authorization: a } }));
}
export function v1Header(a = authz()) {
  return b64Encode(JSON.stringify({ x402Version: 1, scheme: "exact", network: "base", payload: { signature: "0xsig", authorization: a } }));
}
/** Build an MPP Authorization header from a WWW-Authenticate challenge. */
export function mppHeader(www, a = authz()) {
  const m = /id="([^"]+)".*realm="([^"]+)".*expires="([^"]+)".*request="([^"]+)"/.exec(www);
  const cred = { challenge: { id: m[1], realm: m[2], method: "evm", intent: "charge", expires: m[3], request: m[4] },
    payload: { type: "authorization", ...a, nonce: keccakHex(m[1] + m[2]), signature: "0xsig" } };
  return "Payment " + b64urlEncode(JSON.stringify(cred));
}

/** Mock facilitator as a fetch function; records calls. */
export function mockFacilitator(mode = "ok") {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = new URL(url).pathname;
    calls.push({ path, body });
    const json = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (mode === "down") throw new Error("connect ECONNREFUSED");
    if (path === "/verify") return json(mode === "reject" ? { isValid: false, invalidReason: "insufficient_funds" } : { isValid: true, payer: body.paymentPayload.payload.authorization.from });
    if (path === "/settle") return json(mode === "notx" ? { success: true, transaction: "" } : { success: true, transaction: "0x" + "ab".repeat(32), network: body.paymentRequirements.network, payer: body.paymentPayload.payload.authorization.from });
    return new Response("{}", { status: 404 });
  };
  f.calls = calls;
  return f;
}

export const req = (url, ua, headers = {}, method = "GET") => new Request(url, { method, headers: { "user-agent": ua, ...headers } });

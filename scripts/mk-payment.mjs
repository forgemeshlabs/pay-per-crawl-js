// Build payment request headers for the curl matrix (fake signature; the mock facilitator ignores it).
// usage: node mk-payment.mjs v2|v1|v1-under|mpp <resourceUrl> [www-authenticate]
import { randomBytes } from "node:crypto";
import { keccakHex, X402 } from "@forgemeshlabs/pay-per-crawl-core";

const [kind, , www] = process.argv.slice(2);
const PAY_TO = process.env.PAY_TO || "0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const auth = (value) => ({ from: "0x" + "b".repeat(40), to: PAY_TO, value, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + randomBytes(32).toString("hex") });
const x = new X402({ payTo: PAY_TO, priceUsd: 0.01 });
if (kind === "v2") console.log("PAYMENT-SIGNATURE: " + b64({ x402Version: 2, accepted: x.requirementsV2(), payload: { signature: "0xsig", authorization: auth("10000") } }));
else if (kind === "v1" || kind === "v1-under") console.log("X-PAYMENT: " + b64({ x402Version: 1, scheme: "exact", network: "base", payload: { signature: "0xsig", authorization: auth(kind === "v1" ? "10000" : "5000") } }));
else if (kind === "mpp") {
  const m = /id="([^"]+)".*realm="([^"]+)".*expires="([^"]+)".*request="([^"]+)"/.exec(www);
  const cred = { challenge: { id: m[1], realm: m[2], method: "evm", intent: "charge", expires: m[3], request: m[4] }, payload: { type: "authorization", ...auth("10000"), nonce: keccakHex(m[1] + m[2]), signature: "0xsig" } };
  console.log("Authorization: Payment " + Buffer.from(JSON.stringify(cred)).toString("base64url"));
} else process.exit(2);

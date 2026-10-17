// Small, runtime-neutral helpers (no Buffer, no node: imports).
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s) => enc.encode(String(s));

export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64Encode(str) {
  return bytesToB64(utf8(str));
}

/** Standard base64 -> string, or null when invalid. */
export function b64Decode(s) {
  try {
    const bin = atob(String(s));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return dec.decode(out);
  } catch {
    return null;
  }
}

export function b64urlEncodeBytes(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const b64urlEncode = (str) => b64urlEncodeBytes(utf8(str));

export function b64urlDecode(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return b64Decode(t);
}

export function parseJson(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export const b64Json = (s) => parseJson(b64Decode(s));
export const b64urlJson = (s) => parseJson(b64urlDecode(s));

export const sha256Hex = (s) => bytesToHex(sha256(utf8(s)));

export function timingSafeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Trim trailing zeros of a fixed 6-decimal price: 0.01 -> "0.01", 1 -> "1". */
export function priceString(price) {
  return Number(price).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

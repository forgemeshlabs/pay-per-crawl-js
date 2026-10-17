// Tiny key/value store interface: { get(key), put(key, value, {ttl}), delete(key) }.
// memoryStore() is per-process; kvStore() wraps a Cloudflare KV namespace.

export function memoryStore(max = 50_000) {
  const m = new Map();
  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of m) if (v.exp && v.exp <= now) m.delete(k);
    while (m.size > max) m.delete(m.keys().next().value);
  };
  return {
    async get(k) {
      const v = m.get(k);
      if (!v) return null;
      if (v.exp && v.exp <= Date.now()) { m.delete(k); return null; }
      return v.val;
    },
    async put(k, val, { ttl } = {}) {
      if (m.size >= max) sweep();
      m.set(k, { val, exp: ttl ? Date.now() + ttl * 1000 : 0 });
    },
    async delete(k) { m.delete(k); },
  };
}

/** Cloudflare KV adapter. KV needs expirationTtl >= 60 seconds. */
export function kvStore(kv) {
  return {
    get: (k) => kv.get(k),
    put: (k, val, { ttl } = {}) => kv.put(k, val, ttl ? { expirationTtl: Math.max(60, Math.ceil(ttl)) } : undefined),
    delete: (k) => kv.delete(k),
  };
}

/**
 * Best-effort lock: true when this caller took it. Not atomic across isolates
 * with KV (eventually consistent); the on-chain EIP-3009 nonce is the hard guard.
 */
export async function takeLock(store, key, ttlSeconds) {
  if (await store.get(key)) return false;
  await store.put(key, "1", { ttl: ttlSeconds });
  return true;
}

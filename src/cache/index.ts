import { policyFor } from './registry';
import { CacheStorage } from './types';

export { registerCacheNamespace } from './registry';
export type { CacheStorage, CacheRow, CacheResolver, NamespacePolicy, JettonWalletData } from './types';

// cache-or-lookup core. jiti owns the orchestration — in-process L1, single-flight, negative
// caching, TTL/immutability, read-through/write-through — and the per-namespace resolvers.
// The consumer injects only durable storage (see createPostgresCacheStorage for a ready-made
// Postgres adapter). With no storage available, callers simply don't invoke cacheGet.

const L1_MAX = 50_000;
type L1Entry = { value: unknown; expiresAt: number | null };
const L1 = new Map<string, L1Entry>();

function l1Get(id: string): L1Entry | undefined {
  const e = L1.get(id);
  if (!e) {
    return undefined;
  }
  if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
    L1.delete(id);
    return undefined;
  }
  L1.delete(id);
  L1.set(id, e); // bump recency
  return e;
}

function l1Set(id: string, value: unknown, expiresAt: number | null): void {
  if (L1.size >= L1_MAX) {
    const oldest = L1.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      L1.delete(oldest);
    }
  }
  L1.set(id, { value, expiresAt });
}

const inflight = new Map<string, Promise<unknown | null>>();

function cacheId(namespace: string, key: string): string {
  return `${namespace} ${key}`;
}

/**
 * Read an enrichment value for (namespace, key) against the injected storage. On a miss, if
 * the namespace has a registered resolver, resolve + write-through; otherwise return null
 * (externally-populated namespaces). Returns null for negative hits; a resolver that throws
 * (transient, e.g. RPC) is NOT cached so it retries next time.
 */
export async function cacheGet(storage: CacheStorage, namespace: string, key: string): Promise<unknown | null> {
  const id = cacheId(namespace, key);

  const l1 = l1Get(id);
  if (l1) {
    return l1.value;
  }
  const existing = inflight.get(id);
  if (existing !== undefined) {
    return existing;
  }

  const p = (async (): Promise<unknown | null> => {
    const row = await storage.get(namespace, key);
    if (row && (row.expiresAt === null || row.expiresAt > Date.now())) {
      const value = row.found ? row.value : null;
      l1Set(id, value, row.expiresAt);
      return value;
    }

    const policy = policyFor(namespace);
    if (!policy.resolve) {
      return null; // externally-populated namespace: miss ⇒ null (no write)
    }

    let resolved: unknown | null = null;
    try {
      resolved = await policy.resolve(key);
    } catch {
      // Transient resolver failure (e.g. RPC) — do NOT cache so it retries next time.
      return null;
    }

    const found = resolved !== null && resolved !== undefined;
    const negativeTtl = policy.negativeTtlSeconds ?? 3600;
    if (!found && negativeTtl === 0) {
      return null; // negative caching disabled for this namespace
    }

    const ttlSeconds = found ? policy.ttlSeconds : negativeTtl;
    const expiresAt = ttlSeconds === null || ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;

    await storage.set(namespace, key, { value: found ? resolved : null, found, expiresAt });
    l1Set(id, found ? resolved : null, expiresAt);
    return found ? resolved : null;
  })().finally(() => inflight.delete(id));

  inflight.set(id, p);
  return p;
}

/**
 * Write an enrichment value out-of-band (for externally-populated namespaces like token-price
 * / wallet-label, or to pre-seed a row). TTL comes from the namespace policy unless overridden.
 */
export async function cacheSet(
  storage: CacheStorage,
  namespace: string,
  key: string,
  value: unknown,
  ttlSecondsOverride?: number | null
): Promise<void> {
  const policy = policyFor(namespace);
  const ttlSeconds = ttlSecondsOverride !== undefined ? ttlSecondsOverride : policy.ttlSeconds;
  const expiresAt = ttlSeconds === null || ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
  await storage.set(namespace, key, { value, found: true, expiresAt });
  l1Set(cacheId(namespace, key), value, expiresAt);
}

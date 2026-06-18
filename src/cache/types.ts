// A generic "cache-or-lookup" enrichment layer for jiti templates. jiti owns the cache
// orchestration (in-process L1, single-flight, negative caching, TTL/immutability) AND the
// per-namespace resolvers (e.g. the TON jetton get_wallet_data RPC). The ONLY thing a
// consumer injects is durable storage — a thin key/value adapter (Postgres in the indexer,
// the same contract in NBD). jiti has no DB dependency; the engine owns the connection.

export type CacheRow = {
  value: unknown | null;
  found: boolean;
  expiresAt: number | null; // epoch ms; null = immutable / never expires
};

// Durable L2 store, injected by the consumer. A dumb key/value adapter — jiti owns expiry
// and negative-cache semantics, so `get` returns whatever was stored (jiti decides validity).
export type CacheStorage = {
  get: (namespace: string, key: string) => Promise<CacheRow | null>;
  set: (namespace: string, key: string, row: CacheRow) => Promise<void>;
};

// Resolves a miss for a namespace. Returns the value, or null for a definitive miss
// (negative-cached). Throw on a transient failure (e.g. RPC) so it is NOT cached and retries.
export type CacheResolver = (key: string) => Promise<unknown | null>;

export type NamespacePolicy = {
  resolve?: CacheResolver; // absent ⇒ externally-populated (miss ⇒ null, no write)
  ttlSeconds?: number | null; // null/undefined ⇒ immutable
  negativeTtlSeconds?: number; // default 3600; 0 ⇒ don't cache misses
};

export type JettonWalletData = { owner: string; master: string };

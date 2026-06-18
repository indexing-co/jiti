import { NamespacePolicy } from './types';

// Per-namespace policy registry. Namespaces differ only here: immutable vs TTL
// (`ttlSeconds`), and resolve-on-miss vs externally-populated (presence of `resolve`).
// jiti registers the namespaces it can resolve itself (e.g. ton-jetton-wallet); a consumer
// may register its own (e.g. token-price with no resolver, populated via cacheSet).

const REGISTRY = new Map<string, NamespacePolicy>();

export function registerCacheNamespace(namespace: string, policy: NamespacePolicy): void {
  REGISTRY.set(namespace, policy);
}

export function policyFor(namespace: string): NamespacePolicy {
  return REGISTRY.get(namespace) ?? {};
}

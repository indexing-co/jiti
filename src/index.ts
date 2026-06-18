import * as allUtils from './utils';
import * as allTemplates from './templates';

export * from './types';
export * from './types/beats';
export type { NetworkTransfer } from './templates/token-transfers/types';
export const utils = { ...allUtils };
export const templates = { ...allTemplates };

// cache-or-lookup enrichment layer (jiti owns the cache + resolvers; consumer injects storage)
export { cacheGet, cacheSet, registerCacheNamespace } from './cache';
export { createPostgresCacheStorage } from './cache/storage/postgres';
export {
  lookupJettonWallet,
  resolveJettonWalletData,
  setTonRpcHosts,
  TON_JETTON_NAMESPACE,
} from './cache/resolvers/ton-jetton';
export type { CacheStorage, CacheRow, CacheResolver, NamespacePolicy, JettonWalletData } from './cache/types';

export function getAllTemplates() {
  return Object.values(allTemplates).slice();
}

export function getTemplateByKey(key: string) {
  return templates[key];
}

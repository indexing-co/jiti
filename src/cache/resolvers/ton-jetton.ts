import { Address, Cell } from '@ton/core';

import { cacheGet } from '../index';
import { registerCacheNamespace } from '../registry';
import { CacheStorage, JettonWalletData } from '../types';

// Resolves a TON jetton wallet → { owner, master } via the standard `get_wallet_data`
// get-method (TEP-74). The mapping is immutable, so it's cached forever. This is what lets
// the token-transfers template enrich TON jetton transfers (jiti emits `to` = the jetton
// wallet, `token` = undefined) into the real owner + master, at most one RPC per wallet ever.
//
// Fronted on the free, unthrottled Orbs TON Access gateway — the healthy node set is resolved
// at runtime and rotated across on the intermittent liteserver timeouts they return. This is
// the one place jiti performs network RPC, and only on the enrichment path.

export const TON_JETTON_NAMESPACE = 'ton-jetton-wallet';

const ORBS_MANAGER_URL = 'https://ton.access.orbs.network/mngr/nodes';
const ORBS_REFRESH_MS = 5 * 60 * 1000;

let orbsHosts: string[] = [];
let orbsRefreshedAt = 0;

// Consumer-injected TON RPC hosts (toncenter v2 jsonRPC-compatible base hosts). When set, the
// resolver uses THESE instead of Orbs discovery — e.g. the indexer injects oscar's configured
// TON hosts (BlockPi/QuickNode from network_connections) so jiti hits the same hosts oscar uses
// and avoids Orbs's per-IP rate limit on the oscar box. Empty ⇒ fall back to Orbs discovery.
let configuredHosts: string[] = [];

export function setTonRpcHosts(hosts: string[]): void {
  configuredHosts = (hosts || []).filter(Boolean);
}

type OrbsNode = { NodeId: string; Healthy: string; Mngr?: { health?: Record<string, boolean> } };

function shuffled(hosts: string[]): string[] {
  const a = [...hosts];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// toncenter v2 speaks JSON-RPC at `<host>/jsonRPC`. Orbs hosts already end in it; BlockPi-style
// base hosts (…/rpc/<key>) need it appended — mirrors oscar's TON buildUrl.
function buildUrl(host: string): string {
  return host.endsWith('/jsonRPC') ? host : `${host.replace(/\/$/, '')}/jsonRPC`;
}

async function getHosts(): Promise<string[]> {
  if (configuredHosts.length) {
    return shuffled(configuredHosts).map(buildUrl);
  }
  if (orbsHosts.length && Date.now() - orbsRefreshedAt < ORBS_REFRESH_MS) {
    return shuffled(orbsHosts);
  }
  try {
    const resp = await fetch(ORBS_MANAGER_URL, { signal: AbortSignal.timeout(8000) });
    const nodes = (await resp.json()) as OrbsNode[];
    const healthy = nodes
      .filter((n) => n.Healthy === '1' && n.Mngr?.health?.['v2-mainnet'])
      .map((n) => `https://ton.access.orbs.network/${n.NodeId}/1/mainnet/toncenter-api-v2/jsonRPC`);
    if (healthy.length) {
      orbsHosts = healthy;
      orbsRefreshedAt = Date.now();
    }
  } catch {
    // keep prior cached set
  }
  return shuffled(orbsHosts);
}

// Canonicalize to jiti's emitted form (bounceable, url-safe, mainnet) so a TON address
// compares equal to the one the token-transfer template emits. Input returned as-is if unparseable.
export function normalizeTonAddress(addr: string): string {
  try {
    return Address.parse(addr).toString({ urlSafe: true, bounceable: true, testOnly: false });
  } catch {
    return addr;
  }
}

function parseAddressFromStackEntry(entry: unknown): string | null {
  // toncenter v2 runGetMethod returns slice/cell results as ['cell', { bytes: <base64 BoC> }].
  const value = (entry as [string, { bytes?: string } | string])?.[1];
  const b64 = typeof value === 'string' ? value : value?.bytes;
  if (!b64) {
    return null;
  }
  return normalizeTonAddress(Cell.fromBase64(b64).beginParse().loadAddress().toString());
}

async function runGetMethod(
  host: string,
  address: string,
  method: string,
  stack: unknown[]
): Promise<{ exitCode: number; stack: unknown[] }> {
  const resp = await fetch(host, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runGetMethod', params: { address, method, stack } }),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await resp.json()) as { ok: boolean; error?: string; result?: { exit_code: number; stack: unknown[] } };
  if (!json.ok || !json.result) {
    throw new Error(`TON runGetMethod ${method} error: ${json.error || 'unknown'}`);
  }
  return { exitCode: json.result.exit_code, stack: json.result.stack };
}

/**
 * Resolve a jetton wallet to its { owner, master }. Returns null if the account isn't a jetton
 * wallet (definitive miss → negative-cached). Throws on transient RPC failure so the cache layer
 * does NOT cache it (retries next time).
 */
export async function resolveJettonWalletData(wallet: string): Promise<JettonWalletData | null> {
  const hosts = await getHosts();
  if (!hosts.length) {
    throw new Error('TON: no Orbs hosts available for get_wallet_data');
  }

  let sawDefiniteMiss = false;
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of hosts) {
      try {
        const { exitCode, stack } = await runGetMethod(host, wallet, 'get_wallet_data', []);
        if (exitCode !== 0) {
          sawDefiniteMiss = true; // no get_wallet_data → not a jetton wallet
          continue;
        }
        const owner = parseAddressFromStackEntry(stack[1]);
        const master = parseAddressFromStackEntry(stack[2]);
        if (owner && master) {
          return { owner, master };
        }
        sawDefiniteMiss = true;
      } catch (e) {
        lastErr = e as Error;
      }
    }
  }

  if (sawDefiniteMiss) {
    return null; // definitive: not a jetton wallet → negative-cache
  }
  throw new Error(`TON: get_wallet_data failed for ${wallet}: ${lastErr?.message}`); // transient → don't cache
}

/** Enrich a TON jetton wallet (any address form) → { owner, master } via the cache. */
export async function lookupJettonWallet(storage: CacheStorage, wallet: string): Promise<JettonWalletData | null> {
  return (await cacheGet(storage, TON_JETTON_NAMESPACE, normalizeTonAddress(wallet))) as JettonWalletData | null;
}

// Register on import: immutable mapping, resolve-on-miss via get_wallet_data; non-jetton
// accounts negative-cached for a day.
registerCacheNamespace(TON_JETTON_NAMESPACE, {
  resolve: (key) => resolveJettonWalletData(key),
  ttlSeconds: null,
  negativeTtlSeconds: 86400,
});

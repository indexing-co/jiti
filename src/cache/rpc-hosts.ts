// Per-network RPC host registry. A jiti consumer injects the hosts a resolver should use for a
// given chain — e.g. the indexer points the TON jetton resolver at the same hosts oscar uses
// (BlockPi/QuickNode from network_connections) so jiti avoids Orbs's per-IP rate limit on the
// oscar box. Generic so future resolvers (other chains) reuse it. Empty for a network ⇒ the
// resolver falls back to its built-in default (e.g. Orbs discovery for TON).

const rpcHostsByNetwork = new Map<string, string[]>();

export function setRpcHosts(network: string, hosts: string[]): void {
  rpcHostsByNetwork.set(network.toUpperCase(), (hosts || []).filter(Boolean));
}

export function getRpcHosts(network: string): string[] {
  return rpcHostsByNetwork.get(network.toUpperCase()) ?? [];
}

import _fetch from 'isomorphic-fetch';

export function tokenPrice(tokenAddress: string, opts?: { network?: string; timestamp?: string }) {
  let url = `https://jiti.indexing.co/presets/token-price/${opts?.network || 'ethereum'}?tokenAddress=${tokenAddress}`;
  if (opts?.timestamp) {
    url += '&priceTimestamp=' + new Date(opts.timestamp).toISOString();
  }

  return _fetch(url)
    .then((r) => r.json())
    .then((r) => r.data);
}

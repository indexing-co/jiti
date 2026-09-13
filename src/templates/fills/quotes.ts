// Quote tokens per network: what a fill is priced in rather than what is being traded. Everything else that moves
// in a wallet is a base token. NATIVE (the chain's gas token, as token-transfers reports it) is always a quote.
// Extend per network as chains are onboarded; callers can also pass `quoteTokens`.
export const NATIVE_TOKEN = 'native';

export const QUOTE_TOKENS: Record<string, string[]> = {
  ROBINHOOD: [
    '0x0bd7d308f8e1639fab988df18a8011f41eacad73', // WETH (aeWETH)
    '0x5fc5360d0400a0fd4f2af552add042d716f1d168', // USDG
  ],
};

export function quoteTokensFor(network: string | undefined, extra: string[] = []): Set<string> {
  return new Set(
    [NATIVE_TOKEN, ...(QUOTE_TOKENS[(network || '').toUpperCase()] || []), ...extra].map((t) => t.toLowerCase())
  );
}

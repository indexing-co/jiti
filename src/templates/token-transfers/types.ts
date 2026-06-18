export type NetworkTransfer = {
  amount: number | bigint;
  // Number of decimal places `amount` is scaled by, when the source carries an arbitrary-precision
  // value with no fixed on-chain integer unit (e.g. XRPL issued currencies). The human value is
  // `amount / 10 ** decimals`. Omitted when the chain has a native fixed unit (EVM wei, XRP drops),
  // in which case the consumer applies token decimals out-of-band as before.
  decimals?: number;
  blockNumber: number;
  from: string;
  index?: string;
  memo?: string | number;
  timestamp: string;
  to: string;
  token?: string;
  tokenId?: string;
  tokenType: 'NATIVE' | 'TOKEN' | 'NFT';
  transactionGasFee: bigint;
  transactionHash: string;
};

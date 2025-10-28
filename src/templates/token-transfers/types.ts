export type NetworkTransfer = {
  amount: number | bigint;
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

export type NetworkTransfer = {
  amount: number | bigint;
  blockNumber: number;
  from: string;
  index?: string;
  memo?: string | number;
  timestamp: string;
  to: string;
  /**
   * Settling sub-accounts for chains where a token transfer lands on a
   * per-(owner, token) account rather than on the owner directly — the
   * Associated Token Account on Solana, the jetton wallet on TON. `from`/`to`
   * carry the owners; these carry the underlying accounts. Optional and only
   * populated where the chain has the concept (TON jetton transfers today).
   */
  fromTokenAccount?: string;
  toTokenAccount?: string;
  token?: string;
  tokenId?: string;
  tokenType: 'NATIVE' | 'TOKEN' | 'NFT';
  transactionGasFee: bigint;
  transactionHash: string;
};

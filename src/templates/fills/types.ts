export type FillCashLeg = {
  // The token paid (BUY) or received (SELL) for the fill, and its raw amount.
  token: string;
  amount: bigint;
  // Where the cash leg was read from:
  // - WALLET: the wallet's own balance moved in a quote token, opposite to the fill (a direct swap).
  // - RELAY_FILL: a Relay solver funded the route in this transaction and delivered the token to the wallet
  //   (the payment happened on the order's origin chain; `relayOrderId` joins it).
  // - RELAY_DEPOSIT: the wallet's proceeds were deposited to Relay in this transaction, bound for another chain.
  source: 'WALLET' | 'RELAY_FILL' | 'RELAY_DEPOSIT';
};

export type Fill = {
  blockNumber: number;
  timestamp: string;
  transactionHash: string;
  wallet: string;
  side: 'BUY' | 'SELL';
  // The non-quote token whose balance changed, and the absolute raw amount it changed by.
  token: string;
  amount: bigint;
  // True when the wallet authorized this transaction itself: it is tx.from, or the sender of an ERC-4337
  // UserOperation in it. A BUY that is not signed by the wallet and has no RELAY_FILL cash leg is a transfer
  // or airdrop into the wallet, not a trade the wallet placed.
  signedByWallet: boolean;
  cashLeg?: FillCashLeg;
  // Relay's order id for cross-chain settled fills. Joins to the origin-chain deposit, which names the payer.
  relayOrderId?: string;
};

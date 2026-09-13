// A Relay (relay.link) cross-chain order, as it shows up on one chain.
//
// An order is deposited on its origin chain and paid out on its destination chain, and both sides carry the same
// 32-byte order id. Joining the two across chains answers "who actually paid for this", which a destination chain
// alone can't: a solver's fill looks identical whoever funded it.
export type RelayOrderEvent = {
  // DEPOSIT: `address` funded the order on this chain. PAYOUT: `address` received the order's proceeds here.
  type: 'DEPOSIT' | 'PAYOUT';
  network: string;
  blockNumber: number;
  timestamp: string | null;
  transactionHash: string;
  // 0x-prefixed lowercase hex, identical on both chains of the order.
  orderId: string;
  // EVM addresses lowercase; Solana addresses base58 as-is.
  address: string;
  // 'native' for the chain's gas token; otherwise the ERC-20 address (lowercase) or SPL mint.
  token: string;
  amount: bigint;
};

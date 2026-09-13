// Event layout, not brand: forks that emit Uniswap's exact events (Slipstream, Ramses, Sushi, ...) report as Uniswap.
export type DexProtocol = 'UNISWAP_V2' | 'UNISWAP_V3' | 'UNISWAP_V4' | 'PANCAKE_V3';

type DexEventBase = {
  blockNumber: number;
  timestamp: string;
  transactionHash: string;
  transactionFrom: string;
  logIndex: number;
  protocol: DexProtocol;
  // The contract that emitted the log: the pool for v2/v3, the PoolManager for v4.
  emitter: string;
  // The pool: its address for v2/v3, its bytes32 PoolId for v4.
  pool: string;
};

export type DexSwap = DexEventBase & {
  type: 'SWAP';
  sender: string;
  // Absent for v4, whose Swap event has no recipient.
  recipient?: string;
  // Signed from the POOL's side on every protocol: positive = the pool received that token, negative = it paid out.
  // (v4 emits the swapper's side, v2 emits in/out pairs; both are normalized here.)
  amount0: bigint;
  amount1: bigint;
  // Pool state after the swap, where the protocol reports it (not v2).
  sqrtPriceX96?: bigint;
  liquidity?: bigint;
  tick?: number;
  // Fee in hundredths of a bip, where the event carries it (v4).
  fee?: number;
};

export type DexPoolCreated = DexEventBase & {
  type: 'POOL_CREATED';
  token0: string;
  token1: string;
  fee?: number;
  tickSpacing?: number;
  // v4 only: the hook contract attached to the pool (zero address when none).
  hooks?: string;
  // v4 only: initial price.
  sqrtPriceX96?: bigint;
};

export type DexEvent = DexSwap | DexPoolCreated;

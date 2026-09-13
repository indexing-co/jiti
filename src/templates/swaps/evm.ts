import { SubTemplate } from '../../types';
import { evmDecodeLogWithMetadata } from '../../utils';
import { blockToVM } from '../../utils/block-to-vm';
import type { EvmBlock } from '../../types/beats/evm';
import { DexEvent, DexProtocol } from './types';
import { EVM_SWAP_TESTS } from './evm.fixtures';

// Event shapes are identified by signature (topic0 + indexed-arg count), never by emitter address: forks
// (Slipstream, Ramses, Sushi, Algebra's v3-compatible pools, ...) reuse these exact events from their own factories. Whether an
// emitter is a genuine pool is a cross-block question (was it created by a known factory?) and belongs to
// the consumer's pool registry, which the POOL_CREATED events below feed.
const SIG = {
  V2_SWAP:
    'Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
  V3_SWAP:
    'Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  V4_SWAP:
    'Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  // PancakeSwap v3: the v3 layout plus the protocol fees taken in each token.
  PANCAKE_V3_SWAP:
    'Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint128 protocolFeesToken0, uint128 protocolFeesToken1)',
  V2_PAIR_CREATED: 'PairCreated(address indexed token0, address indexed token1, address pair, uint256 index)',
  V3_POOL_CREATED:
    'PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
  // Velodrome/Aerodrome Slipstream-style CL factories: tick spacing instead of fee.
  CL_POOL_CREATED:
    'PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)',
  V2_SYNC: 'Sync(uint112 reserve0, uint112 reserve1)',
  V2_MINT: 'Mint(address indexed sender, uint256 amount0, uint256 amount1)',
  V2_BURN: 'Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
  V3_MINT:
    'Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  V3_BURN:
    'Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  V4_MODIFY_LIQUIDITY:
    'ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
  V4_INITIALIZE:
    'Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
};

const lower = (v: unknown) => (v as string).toLowerCase();

export const EVMSwaps: SubTemplate = {
  match: (block) => blockToVM(block) === 'EVM',

  transform(block, _ctx) {
    const typedBlock = block as unknown as EvmBlock;
    const timestamp = new Date(typedBlock.timestamp * 1000).toISOString();
    const events: DexEvent[] = [];

    for (const tx of (typedBlock.transactions as any[]) || []) {
      // A reverted transaction's logs never happened.
      if (!tx.receipt || tx.receipt.status === 0 || tx.receipt.status === false) {
        continue;
      }

      for (const log of tx.receipt.logs || []) {
        if (!log.topics?.length) continue;

        const base = {
          blockNumber: typedBlock.number,
          timestamp,
          transactionHash: tx.hash,
          transactionFrom: lower(tx.from),
          logIndex: typeof log.logIndex === 'string' ? parseInt(log.logIndex) : log.logIndex,
          emitter: lower(log.address),
        };
        const at = (protocol: DexProtocol, pool: string) => ({ ...base, protocol, pool });

        const hit = evmDecodeLogWithMetadata(log, Object.values(SIG));
        if (!hit) continue;
        const d = hit.decoded;

        // Signatures sharing a name (the Swaps, PoolCreateds, Mints and Burns) are told apart by their fields.
        if (hit.metadata.name === 'Swap' && 'amount0In' in d) {
          events.push({
            ...at('UNISWAP_V2', base.emitter),
            type: 'SWAP',
            sender: lower(d.sender),
            recipient: lower(d.to),
            amount0: (d.amount0In as bigint) - (d.amount0Out as bigint),
            amount1: (d.amount1In as bigint) - (d.amount1Out as bigint),
          });
        } else if (hit.metadata.name === 'Swap' && 'id' in d) {
          events.push({
            ...at('UNISWAP_V4', lower(d.id)),
            type: 'SWAP',
            sender: lower(d.sender),
            amount0: -(d.amount0 as bigint),
            amount1: -(d.amount1 as bigint),
            sqrtPriceX96: d.sqrtPriceX96 as bigint,
            liquidity: d.liquidity as bigint,
            tick: Number(d.tick),
            fee: Number(d.fee),
          });
        } else if (hit.metadata.name === 'Swap') {
          // v3 and PancakeSwap v3 share every field this reports; Pancake adds protocol fees we don't surface.
          events.push({
            ...at('protocolFeesToken0' in d ? 'PANCAKE_V3' : 'UNISWAP_V3', base.emitter),
            type: 'SWAP',
            sender: lower(d.sender),
            recipient: lower(d.recipient),
            amount0: d.amount0 as bigint,
            amount1: d.amount1 as bigint,
            sqrtPriceX96: d.sqrtPriceX96 as bigint,
            liquidity: d.liquidity as bigint,
            tick: Number(d.tick),
          });
        } else if (hit.metadata.name === 'PairCreated') {
          events.push({
            ...at('UNISWAP_V2', lower(d.pair)),
            type: 'POOL_CREATED',
            token0: lower(d.token0),
            token1: lower(d.token1),
          });
        } else if (hit.metadata.name === 'PoolCreated') {
          events.push({
            ...at('UNISWAP_V3', lower(d.pool)),
            type: 'POOL_CREATED',
            token0: lower(d.token0),
            token1: lower(d.token1),
            ...('fee' in d ? { fee: Number(d.fee) } : {}),
            tickSpacing: Number(d.tickSpacing),
          });
        } else if (hit.metadata.name === 'Sync') {
          events.push({
            ...at('UNISWAP_V2', base.emitter),
            type: 'SYNC',
            reserve0: BigInt(d.reserve0 as bigint),
            reserve1: BigInt(d.reserve1 as bigint),
          });
        } else if ((hit.metadata.name === 'Mint' || hit.metadata.name === 'Burn') && !('amount' in d)) {
          events.push({
            ...at('UNISWAP_V2', base.emitter),
            type: 'LIQUIDITY',
            action: hit.metadata.name === 'Mint' ? 'ADD' : 'REMOVE',
            amount0: d.amount0 as bigint,
            amount1: d.amount1 as bigint,
            sender: lower(d.sender),
          });
        } else if (hit.metadata.name === 'Mint' || hit.metadata.name === 'Burn') {
          // A zero-liquidity v3 burn is a fee-collection poke, not a change in liquidity.
          if ((d.amount as bigint) === 0n) continue;
          const add = hit.metadata.name === 'Mint';
          events.push({
            ...at('UNISWAP_V3', base.emitter),
            type: 'LIQUIDITY',
            action: add ? 'ADD' : 'REMOVE',
            amount0: d.amount0 as bigint,
            amount1: d.amount1 as bigint,
            liquidityDelta: add ? (d.amount as bigint) : -(d.amount as bigint),
            sender: lower(add ? d.sender : d.owner),
          });
        } else if (hit.metadata.name === 'ModifyLiquidity') {
          const delta = d.liquidityDelta as bigint;
          if (delta === 0n) continue;
          events.push({
            ...at('UNISWAP_V4', lower(d.id)),
            type: 'LIQUIDITY',
            action: delta > 0n ? 'ADD' : 'REMOVE',
            liquidityDelta: delta,
            sender: lower(d.sender),
          });
        } else if (hit.metadata.name === 'Initialize') {
          events.push({
            ...at('UNISWAP_V4', lower(d.id)),
            type: 'POOL_CREATED',
            token0: lower(d.currency0),
            token1: lower(d.currency1),
            fee: Number(d.fee),
            tickSpacing: Number(d.tickSpacing),
            hooks: lower(d.hooks),
            sqrtPriceX96: d.sqrtPriceX96 as bigint,
          });
        }
      }
    }

    return events;
  },

  tests: EVM_SWAP_TESTS,
};

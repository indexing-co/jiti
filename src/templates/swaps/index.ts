import { Template } from '../../types';
import { EVMSwaps } from './evm';
import { DexEvent } from './types';

const SUB_TEMPLATES = [EVMSwaps];

const swapsTemplate: Template = {
  key: 'swaps',
  name: 'DEX Swaps',
  description:
    'Get every DEX swap, pool creation, liquidity change and v2 reserve sync in a block: Uniswap v2/v3/v4 (and forks that reuse their events) and PancakeSwap v3.',
  tags: ['EVM', 'DEX', 'SWAP', 'UNISWAP'],
  disabled: false,
  params: [
    { key: 'network', name: 'Network', type: 'NETWORK', optional: false },
    { key: 'pool', name: 'Pool (address, or v4 PoolId)', type: 'STRING', optional: true },
    { key: 'walletAddress', name: 'Wallet Address (sender, recipient or tx sender)', type: 'ADDRESS', optional: true },
    {
      key: 'types',
      name: 'Event Types',
      type: 'STRING',
      multiple: true,
      optional: true,
      values: ['SWAP', 'POOL_CREATED', 'LIQUIDITY', 'SYNC'],
    },
  ],

  transform: (block, _ctx = { params: {} }) => {
    let events: DexEvent[] = [];
    for (const sub of SUB_TEMPLATES) {
      if (sub.match(block)) {
        events = sub.transform(block, _ctx) as DexEvent[];
        break;
      }
    }

    const params = _ctx?.params || {};
    const pool = (params.pool as string | undefined)?.toLowerCase();
    const wallet = (params.walletAddress as string | undefined)?.toLowerCase();
    const types = params.types as DexEvent['type'][] | undefined;

    return events.filter((e) => {
      if (types?.length && !types.includes(e.type)) return false;
      if (pool && e.pool !== pool) return false;
      if (wallet) {
        const parties =
          e.type === 'SWAP'
            ? [e.sender, e.recipient, e.transactionFrom]
            : e.type === 'LIQUIDITY'
              ? [e.sender, e.transactionFrom]
              : [e.transactionFrom];
        if (!parties.includes(wallet)) return false;
      }
      return true;
    });
  },

  tests: SUB_TEMPLATES.map((v) => v.tests).flat(),
};

export default swapsTemplate;

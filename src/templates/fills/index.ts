import { Template } from '../../types';
import { EVMFills } from './evm';
import { Fill } from './types';

const SUB_TEMPLATES = [EVMFills];

const fillsTemplate: Template = {
  key: 'fills',
  name: 'Wallet Fills',
  description:
    'Get every buy and sell a wallet made in a block, read from its balance changes, with the cash leg where the block shows it (direct swaps and Relay cross-chain fills).',
  tags: ['EVM', 'DEX', 'TRADES', 'WALLET'],
  disabled: false,
  params: [
    { key: 'network', name: 'Network', type: 'NETWORK', optional: false },
    { key: 'walletAddress', name: 'Wallet Addresses', type: 'ADDRESS', multiple: true, optional: true },
    { key: 'quoteTokens', name: 'Extra Quote Tokens', type: 'ADDRESS', multiple: true, optional: true },
  ],

  transform: (block, _ctx = { params: {} }) => {
    for (const sub of SUB_TEMPLATES) {
      if (sub.match(block)) return sub.transform(block, _ctx) as Fill[];
    }
    return [] as Fill[];
  },

  tests: SUB_TEMPLATES.map((v) => v.tests).flat(),
};

export default fillsTemplate;

import { Template } from '../types';

const allBlocks: Template = {
  key: 'allBlocks',
  name: 'All Blocks',
  description: 'Get all blocks with all available fields',
  tags: ['EVM', 'TRANSACTIONS'],
  disabled: false,
  params: [],
  transform: (payload) => payload,
};

export default allBlocks;

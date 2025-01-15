import { Template } from '../types';

const rawTemplate: Template = {
  key: 'raw',
  name: 'Raw Block Data',
  description: 'Get all blocks with all available fields',
  tags: ['EVM', 'RAW'],
  disabled: false,
  params: [],
  transform: (payload) => payload,
  tests: [
    {
      params: {},
      payload: { a: 'b', c: 1, d: { e: true } },
      output: { a: 'b', c: 1, d: { e: true } },
    },
  ],
};

export default rawTemplate;

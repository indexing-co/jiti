import { Template } from '../../types';

import { AptosTokenTransfers } from './aptos';
import { CardanoTokenTransfers } from './cardano';
import { CosmosTokenTransfers } from './cosmos';
import { EVMTokenTransfers } from './evm';
import { FilecoinTokenTransfers } from './filecoin';
import { NetworkTransfer } from './types';
import { RippleTokenTransfers } from './ripple';
import { SUITokenTransfers } from './sui';
import { SVMTokenTransfers } from './svm';
import { StarknetTokenTransfers } from './starknet';
import { StellarTokenTransfers } from './stellar';
import { SubstrateTokenTransfers } from './substrate';
import { TONTokenTransfers } from './ton';
import { UTXOTokenTransfers } from './utxo';

const SUB_TEMPLATES = [
  AptosTokenTransfers,
  CardanoTokenTransfers,
  FilecoinTokenTransfers,
  RippleTokenTransfers,
  SVMTokenTransfers,
  StarknetTokenTransfers,
  StellarTokenTransfers,
  SubstrateTokenTransfers,
  SUITokenTransfers,
  TONTokenTransfers,
  UTXOTokenTransfers,
];

const UNIVERSAL_SUB_TEMPLATES = [CosmosTokenTransfers, EVMTokenTransfers];

const tokenTransfersTemplate: Template = {
  key: 'token_transfers',
  name: 'Token Transfers',
  description: 'Get all token transfers for a set of token types.',
  tags: ['EVM', 'ERC20', 'ERC721', 'NFT', 'TOKEN'],
  disabled: false,
  params: [
    { key: 'network', name: 'Network', type: 'NETWORK', optional: false },
    { key: 'contractAddress', name: 'Contract Address', type: 'ADDRESS', optional: true },
    { key: 'walletAddress', name: 'Wallet Address', type: 'ADDRESS', optional: true },
    {
      key: 'tokenTypes',
      name: 'Token Types',
      type: 'STRING',
      multiple: true,
      optional: true,
      values: ['NATIVE', 'TOKEN', 'NFT'],
    },
  ],

  transform: (block, _ctx = { params: {} }) => {
    let transfers: NetworkTransfer[] = [];

    for (const sub of SUB_TEMPLATES.concat(UNIVERSAL_SUB_TEMPLATES)) {
      if (sub.match(block)) {
        transfers = sub.transform(block, _ctx) as NetworkTransfer[];
        break;
      }
    }

    const seenTransfers = new Set<string>();

    transfers = transfers.filter((txfer) => {
      if (txfer.amount <= BigInt(0)) {
        return false;
      }
      if (_ctx?.params) {
        if (_ctx.params.contractAddress && _ctx.params.contractAddress !== txfer.token) {
          return false;
        }
        if (_ctx.params.walletAddress && ![txfer.from, txfer.to].includes(_ctx.params.walletAddress as string)) {
          return false;
        }
      }

      const key = `${txfer.transactionHash}-${txfer.from}-${txfer.to}-${txfer.amount}-${txfer.token}`;

      if (seenTransfers.has(key)) {
        return false;
      }

      seenTransfers.add(key);

      return true;
    });

    return transfers;
  },

  tests: SUB_TEMPLATES.concat(UNIVERSAL_SUB_TEMPLATES)
    .map((v) => v.tests)
    .flat(),
};

export default tokenTransfersTemplate;

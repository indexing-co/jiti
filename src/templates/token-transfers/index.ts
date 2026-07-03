import { Template } from '../../types';

import { AptosTokenTransfers } from './aptos';
import { CardanoTokenTransfers } from './cardano';
import { CosmosTokenTransfers } from './cosmos';
import { EVMTokenTransfers } from './evm';
import { FilecoinTokenTransfers } from './filecoin';
import { NetworkTransfer } from './types';
import { CacheStorage } from '../../cache/types';
import { lookupJettonWallet } from '../../cache/resolvers/ton-jetton';
import { RippleTokenTransfers } from './ripple';
import { SUITokenTransfers } from './sui';
import { SVMTokenTransfers } from './svm';
import { StarknetTokenTransfers } from './starknet';
import { StellarTokenTransfers } from './stellar';
import { SubstrateTokenTransfers } from './substrate';
import { TONTokenTransfers } from './ton';
import { TRONTokenTransfers } from './tron';
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
  TRONTokenTransfers,
  UTXOTokenTransfers,
];

const UNIVERSAL_SUB_TEMPLATES = [CosmosTokenTransfers, EVMTokenTransfers];

// Drops zero-amount + duplicate transfers and applies the optional contractAddress /
// walletAddress / transactionHash param filters. Runs AFTER any jetton enrichment so the
// filters see the resolved owner/master.
function applyTransferFilters(
  transfers: NetworkTransfer[],
  _ctx?: Record<string, unknown> & { params: Record<string, unknown> }
): NetworkTransfer[] {
  const seenTransfers = new Set<string>();

  return transfers.filter((txfer) => {
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
      if (_ctx.params.transactionHash && txfer.transactionHash !== _ctx.params.transactionHash) {
        return false;
      }
    }

    const key = `${txfer.transactionHash}-${txfer.from}-${txfer.to}-${txfer.amount}-${txfer.token}-${txfer.index}`;

    if (seenTransfers.has(key)) {
      return false;
    }

    seenTransfers.add(key);

    return true;
  });
}

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

    // Optional enrichment for account-model token transfers (TON jettons) where the block
    // only carries the token-WALLET address and no master: they come out as
    // `tokenType: 'TOKEN'`, `to` = wallet, `token` = undefined. When the caller injects a
    // `_ctx.cacheStorage` (durable cache), jiti resolves the wallet → { owner, master } via
    // its own cache+RPC and rewrites `to`/`token` BEFORE filtering, so contractAddress /
    // walletAddress filters match the real owner + master. jiti owns the cache + resolver
    // (get_wallet_data over Orbs); the consumer injects only storage. Async only when storage
    // is provided; the sync path is unchanged for every existing caller.
    const cacheStorage = _ctx?.cacheStorage as CacheStorage | undefined;
    if (cacheStorage) {
      return (async () => {
        await Promise.all(
          transfers.map(async (txfer) => {
            if (txfer.tokenType !== 'TOKEN' || txfer.token || !txfer.to) {
              return;
            }
            const info = await lookupJettonWallet(cacheStorage, txfer.to);
            if (info) {
              txfer.to = info.owner;
              txfer.token = info.master;
            }
          })
        );
        return applyTransferFilters(transfers, _ctx);
      })();
    }

    return applyTransferFilters(transfers, _ctx);
  },

  tests: SUB_TEMPLATES.concat(UNIVERSAL_SUB_TEMPLATES)
    .map((v) => v.tests)
    .flat(),
};

export default tokenTransfersTemplate;

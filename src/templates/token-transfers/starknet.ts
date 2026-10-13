import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { starknetNormalizeAddress } from '../../utils/starknet-normalize-address';
import { NetworkTransfer } from './types';
import type { StarknetBlock, StarknetBlockTransactionsReceiptEvents } from '../../types/beats/starknet';

// sn_keccak('Transfer')
const TRANSFER_SELECTOR = '0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9';

/**
 * Reads an ERC-20 `Transfer` event in either of the two layouts tokens emit on Starknet:
 *
 * - legacy (Cairo 0 / un-keyed): keys = [selector],             data = [from, to, amount.low, amount.high]
 * - keyed  (Cairo 1 / OZ):       keys = [selector, from, to],   data = [amount.low, amount.high]
 *
 * The amount is a u256 split into two 128-bit felts. ERC-721 transfers in the keyed layout carry the token
 * id in keys and leave data empty, so they do not match either shape and are skipped.
 */
function decodeTransfer(event: StarknetBlockTransactionsReceiptEvents) {
  const keys = event.keys || [];
  const data = event.data || [];
  if (keys[0] !== TRANSFER_SELECTOR) {
    return null;
  }

  let from: string, to: string, low: string, high: string | undefined;
  if (keys.length === 1 && data.length >= 3) {
    [from, to, low, high] = data;
  } else if (keys.length === 3 && data.length >= 1) {
    [, from, to] = keys;
    [low, high] = data;
  } else {
    return null;
  }

  return {
    from: starknetNormalizeAddress(from),
    to: starknetNormalizeAddress(to),
    amount: BigInt(low) + (high ? BigInt(high) << BigInt(128) : BigInt(0)),
  };
}

// Every Starknet asset, STRK and ETH included, is an ERC-20 contract: the token is always the emitting
// contract, so there is no NATIVE transfer on this chain.
export const StarknetTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'STARKNET',

  transform(block) {
    const transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as StarknetBlock;

    if (!Array.isArray(typedBlock.transactions)) {
      return [];
    }

    const timestamp = typedBlock.timestamp ? new Date(typedBlock.timestamp * 1000).toISOString() : null;

    for (const typedTx of typedBlock.transactions || []) {
      let transactionGasFee = BigInt(0);
      if (typedTx?.receipt?.actual_fee?.amount) {
        transactionGasFee = BigInt(typedTx.receipt.actual_fee.amount);
      }

      const transactionHash = typedTx.transaction_hash;

      if (!typedTx.receipt?.events) {
        continue;
      }

      for (const event of typedTx.receipt.events) {
        const decoded = decodeTransfer(event);
        if (!decoded) {
          continue;
        }

        transfers.push({
          amount: decoded.amount,
          blockNumber: typedBlock.block_number,
          from: decoded.from,
          timestamp,
          to: decoded.to,
          token: starknetNormalizeAddress(event.from_address),
          tokenType: 'TOKEN',
          transactionGasFee,
          transactionHash,
        });
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'STARKNET',
        walletAddress: '0x309e6b209031362268d62d646a067365e6f6d6eb7f571b5212cbdfd5f26fe54',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/starknet/1149460',
      output: [
        {
          amount: 0x1c286f74458fc6n,
          blockNumber: 1149460,
          from: '0x0309e6b209031362268d62d646a067365e6f6d6eb7f571b5212cbdfd5f26fe54',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x01176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8',
          token: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
          tokenType: 'TOKEN',
          transactionGasFee: 7925758505095110n,
          transactionHash: '0x707203dba31f442ae9a5477e6a8906f3676effa0f1d3bb19cbbc14e1ddfe21',
        },
      ],
    },
    // The tx from the Mesh report: a token transfer and an ETH fee leg, both previously labelled NATIVE / STRK.
    {
      params: {
        network: 'STARKNET',
        transactionHash: '0x2f0afed7c024be14d870af68cf7249b2cd94c7bbf0c8a7e7d01680e6c27175d',
      },
      payload: 'https://jiti.indexing.co/networks/starknet/1149460',
      output: [
        {
          amount: 5000000000000000000n,
          blockNumber: 1149460,
          from: '0x03fae44b9dd6fc698175d92a85024240b8b66ae211389ba4804c251e93d7cee0',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x04505a9f06f2bd639b6601f37a4dc0908bb70e8e0e0c34b1220827d64f4fc066',
          token: '0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87',
          tokenType: 'TOKEN',
          transactionGasFee: 2259364301899n,
          transactionHash: '0x2f0afed7c024be14d870af68cf7249b2cd94c7bbf0c8a7e7d01680e6c27175d',
        },
        {
          amount: 5022488444094804008n,
          blockNumber: 1149460,
          from: '0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x04505a9f06f2bd639b6601f37a4dc0908bb70e8e0e0c34b1220827d64f4fc066',
          token: '0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87',
          tokenType: 'TOKEN',
          transactionGasFee: 2259364301899n,
          transactionHash: '0x2f0afed7c024be14d870af68cf7249b2cd94c7bbf0c8a7e7d01680e6c27175d',
        },
        {
          amount: 5000000000000000000n,
          blockNumber: 1149460,
          from: '0x04505a9f06f2bd639b6601f37a4dc0908bb70e8e0e0c34b1220827d64f4fc066',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b',
          token: '0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87',
          tokenType: 'TOKEN',
          transactionGasFee: 2259364301899n,
          transactionHash: '0x2f0afed7c024be14d870af68cf7249b2cd94c7bbf0c8a7e7d01680e6c27175d',
        },
        {
          amount: 5022488444094804008n,
          blockNumber: 1149460,
          from: '0x04505a9f06f2bd639b6601f37a4dc0908bb70e8e0e0c34b1220827d64f4fc066',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x03fae44b9dd6fc698175d92a85024240b8b66ae211389ba4804c251e93d7cee0',
          token: '0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87',
          tokenType: 'TOKEN',
          transactionGasFee: 2259364301899n,
          transactionHash: '0x2f0afed7c024be14d870af68cf7249b2cd94c7bbf0c8a7e7d01680e6c27175d',
        },
        {
          amount: 2259364301899n,
          blockNumber: 1149460,
          from: '0x03fae44b9dd6fc698175d92a85024240b8b66ae211389ba4804c251e93d7cee0',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x01176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8',
          token: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
          tokenType: 'TOKEN',
          transactionGasFee: 2259364301899n,
          transactionHash: '0x2f0afed7c024be14d870af68cf7249b2cd94c7bbf0c8a7e7d01680e6c27175d',
        },
      ],
    },
    // Inline: the keyed (Cairo 1) layout, a u256 with a non-zero high half, stripped addresses on the way in,
    // and a keyed ERC-721 transfer (token id in keys, empty data) that must be skipped.
    {
      params: { network: 'STARKNET' },
      payload: {
        _network: 'STARKNET',
        block_number: 1,
        timestamp: 1739468212,
        transactions: [
          {
            transaction_hash: '0xabc',
            receipt: {
              actual_fee: { amount: '0x10', unit: 'FRI' },
              events: [
                {
                  from_address: '0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
                  keys: ['0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9', '0x1', '0x2'],
                  data: ['0x5', '0x1'],
                },
                {
                  from_address: '0x123',
                  keys: [
                    '0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9',
                    '0x1',
                    '0x2',
                    '0x7',
                    '0x0',
                  ],
                  data: [],
                },
              ],
            },
          },
        ],
      },
      output: [
        {
          amount: 0x100000000000000000000000000000005n,
          blockNumber: 1,
          from: '0x0000000000000000000000000000000000000000000000000000000000000001',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x0000000000000000000000000000000000000000000000000000000000000002',
          token: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0xabc',
        },
      ],
    },
  ],
};

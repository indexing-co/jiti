import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';

export const RippleTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'RIPPLE',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    if (!Array.isArray(block.transactions)) {
      return [];
    }

    for (const rawTx of block.transactions || []) {
      const typedTx = rawTx as {
        Account?: string;
        Amount?: string | { currency: string; issuer: string; value: string };
        Destination?: string;
        DestinationTag?: number;
        Fee?: string;
        hash?: string;
        TransactionType?: string;
        date?: number;
        metaData?: {
          delivered_amount?: string | { currency: string; issuer: string; value: string };
        };
      };
      if (typedTx.TransactionType !== 'Payment') {
        continue;
      }
      const deliveredOrAmount = typedTx.metaData?.delivered_amount ?? typedTx.Amount ?? '0';
      let tokenSymbol = 'XRP';
      let tokenType: 'NATIVE' | 'TOKEN' | 'NFT' = 'NATIVE';

      let parsedAmount: bigint;

      if (typeof deliveredOrAmount === 'object') {
        tokenSymbol = deliveredOrAmount.currency?.toUpperCase() ?? 'UNKNOWN';
        tokenType = 'TOKEN';
        const floatVal = parseFloat(deliveredOrAmount.value);
        const smallestUnit = Math.round(floatVal * 1_000_000);
        parsedAmount = BigInt(smallestUnit);
      } else {
        parsedAmount = BigInt(String(deliveredOrAmount));
      }
      transfers.push({
        amount: parsedAmount,
        blockNumber: parseInt(block.ledger_index as string, 10),
        from: typedTx.Account ?? 'UNKNOWN',
        memo: typedTx.DestinationTag,
        timestamp: block.close_time_iso ? (block.close_time_iso as string) : null,
        to: typedTx.Destination ?? 'UNKNOWN',
        token: tokenSymbol,
        tokenType: tokenType,
        transactionGasFee: BigInt(typedTx.Fee ?? '0'),
        transactionHash: typedTx.hash ?? '',
      });
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'RIPPLE',
        walletAddress: 'rnDGxzUM2snx58Bvyn72xhJKqvkDxo2tQm',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ripple/88104659',
      output: [
        {
          amount: 43110000n,
          blockNumber: 88104659,
          from: 'rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G',
          memo: 30195674,
          timestamp: '2024-05-19T22:18:52Z',
          to: 'rnDGxzUM2snx58Bvyn72xhJKqvkDxo2tQm',
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 10000n,
          transactionHash: 'B32A6A5455777283212407FBD8CCA701505C654E5F4ADFFBE9D4D22F00889D87',
        },
      ],
    },
  ],
};

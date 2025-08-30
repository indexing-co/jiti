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

    for (const rawTx of block.transactions) {
      const typedTx = rawTx as {
        Account?: string;
        Amount?: string | { currency: string; issuer: string; value: string };
        Destination?: string;
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
        walletAddress: 'rUUgoiJmjTPEbxfZ4RsS9pVS9Kv813Wpui',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ripple/88104659',
      output: [
        {
          amount: 238n,
          blockNumber: 88104659,
          from: 'rMAGnTv4eMWktZnhKa5cHcDiY84ZiKUaQm',
          timestamp: '2024-05-19T22:18:52Z',
          to: 'rUUgoiJmjTPEbxfZ4RsS9pVS9Kv813Wpui',
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 15n,
          transactionHash: '03564E6109261CDE73FCC5062C2A0A70F365CB1A0F9408C065B60EC3E94E4DBF',
        },
      ],
    },
  ],
};

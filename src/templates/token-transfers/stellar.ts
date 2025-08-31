import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';

export const StellarTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'STELLAR',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    for (const tx of (block.transactions as unknown[]) || []) {
      const typedTx = tx as {
        hash: string;
        created_at: string;
        fee_charged: string;
        operations: {
          type: string;
          from: string;
          to: string;
          amount: string;
          asset_type: string;
          asset_issuer: string;
        }[];
      };
      for (const op of typedTx.operations) {
        if (op.type === 'payment') {
          transfers.push({
            amount: BigInt(op.amount.replace('.', '')),
            blockNumber: block.sequence as number,
            from: op.from,
            timestamp: typedTx.created_at,
            to: op.to,
            token: op.asset_type === 'native' ? null : op.asset_issuer,
            tokenType: op.asset_type === 'native' ? 'NATIVE' : 'TOKEN',
            transactionGasFee: BigInt(typedTx.fee_charged),
            transactionHash: typedTx.hash,
          });
        }
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'STELLAR',
        walletAddress: 'GA5KLTNAWV27IOTBX5PKUOMVWFMLX4X7CPMQJ4QLR3G266MMVL7NMA4X',
        contractAddress: 'GC4Z2TDXU4GXVLHOS5P5SU6HKBCP7NKN4TJ5ZGTVRBW7MCBZTU7SNUSA',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/51720546',
      output: [
        {
          amount: 150000n,
          blockNumber: 51720546,
          from: 'GA5KLTNAWV27IOTBX5PKUOMVWFMLX4X7CPMQJ4QLR3G266MMVL7NMA4X',
          timestamp: '2024-05-18T04:41:39Z',
          to: 'GC4Z2TDXU4GXVLHOS5P5SU6HKBCP7NKN4TJ5ZGTVRBW7MCBZTU7SNUSA',
          token: 'GC4Z2TDXU4GXVLHOS5P5SU6HKBCP7NKN4TJ5ZGTVRBW7MCBZTU7SNUSA',
          tokenType: 'TOKEN',
          transactionGasFee: 100n,
          transactionHash: '4fb2441210cbe87f5003abdfa86f03bafa54f789ed041feccbda0bd054297c4d',
        },
      ],
    },
  ],
};

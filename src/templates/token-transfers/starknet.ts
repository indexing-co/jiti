import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { StarknetBlock } from '../../types/beats/starknet';

export const StarknetTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'STARKNET',

  transform(block) {
    let transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as StarknetBlock;

    if (!Array.isArray(typedBlock.transactions)) {
      return [];
    }

    for (const typedTx of typedBlock.transactions || []) {
      const timestamp = typedBlock.timestamp ? new Date(typedBlock.timestamp * 1000).toISOString() : null;

      let transactionGasFee = BigInt(0);
      if (typedTx?.receipt?.actual_fee?.amount) {
        transactionGasFee = BigInt(typedTx.receipt.actual_fee.amount);
      }

      const transactionHash = typedTx.transaction_hash;

      if (!typedTx.receipt?.events) {
        continue;
      }

      for (const event of typedTx.receipt.events) {
        if (!event.keys.includes('0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9')) {
          continue;
        }
        if (event.data.length < 3) {
          continue;
        }

        const [from, to, amountHex] = event.data;
        const amount = BigInt(amountHex);

        transfers.push({
          amount,
          blockNumber: typedBlock.block_number,
          from,
          timestamp,
          to,
          token: null,
          tokenType: 'NATIVE',
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
          from: '0x309e6b209031362268d62d646a067365e6f6d6eb7f571b5212cbdfd5f26fe54',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 7925758505095110n,
          transactionHash: '0x707203dba31f442ae9a5477e6a8906f3676effa0f1d3bb19cbbc14e1ddfe21',
        },
      ],
    },
  ],
};

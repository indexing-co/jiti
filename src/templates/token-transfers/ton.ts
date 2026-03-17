import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { TonBlock } from '../../types/beats/ton';

export const TONTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'TON',

  transform(block) {
    let transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as TonBlock;

    const blockNumber = typedBlock.seqno;
    const blockTimestamp = new Date(typedBlock.shards?.[0]?.gen_utime * 1000).toISOString();

    for (const shard of typedBlock.shards || []) {
      for (const tx of shard.transactions || []) {
        const transactionLT = tx.transaction_id.lt;
        const transactionHash = tx.transaction_id.hash;
        const transactionFee = BigInt(tx.fee || '0');

        const inVal = BigInt(tx.in_msg?.value || '0');
        if (inVal > 0n) {
          transfers.push({
            blockNumber,
            from: tx.in_msg?.source?.account_address,
            to: tx.address?.account_address,
            amount: inVal,
            token: 'TON',
            tokenType: 'NATIVE',
            timestamp: blockTimestamp,
            transactionHash,
            transactionGasFee: transactionFee,
          });
        }

        for (const outMsg of tx.out_msgs || []) {
          const outVal = BigInt(outMsg.value || '0');
          if (outVal > 0n) {
            transfers.push({
              blockNumber,
              from: outMsg.source?.account_address,
              to: outMsg.destination?.account_address,
              amount: outVal,
              token: 'TON',
              tokenType: 'NATIVE',
              timestamp: blockTimestamp,
              transactionHash,
              transactionGasFee: transactionFee,
            });
          }
        }
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'TON',
        walletAddress: 'EQAFukUyzmHjUvOYDOjNE-wbZFFl2FWas1rFJoh8IiTsWD40',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ton/44919328',
      output: [
        {
          blockNumber: 44919328,
          from: 'EQAFukUyzmHjUvOYDOjNE-wbZFFl2FWas1rFJoh8IiTsWD40',
          to: 'EQCFTFAHOU3vFt2NiZhRD5dwuS0k7GS59vIg3WfCKwfaQGW2',
          amount: 10000000n,
          token: 'TON',
          tokenType: 'NATIVE',
          timestamp: '2025-02-13T23:10:18.000Z',
          transactionHash: 'Vh5cWr2uvCsdhoouBQ+EiUcF54os9oqvh8A/62EroQc=',
          transactionGasFee: 2355233n,
        },
      ],
    },
  ],
};

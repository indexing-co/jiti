import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';

export const TONTokenTransfers: SubTemplate = {
  match: (block) => ['TON'].includes(block._network as string),

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const blockNumber = block.seqno as number;
    const blockTimestamp = new Date((block.shards?.[0]?.gen_utime as number) * 1000).toISOString();

    for (const shard of (block.shards as any[]) || []) {
      for (const tx of (shard.transactions as any[]) || []) {
        const transactionLT = tx.transaction_id.lt as string;
        const transactionHash = tx.transaction_id.hash as string;
        const transactionFee = BigInt((tx.fee as string) || '0');

        const inVal = BigInt((tx.in_msg?.value as string) || '0');
        if (inVal > 0n) {
          transfers.push({
            blockNumber,
            from: tx.in_msg?.source?.account_address as string,
            to: tx.address?.account_address as string,
            amount: inVal,
            token: 'TON',
            tokenType: 'NATIVE',
            timestamp: blockTimestamp,
            transactionHash,
            transactionGasFee: transactionFee,
          });
        }

        for (const outMsg of (tx.out_msgs as any[]) || []) {
          const outVal = BigInt((outMsg.value as string) || '0');
          if (outVal > 0n) {
            transfers.push({
              blockNumber,
              from: outMsg.source?.account_address as string,
              to: outMsg.destination?.account_address as string,
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

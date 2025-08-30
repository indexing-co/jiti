import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';

export const SubstrateTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'SUBSTRATE',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as {
      blockNumber: number;
      header: { number: string };
      extrinsics: {
        method: string;
        signer: string;
        args: any[];
        hash: string;
      }[];
    };

    const blockNumber = typedBlock.blockNumber;

    const timestampExtrinsic = typedBlock.extrinsics.find((ex) => ex.method === 'timestamp.set');
    const blockTimestamp = timestampExtrinsic
      ? new Date(Number(timestampExtrinsic.args[0].toString().replace(/,/g, ''))).toISOString()
      : new Date().toISOString();

    for (const extrinsic of typedBlock.extrinsics) {
      if (['balances.transfer', 'balances.transferKeepAlive'].includes(extrinsic.method)) {
        const from = extrinsic.signer;
        const to = (extrinsic.args[0] as { Id?: string })?.Id || '';
        const amount = BigInt((extrinsic.args[1] as string).replace(/,/g, ''));

        transfers.push({
          amount,
          blockNumber,
          from,
          to,
          token: null,
          tokenType: 'NATIVE',
          timestamp: blockTimestamp,
          transactionGasFee: 0n,
          transactionHash: extrinsic.hash,
        });
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'BITTENSOR',
        walletAddress: '5G6WmJ4mym9oSQzUF5tr7LvsNMvH5vWtutZM8vMvRv1Wwy6J',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/bittensor/2652896',
      output: [
        {
          amount: 2154999850n,
          blockNumber: 2652896,
          from: '5G6WmJ4mym9oSQzUF5tr7LvsNMvH5vWtutZM8vMvRv1Wwy6J',
          to: '5CFwmfLfL1Z6vXU6hgGksh6irDFpcVXaTTNRoqDGMyHrDKK1',
          token: null,
          tokenType: 'NATIVE',
          timestamp: '2024-03-28T12:53:36.001Z',
          transactionGasFee: 0n,
          transactionHash: '0x9ea55a8f40b8d7704f27964155476ab9c744ec2ef2b1f431ad0e05a3a6f3c1ab',
        },
      ],
    },
  ],
};

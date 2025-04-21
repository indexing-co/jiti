import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';

export const CardanoTokenTransfers: SubTemplate = {
  match: (block) => ['CARDANO'].includes(block._network as string),

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const blockTimestamp = new Date((block.timestamp as number) * 1000).toISOString();

    for (const tx of block.transactions as unknown[]) {
      const typedTx = tx as {
        transaction_identifier?: { hash?: string };
        operations?: {
          type: string;
          account?: { address?: string };
          amount?: {
            value?: string;
            currency?: {
              symbol?: string;
              decimals?: number;
            };
          };
        }[];
      };

      if (!Array.isArray(typedTx.operations)) {
        continue;
      }

      const transactionHash = typedTx.transaction_identifier?.hash || '';

      const inputs = typedTx.operations.filter((op) => op.type === 'input');
      const outputs = typedTx.operations.filter((op) => op.type === 'output');

      if (!inputs.length && !outputs.length) {
        continue;
      }

      const fromAddress = inputs[0]?.account?.address;
      if (!fromAddress) {
        continue;
      }

      const sumInputs = inputs.reduce((acc, op) => {
        const val = BigInt(op.amount?.value || '0');
        return acc + val;
      }, BigInt(0));
      const sumOutputs = outputs.reduce((acc, op) => {
        const val = BigInt(op.amount?.value || '0');
        return acc + val;
      }, BigInt(0));

      const transactionFee = sumInputs + BigInt(sumOutputs);

      for (const out of outputs) {
        const rawValue = out.amount?.value || '0';
        const absoluteValue = BigInt(rawValue);
        transfers.push({
          amount: absoluteValue < 0 ? -absoluteValue : absoluteValue,
          blockNumber: (block.block_identifier as { index: number }).index,
          from: fromAddress,
          timestamp: blockTimestamp,
          to: out.account?.address || '',
          token: out.amount?.currency?.symbol?.toUpperCase() === 'ADA' ? null : out.amount?.currency?.symbol,
          tokenType: out.amount?.currency?.symbol?.toUpperCase() === 'ADA' ? 'NATIVE' : 'TOKEN',
          transactionGasFee: transactionFee < 0 ? -transactionFee : transactionFee,
          transactionHash,
        });
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'CARDANO',
        walletAddress:
          'addr1q9syxu908lef7r6rsvk0h7gsx3rxj22cuykgx2a2l4hcfd8e9y2e9vtv4w9dyej96w99wwj8hwgc273862lk6a3vt30qjjrund',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/cardano/11443286',
      output: [
        {
          amount: 1110000n,
          blockNumber: 11443286,
          from: 'addr1qymdv285few5tyqvya86rl97r9e608njs37shfew6l2nn473aw2pcnrcvfwfgg2dnew99m4tjj0apsu7232w2euzwpysndh0h3',
          timestamp: '+057068-01-19T05:23:20.000Z',
          to: 'addr1q9syxu908lef7r6rsvk0h7gsx3rxj22cuykgx2a2l4hcfd8e9y2e9vtv4w9dyej96w99wwj8hwgc273862lk6a3vt30qjjrund',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 174257n,
          transactionHash: '261c42ba9124f55d8e169ebb692cd3759d796a54369acb316ee449b546e79309',
        },
      ],
    },
  ],
};

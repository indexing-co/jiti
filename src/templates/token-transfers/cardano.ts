import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';

export const CardanoTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'CARDANO',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const blockTimestamp = new Date(block.timestamp as number).toISOString();

    for (const tx of (block.transactions as unknown[]) || []) {
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
          metadata?: {
            tokenBundle?: {
              policyId: string;
              tokens: {
                value: string;
                currency: {
                  symbol: string;
                  decimals: number;
                };
              }[];
            }[];
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
      const absFee = transactionFee < 0 ? -transactionFee : transactionFee;

      const blockNumber = (block.block_identifier as { index: number }).index;

      for (const out of outputs) {
        const toAddress = out.account?.address || '';

        // ADA (native) transfer
        const rawValue = out.amount?.value || '0';
        const absoluteValue = BigInt(rawValue);
        transfers.push({
          amount: absoluteValue < 0 ? -absoluteValue : absoluteValue,
          blockNumber,
          from: fromAddress,
          timestamp: blockTimestamp,
          to: toAddress,
          token: out.amount?.currency?.symbol?.toUpperCase() === 'ADA' ? null : out.amount?.currency?.symbol,
          tokenType: out.amount?.currency?.symbol?.toUpperCase() === 'ADA' ? 'NATIVE' : 'TOKEN',
          transactionGasFee: absFee,
          transactionHash,
        });

        // Native tokens from tokenBundle metadata
        if (out.metadata?.tokenBundle) {
          for (const bundle of out.metadata.tokenBundle) {
            for (const tkn of bundle.tokens) {
              const tokenValue = BigInt(tkn.value);
              transfers.push({
                amount: tokenValue < 0 ? -tokenValue : tokenValue,
                blockNumber,
                from: fromAddress,
                timestamp: blockTimestamp,
                to: toAddress,
                token: `${bundle.policyId}.${tkn.currency.symbol}`,
                tokenType: 'TOKEN',
                transactionGasFee: absFee,
                transactionHash,
              });
            }
          }
        }
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
          timestamp: '2025-02-05T03:34:53.000Z',
          to: 'addr1q9syxu908lef7r6rsvk0h7gsx3rxj22cuykgx2a2l4hcfd8e9y2e9vtv4w9dyej96w99wwj8hwgc273862lk6a3vt30qjjrund',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 174257n,
          transactionHash: '261c42ba9124f55d8e169ebb692cd3759d796a54369acb316ee449b546e79309',
        },
      ],
    },
    {
      params: {
        network: 'CARDANO',
        transactionHash: 'c807ee792e47b47178aea89c9e760020ea24ed80897f9de82a2cd23e05da4d18',
      },
      payload: 'https://jiti.indexing.co/networks/cardano/13119492',
      output: [
        {
          amount: 1159390n,
          blockNumber: 13119492,
          from: 'addr1q9k660rwqcdsr8e4ema5jd9qahmfquf44n8uszvacvvfswlrzr27g03klu862usxqsru794d03gzkk8n86ta34n85z0s6j9ylh',
          timestamp: '2026-03-05T09:34:59.000Z',
          to: 'addr1qxvhvz9860r2qzcmx0qz55gzdt58etren35hhn9etpe3j5yewcy2057x5q93kv7q9fgsy6hg0jk8n8rf00xtjkrnr9gq7mz2sz',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 178481n,
          transactionHash: 'c807ee792e47b47178aea89c9e760020ea24ed80897f9de82a2cd23e05da4d18',
        },
        {
          amount: 100000000n,
          blockNumber: 13119492,
          from: 'addr1q9k660rwqcdsr8e4ema5jd9qahmfquf44n8uszvacvvfswlrzr27g03klu862usxqsru794d03gzkk8n86ta34n85z0s6j9ylh',
          timestamp: '2026-03-05T09:34:59.000Z',
          to: 'addr1qxvhvz9860r2qzcmx0qz55gzdt58etren35hhn9etpe3j5yewcy2057x5q93kv7q9fgsy6hg0jk8n8rf00xtjkrnr9gq7mz2sz',
          token: '0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa.4e49474854',
          tokenType: 'TOKEN',
          transactionGasFee: 178481n,
          transactionHash: 'c807ee792e47b47178aea89c9e760020ea24ed80897f9de82a2cd23e05da4d18',
        },
        {
          amount: 172823143n,
          blockNumber: 13119492,
          from: 'addr1q9k660rwqcdsr8e4ema5jd9qahmfquf44n8uszvacvvfswlrzr27g03klu862usxqsru794d03gzkk8n86ta34n85z0s6j9ylh',
          timestamp: '2026-03-05T09:34:59.000Z',
          to: 'addr1q8dusprx8fr89xkl88g3gq5kya46s9r4fcnwyx5yhdp3rx8rzr27g03klu862usxqsru794d03gzkk8n86ta34n85z0s8728d0',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 178481n,
          transactionHash: 'c807ee792e47b47178aea89c9e760020ea24ed80897f9de82a2cd23e05da4d18',
        },
        {
          amount: 204930000n,
          blockNumber: 13119492,
          from: 'addr1q9k660rwqcdsr8e4ema5jd9qahmfquf44n8uszvacvvfswlrzr27g03klu862usxqsru794d03gzkk8n86ta34n85z0s6j9ylh',
          timestamp: '2026-03-05T09:34:59.000Z',
          to: 'addr1q8dusprx8fr89xkl88g3gq5kya46s9r4fcnwyx5yhdp3rx8rzr27g03klu862usxqsru794d03gzkk8n86ta34n85z0s8728d0',
          token: '0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa.4e49474854',
          tokenType: 'TOKEN',
          transactionGasFee: 178481n,
          transactionHash: 'c807ee792e47b47178aea89c9e760020ea24ed80897f9de82a2cd23e05da4d18',
        },
      ],
    },
  ],
};

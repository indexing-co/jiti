import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';

export const SolanaTokenTransfers: SubTemplate = {
  match: (block) => ['SOLANA'].includes(block._network as string),

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    for (const tx of block.transactions as unknown[]) {
      const solanaTx = tx as {
        meta: {
          fee: number;
          loadedAddresses: { readonly: string[]; writable: string[] };
          postTokenBalances: {
            accountIndex: number;
            mint: string;
            owner: string;
            uiTokenAmount: { amount: string };
          }[];
          preTokenBalances: {
            accountIndex: number;
            mint: string;
            owner: string;
            uiTokenAmount: { amount: string };
          }[];
          postBalances: number[];
          preBalances: number[];
        };
        transaction: {
          message: { accountKeys: (string | { pubkey: string })[]; instructions: unknown[] };
          signatures: string[];
        };
      };
      const txHash = solanaTx.transaction.signatures[0];
      const timestamp = block.blockTime ? new Date((block.blockTime as number) * 1000).toISOString() : null;
      const allAccounts = solanaTx.transaction.message.accountKeys
        .concat(solanaTx.meta.loadedAddresses.writable)
        .concat(solanaTx.meta.loadedAddresses.readonly);

      let txFee = BigInt(solanaTx.meta.fee);
      if (txFee < BigInt(10)) {
        txFee = txFee * BigInt(Math.pow(10, 9));
      }

      const transfersByKey: Record<string, NetworkTransfer> = {};
      for (const post of solanaTx.meta.postTokenBalances) {
        let matched = false;
        for (const pre of solanaTx.meta.preTokenBalances) {
          if (post.mint === pre.mint && post.owner === pre.owner) {
            let diff = BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount);
            if (diff === BigInt(0)) {
              matched = true;
              continue;
            }
            const isNegDiff = diff < 0;
            if (diff < 0) {
              diff = -diff;
            }

            const key = `${post.mint}-${diff.toString()}`;
            const txfer: NetworkTransfer = {
              amount: diff,
              blockNumber: block.blockHeight as number,
              from: pre.owner,
              timestamp,
              to: post.owner,
              transactionGasFee: txFee,
              transactionHash: txHash,
              token: post.mint,
              tokenType: 'TOKEN',
            };
            if (isNegDiff) {
              delete txfer.to;
            } else {
              delete txfer.from;
            }
            transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
            matched = true;
          }
        }

        if (!matched) {
          let diff = BigInt(post.uiTokenAmount.amount);
          const isNegDiff = diff < 0;
          if (diff < 0) {
            diff = -diff;
          }
          const key = `${post.mint}-${diff.toString()}`;
          const txfer: NetworkTransfer = {
            amount: diff,
            blockNumber: block.blockHeight as number,
            from: null,
            timestamp,
            to: post.owner,
            token: post.mint,
            tokenType: 'TOKEN',
            transactionGasFee: txFee,
            transactionHash: txHash,
          };
          if (isNegDiff) {
            delete txfer.to;
          } else {
            delete txfer.from;
          }
          transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
        }
      }

      for (let i = 0; i < solanaTx.meta.postBalances.length; i += 1) {
        const post = solanaTx.meta.postBalances[i];
        const pre = solanaTx.meta.preBalances[i];
        if (post !== undefined && pre !== undefined && post !== pre) {
          let diff = BigInt(post) - BigInt(pre);
          if (diff < 0) {
            diff = -diff;
          }
          const key = `null-${diff.toString()}`;

          const txfer: NetworkTransfer = {
            amount: diff,
            blockNumber: block.blockHeight as number,
            from:
              typeof allAccounts[i] === 'string'
                ? (allAccounts[i] as string)
                : (allAccounts[i] as { pubkey: string })?.pubkey,
            timestamp,
            to:
              typeof allAccounts[i] === 'string'
                ? (allAccounts[i] as string)
                : (allAccounts[i] as { pubkey: string })?.pubkey?.toString(),
            token: null,
            tokenType: 'NATIVE',
            transactionGasFee: txFee,
            transactionHash: txHash,
          };
          if (post > pre) {
            delete txfer.from;
          } else {
            delete txfer.to;
          }
          transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
        }
      }

      const unmatchedFrom: Record<string, NetworkTransfer[]> = {};
      const unmatchedTo: Record<string, NetworkTransfer[]> = {};
      for (const key in transfersByKey) {
        const txfer = transfersByKey[key];
        if (!txfer.from) {
          if (!unmatchedFrom[txfer.token]) unmatchedFrom[txfer.token] = [];
          unmatchedFrom[txfer.token].push(txfer);
          delete transfersByKey[key];
        } else if (!txfer.to) {
          if (!unmatchedTo[txfer.token]) unmatchedTo[txfer.token] = [];
          unmatchedTo[txfer.token].push(txfer);
          delete transfersByKey[key];
        }
      }

      for (const token in unmatchedFrom) {
        if (unmatchedTo[token]?.length && unmatchedFrom[token]?.length) {
          const unmatchedDiff =
            unmatchedTo[token].reduce((a, b) => a + BigInt(b.amount), BigInt(0)) -
            unmatchedFrom[token].reduce((a, b) => a + BigInt(b.amount), BigInt(0));
          if (unmatchedDiff === BigInt(0) || (token === 'null' && unmatchedDiff === txFee)) {
            unmatchedTo[token].sort((a, b) => (a.amount > b.amount ? 1 : -1));
            unmatchedFrom[token].forEach((um) => {
              um.from = unmatchedTo[token][0].from;
              transfersByKey[`${token}-${um.amount.toString()}`] = um;
            });
          }
        }
      }

      transfers.push(...Object.values(transfersByKey));
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'SOLANA',
        walletAddress: 'D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
      payload: 'https://jiti.indexing.co/networks/solana/326286476',
      output: [
        {
          amount: 3000350n,
          blockNumber: 304546603,
          from: 'D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf',
          timestamp: '2025-03-12T14:42:16.000Z',
          to: 'HTd5J9YhYnN1nwCAQiykpNBjoDrgtPVUcpk9TBPMCV4b',
          transactionGasFee: 105000n,
          transactionHash: '3HKaqRRPyA2NHvmf3xzJpgTemxXcextCRmgwWfHpKhDqDbJSqCdy8GtH5zG8tHQU2Dcznf7JgMP7sCLQSoNPw2E5',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: '5u3gUxSsiqddQf1QhRDRQqDaFe9f5S3pyVkVWy77gB85',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/solana/291562718',
      output: [
        {
          amount: 239999n,
          blockNumber: 270452291,
          from: '5u3gUxSsiqddQf1QhRDRQqDaFe9f5S3pyVkVWy77gB85',
          timestamp: '2024-09-23T16:45:56.000Z',
          to: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 45000n,
          transactionHash: '2TKq9VXjQocvyQGraxqRjyF8iASRPCmjJcGXkxYQbTknjFTToVB2rRSLMFCi5VwBx9uJ2fAN1YNt4Wr8TUVRuoMi',
        },
        {
          amount: 1n,
          blockNumber: 270452291,
          from: '5u3gUxSsiqddQf1QhRDRQqDaFe9f5S3pyVkVWy77gB85',
          timestamp: '2024-09-23T16:45:56.000Z',
          to: '8MCjBNEBEyT5uAnDBupUxQ8eiKHJcf4vh546g4uM7cjF',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 45000n,
          transactionHash: '2TKq9VXjQocvyQGraxqRjyF8iASRPCmjJcGXkxYQbTknjFTToVB2rRSLMFCi5VwBx9uJ2fAN1YNt4Wr8TUVRuoMi',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: '5cuy7pMhTPhVZN9xuhgSbykRb986siGJb6vnEtkuBrSU',
        contractAddress: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
      },
      payload: 'https://jiti.indexing.co/networks/solana/325076237',
      output: [
        {
          amount: 14216129n,
          blockNumber: 303338729,
          from: '8KbrpeSRYXYjWSSdG7gE1tR7Go8MmKKxKaei1gGc4U7Q',
          timestamp: '2025-03-07T01:16:59.000Z',
          to: '5cuy7pMhTPhVZN9xuhgSbykRb986siGJb6vnEtkuBrSU',
          transactionGasFee: 353096n,
          transactionHash: '54qvCYcmUvPX6K3KuKG1nGRJWq6696LxwPNsx7DX5rcRsLbFntGEuWCjHTVc5wMcUZhKs1MuXeqpuDswrvNjETNQ',
          token: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
          tokenType: 'TOKEN',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
      },
      payload: 'https://jiti.indexing.co/networks/solana/332450156',
      output: [
        {
          amount: 19796403663n,
          blockNumber: 310691098,
          timestamp: '2025-04-10T02:29:35.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump',
          tokenType: 'TOKEN',
          from: '4acL7mD2J6GYJy2g3iVTvfpmHCQSZ1rb8DBuupjcVzHJ',
        },
        {
          amount: 402062750n,
          blockNumber: 310691098,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '5yY5BGRgwa5rxvYPpMV9EkDpwp6w1vNNXUNzUCtMoFfR',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
        },
        {
          amount: 97937250n,
          blockNumber: 310691098,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '9zF2ZWTjnk6UkyWRxNtqy9UHims9u7LSaHGyhA5PwDSx',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
      payload: 'https://jiti.indexing.co/networks/solana/332822080',
      output: [
        {
          amount: 2500000n,
          blockNumber: 311062104,
          from: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
          timestamp: '2025-04-11T19:36:39.000Z',
          to: '3LoAYHuSd7Gh8d7RTFnhvYtiTiefdZ5ByamU42vkzd76',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 350362n,
          transactionHash: 'xKTWvnhSRErcHCMozRMEue4MriNr1Any6LiaQzXrR7imZ1MpZxRqbyv9LLg4JQoDq4oJZpDqPmzxLCtMCkgj2hn',
        },
        {
          amount: 1373625000n,
          blockNumber: 311062104,
          from: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
          timestamp: '2025-04-11T19:36:39.000Z',
          to: '5guD4Uz462GT4Y4gEuqyGsHZ59JGxFN4a3rF6KWguMcJ',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 350362n,
          transactionHash: 'xKTWvnhSRErcHCMozRMEue4MriNr1Any6LiaQzXrR7imZ1MpZxRqbyv9LLg4JQoDq4oJZpDqPmzxLCtMCkgj2hn',
        },
        {
          amount: 1123875000n,
          blockNumber: 311062104,
          from: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
          timestamp: '2025-04-11T19:36:39.000Z',
          to: 'DH4xmaWDnTzKXehVaPSNy9tMKJxnYL5Mo5U3oTHFtNYJ',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 350362n,
          transactionHash: 'xKTWvnhSRErcHCMozRMEue4MriNr1Any6LiaQzXrR7imZ1MpZxRqbyv9LLg4JQoDq4oJZpDqPmzxLCtMCkgj2hn',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
      },
      payload: 'https://jiti.indexing.co/networks/solana/344836070',
      output: [
        {
          amount: 21234547656n,
          blockNumber: 323048342,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          timestamp: '2025-06-05T18:30:59.000Z',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
          tokenType: 'TOKEN',
          to: 'ChkRerg6X89xHYqV4iBqcboBdU1WA8Uvs9fp2yZrqbg',
        },
        {
          amount: 3272427086n,
          blockNumber: 323048342,
          from: 'DQwTf8dHkjtM6VuewpgET7MS7kX3EEXQDqvXkScC6tnB',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
        },
      ],
    },
  ],
};

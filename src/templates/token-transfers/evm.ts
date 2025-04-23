import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import { evmDecodeLogWithMetadata } from '../../utils';

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export const EVMTokenTransfers: SubTemplate = {
  match: () => true,

  transform(block, _ctx) {
    const TOKEN_TYPES = (_ctx.params.tokenTypes as NetworkTransfer['tokenType'][]) || [];
    let transfers: NetworkTransfer[] = [];

    for (const tx of block.transactions as any[]) {
      if (!tx.receipt) {
        continue;
      }

      const timestamp = new Date((block.timestamp as number) * 1000).toISOString();
      const transactionGasFee = BigInt(tx.receipt.gasUsed) * BigInt(tx.receipt.effectiveGasPrice);

      // track direct ETH transfers
      if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NATIVE')) {
        // pull from traces, if available
        if (Array.isArray(tx.traces)) {
          for (const trace of tx.traces.filter((t) => t.action)) {
            const action = trace.action as unknown as { from: string; to: string; value: string };
            if (!action?.value) continue;

            transfers.push({
              amount: BigInt(action.value),
              blockNumber: tx.blockNumber as number,
              from: action.from?.toLowerCase() || NULL_ADDRESS,
              index: trace.traceAddress?.join('-'),
              timestamp,
              to: action.to?.toLowerCase() || NULL_ADDRESS,
              tokenType: 'NATIVE',
              transactionGasFee,
              transactionHash: tx.hash,
            });
          }
        } else if ((tx.value as string)?.length >= 3 || /\d+/.test(tx.value as string)) {
          transfers.push({
            amount: BigInt(tx.value as string),
            blockNumber: tx.blockNumber as number,
            from: tx.from?.toLowerCase() || NULL_ADDRESS,
            timestamp,
            to: tx.to?.toLowerCase() || NULL_ADDRESS,
            tokenType: 'NATIVE',
            transactionGasFee,
            transactionHash: tx.hash,
          });
        }
      }

      // track ERC20 transfers
      if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('TOKEN')) {
        for (const log of tx.receipt.logs) {
          const txfer = evmDecodeLogWithMetadata(log, [
            'Transfer(address indexed from, address indexed to, uint256 value)',
          ]);
          if (txfer) {
            transfers.push({
              amount: txfer.decoded.value as bigint,
              blockNumber: tx.blockNumber as number,
              from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
              index: log.logIndex,
              timestamp,
              to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
              token: (log.address as string).toLowerCase(),
              tokenType: 'TOKEN',
              transactionGasFee,
              transactionHash: tx.hash,
            });
          }
        }
      }

      if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NFT')) {
        for (const log of tx.receipt.logs) {
          const txfer = evmDecodeLogWithMetadata(log, [
            'Transfer(address indexed from, address indexed to, uint256 indexed value)',
            'TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
            'TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
          ]);

          if (!txfer) continue;

          switch (txfer.metadata.name) {
            case 'Transfer': {
              transfers.push({
                amount: 1,
                blockNumber: tx.blockNumber as number,
                from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                index: log.logIndex,
                timestamp,
                to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                token: (log.address as string).toLowerCase(),
                tokenId: (txfer.decoded.value as bigint).toString(),
                tokenType: 'NFT',
                transactionGasFee,
                transactionHash: tx.hash,
              });
              break;
            }
            case 'TransferSingle': {
              transfers.push({
                amount: txfer.decoded.value as bigint,
                blockNumber: tx.blockNumber as number,
                from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                index: log.logIndex,
                timestamp,
                to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                token: (log.address as string).toLowerCase(),
                tokenId: (txfer.decoded.id as bigint).toString(),
                tokenType: 'NFT',
                transactionGasFee,
                transactionHash: tx.hash,
              });
              break;
            }
            case 'TransferBatch': {
              for (let i = 0; i < (txfer.decoded.ids as bigint[]).length; i += 1) {
                transfers.push({
                  amount: txfer.decoded.values[i] as bigint,
                  blockNumber: tx.blockNumber as number,
                  from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                  index: log.logIndex,
                  timestamp,
                  to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                  token: (log.address as string).toLowerCase(),
                  tokenId: (txfer.decoded.ids[i] as bigint).toString(),
                  tokenType: 'NFT',
                  transactionGasFee,
                  transactionHash: tx.hash,
                });
              }
              break;
            }
          }
        }
      }
    }

    if (typeof _ctx.params.contractAddress === 'string') {
      _ctx.params.contractAddress = _ctx.params.contractAddress.toLowerCase();
    }
    if (typeof _ctx.params.walletAddress === 'string') {
      _ctx.params.walletAddress = _ctx.params.walletAddress.toLowerCase();
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'BASE',
        walletAddress: '0x4F80864cD68782144e3736626896990acAe15a11',
        contractAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
      },
      payload: 'https://jiti.indexing.co/networks/base/23507423',
      output: [
        {
          amount: 1000000000000000000000n,
          blockNumber: 23507423,
          from: '0x053002b4b332b422733c9469ddf9990bb6235e3d',
          index: 536,
          timestamp: '2024-12-10T04:16:33.000Z',
          to: '0x4f80864cd68782144e3736626896990acae15a11',
          token: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
          tokenType: 'TOKEN',
          transactionGasFee: 1192354854229n,
          transactionHash: '0x69c9b12ccbe2d4f2f1dfc7c4a8557fc099fc5df276424417815acbc79a06fd56',
        },
      ],
    },
    {
      params: {
        network: 'POLYGON',
        walletAddress: '0x06D8c5E25B9aD46dA43FD71571E8a12aae341570',
        contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      },
      payload: 'https://jiti.indexing.co/networks/polygon/70623684',
      output: [
        {
          amount: 4877821n,
          blockNumber: 70623684,
          from: '0xcb39c5b0db9c5b6bd1d9273dccc2f98f532a8bc6',
          index: 0,
          timestamp: '2025-04-22T17:51:55.000Z',
          to: '0x06d8c5e25b9ad46da43fd71571e8a12aae341570',
          token: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
          tokenType: 'TOKEN',
          transactionGasFee: 8950898176621703n,
          transactionHash: '0x5235cbe22deba5dd8a42f36024b1df1c0f82a8e901e6cc176a38e2fe49b1d2e3',
        },
      ],
    },
  ],
};

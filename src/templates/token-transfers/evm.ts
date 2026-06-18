import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import { evmDecodeLogWithMetadata } from '../../utils';
import { blockToVM } from '../../utils/block-to-vm';
import type { EvmBlock } from '../../types/beats/evm';

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

// zkSync Era wraps native ETH as an ERC-20 at this address; Transfer logs from it represent native ETH movements
const ZKSYNC_NATIVE_ETH = '0x000000000000000000000000000000000000800a';

export const EVMTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'EVM',

  transform(block, _ctx) {
    const TOKEN_TYPES = (_ctx.params.tokenTypes as NetworkTransfer['tokenType'][]) || [];
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as unknown as EvmBlock;

    for (const tx of (typedBlock.transactions as any[]) || []) {
      if (!tx.receipt) {
        continue;
      }

      const timestamp = new Date(typedBlock.timestamp * 1000).toISOString();
      // Some EVM forks (e.g. Cronos / Ethermint) omit effectiveGasPrice on the receipt;
      // fall back to the tx's gasPrice so gas-fee math doesn't throw and drop the whole block.
      const effectiveGasPrice = tx.receipt.effectiveGasPrice ?? tx.gasPrice ?? 0;
      const transactionGasFee = BigInt(tx.receipt.gasUsed ?? 0) * BigInt(effectiveGasPrice);

      // check if this tx has zkSync native ETH Transfer logs (used to skip unreliable traces)
      const hasZkSyncEthLogs = tx.receipt.logs.some(
        (log) => (log.address as string).toLowerCase() === ZKSYNC_NATIVE_ETH
      );

      // track direct ETH transfers
      if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NATIVE')) {
        // handle L1→L2 deposit transactions (OP Stack type 0x7e) as native mints
        if (tx.mint && BigInt(tx.mint) > 0n) {
          transfers.push({
            amount: BigInt(tx.mint),
            blockNumber: tx.blockNumber as number,
            from: NULL_ADDRESS,
            timestamp,
            to: tx.to?.toLowerCase() || tx.from?.toLowerCase() || NULL_ADDRESS,
            tokenType: 'NATIVE',
            transactionGasFee,
            transactionHash: tx.hash,
          });
        }
        // on zkSync, native ETH transfers appear as Transfer logs from 0x800a (handled below)
        else if (hasZkSyncEthLogs) {
          for (const log of tx.receipt.logs) {
            if ((log.address as string).toLowerCase() !== ZKSYNC_NATIVE_ETH) continue;
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
                tokenType: 'NATIVE',
                transactionGasFee,
                transactionHash: tx.hash,
              });
            }
          }
        }
        // pull from traces, if available
        else if (Array.isArray(tx.traces)) {
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
          // skip zkSync native ETH logs (already handled as NATIVE above)
          if ((log.address as string).toLowerCase() === ZKSYNC_NATIVE_ETH) continue;

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
        network: 'BASE',
        walletAddress: '0xDa863f802Cc8CBA3C436bF801BD7785d9E7d4F36',
        tokenTypes: ['NATIVE'],
      },
      payload: 'https://jiti.indexing.co/networks/base/13170774',
      output: [
        {
          amount: 80000000000000000n,
          blockNumber: 13170774,
          from: '0x0000000000000000000000000000000000000000',
          timestamp: '2024-04-14T21:41:35.000Z',
          to: '0xda863f802cc8cba3c436bf801bd7785d9e7d4f36',
          tokenType: 'NATIVE',
          transactionGasFee: 0n,
          transactionHash: '0xa3c7cbece45ff18b18e001c4bc096567c85526dad3453dba88791054a61fc444',
        },
      ],
    },
    {
      params: {
        network: 'ZKSYNC',
        walletAddress: '0xf70da97812CB96aCDF810712Aa562db8dfA3dBEf',
        tokenTypes: ['NATIVE'],
      },
      payload: 'https://jiti.indexing.co/networks/zksync/55005000',
      output: [
        {
          amount: 1615028132795916n,
          blockNumber: 55005000,
          from: '0xebd1e414ebb98522cfd932104ba41fac10a4ef35',
          index: 4,
          timestamp: '2025-02-01T06:14:12.000Z',
          to: '0xf70da97812cb96acdf810712aa562db8dfa3dbef',
          tokenType: 'NATIVE',
          transactionGasFee: 6389164250000n,
          transactionHash: '0xc0e1850d24af965e6a02836301a696e9f021b07fed765d8affe3bda1846d5700',
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

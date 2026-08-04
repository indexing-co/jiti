import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import { evmDecodeLogWithMetadata } from '../../utils';
import { blockToVM } from '../../utils/block-to-vm';
import type { EvmBlock, EvmBlockTransactionsOutOfBandTransfer } from '../../types/beats/evm';

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
          // Build a set of reverted trace-address prefixes. Any trace whose
          // traceAddress starts with a reverted ancestor is itself rolled back
          // even when the child trace carries no `error` of its own (the EVM
          // rolls back all state changes under a reverted CALL/DELEGATECALL).
          const revertedPrefixes: string[] = [];
          for (const t of tx.traces) {
            if (t.error && Array.isArray(t.traceAddress)) {
              revertedPrefixes.push(t.traceAddress.join(',') + ',');
            }
          }

          for (const trace of tx.traces.filter((t) => t.action && !t.error)) {
            // Skip traces whose ancestor reverted
            if (revertedPrefixes.length && Array.isArray(trace.traceAddress)) {
              const addr = trace.traceAddress.join(',') + ',';
              if (revertedPrefixes.some((prefix) => addr.startsWith(prefix))) continue;
            }

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
        } else if (
          tx.receipt.status !== false &&
          ((tx.value as string)?.length >= 3 || /\d+/.test(tx.value as string))
        ) {
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

        // Arbitrum Nitro / Orbit: value moved outside the EVM call tree.
        //
        // Additive rather than another `else if` — a retryable redemption has BOTH an EVM call
        // tree and out-of-band movements, and they are different legs of the same deposit. The
        // escrow release funds the redeemer, then the EVM call spends it; only the second leg is
        // in `tx.traces`, so on its own it reads as an account spending value it never received.
        //
        // Only movements with BOTH ends are emitted. A null end is a mint/burn against the fee
        // system (feePayment / gasRefund / feeCollection) — that is gas, already reported via
        // `transactionGasFee`, and emitting it here would double-count it as a transfer.
        const outOfBand = (tx.outOfBandTransfers as EvmBlockTransactionsOutOfBandTransfer[]) || [];
        for (let i = 0; i < outOfBand.length; i++) {
          const oob = outOfBand[i];
          if (!oob?.from || !oob?.to || !oob?.value) continue;

          const amount = BigInt(oob.value);
          // retryable redemptions emit several zero-value bookkeeping legs; they carry no value
          if (amount === 0n) continue;

          transfers.push({
            amount,
            blockNumber: tx.blockNumber as number,
            from: oob.from.toLowerCase(),
            // position-scoped: the dedup key in index.ts includes `index`, and one tx can carry
            // several movements of the same purpose between the same pair
            index: `oob-${i}-${oob.purpose}`,
            timestamp,
            to: oob.to.toLowerCase(),
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
    // Gnosis Safe execTransaction where the inner delegatecall reverts — the child
    // traces (ETH transfers) complete without error but their parent is reverted,
    // so the ETH never actually moved. Must produce zero native transfers.
    // Ref: https://etherscan.io/tx/0xc3a2e97e51c2b85c3a1906c87f879907cd2ebdf47efa5c88b65eb09aa482c1ba
    {
      params: {
        network: 'ETHEREUM',
        walletAddress: '0x19787DfAE6c9F17D74b8e228c9DdfE56e0c0A616',
        tokenTypes: ['NATIVE'],
      },
      payload: 'https://jiti.indexing.co/networks/ethereum/25596353',
      output: [],
    },
    // Arbitrum Orbit (Robinhood Chain) retryable-ticket redemption — a bridge deposit landing.
    // ArbOS moves the value in two hops: an out-of-band `escrow` release funds the redeemer,
    // then the EVM call spends it. Only the second hop is in `tx.traces`, so a trace-only read
    // shows an account spending 18.7 ETH it was never seen to receive.
    //
    // Inline fixture rather than a URL: ROBINHOOD is not enabled in prod, so
    // jiti.indexing.co serves no block for it.
    // Ref: block 26983341, tx 0x2c71e49a… (type 0x68 ArbitrumRetryTx)
    //
    // Exercises all three exclusion rules:
    //   - one-ended movements (prepaid/feePayment/gasRefund/undoRefund) are fee mint/burn,
    //     already reported via transactionGasFee — must NOT become transfers
    //   - zero-value bookkeeping legs must NOT become transfers
    //   - both-ended non-zero movements (escrow, refund) MUST become NATIVE transfers
    {
      params: {
        network: 'ROBINHOOD',
        tokenTypes: ['NATIVE'],
      },
      payload: {
        _network: 'ROBINHOOD',
        number: 26983341,
        timestamp: 1785782243,
        transactions: [
          {
            hash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
            type: 104,
            blockNumber: 26983341,
            transactionIndex: 2,
            from: '0x0f1439027fa720d0e6e266677b71843dc7609bc3',
            to: '0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0',
            value: '0x1040a542b240c3958',
            receipt: {
              blockNumber: 26983341,
              gasUsed: 21062,
              effectiveGasPrice: 20776000,
              status: true,
              logs: [],
            },
            traces: [
              {
                action: {
                  callType: 'call',
                  from: '0x0f1439027fa720d0e6e266677b71843dc7609bc3',
                  gas: '0x5246',
                  to: '0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0',
                  value: '0x1040a542b240c3958',
                },
                blockNumber: 26983341,
                result: {},
                subtraces: 0,
                traceAddress: [],
                transactionHash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
                transactionPosition: 2,
                type: 'call',
              },
            ],
            outOfBandTransfers: [
              // 0 — both ends, non-zero: the deposit funding leg. MUST be emitted.
              {
                purpose: 'escrow',
                from: '0x6d0f620CcE7aC81b563f505Dd2C35384581398fe',
                to: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                value: '0x1040a542b240c3958',
              },
              // 1-4 — one-ended fee machinery. Must NOT be emitted (that is gas).
              {
                purpose: 'prepaid',
                from: null,
                to: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                value: '0x24479883000',
              },
              {
                purpose: 'feePayment',
                from: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                to: null,
                value: '0x24479883000',
              },
              {
                purpose: 'gasRefund',
                from: null,
                to: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                value: '0x1de977c8680',
              },
              {
                purpose: 'undoRefund',
                from: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                to: null,
                value: '0x1de977c8680',
              },
              // 5, 7, 9 — both ends, non-zero: fee refunds to the beneficiary. MUST be emitted.
              // 6, 8, 10, 11 — both ends but zero-value bookkeeping. Must NOT be emitted.
              {
                purpose: 'refund',
                from: '0xbC5C3a7Adecf54D34169fd90dbD1B7d3142DF067',
                to: '0x0e14abcaDAF3F930fa4e37eb2f6EA3A44A41C901',
                value: '0x367647ccf8',
              },
              {
                purpose: 'refund',
                from: '0xbC5C3a7Adecf54D34169fd90dbD1B7d3142DF067',
                to: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                value: '0x0',
              },
              {
                purpose: 'refund',
                from: '0x5a2B80a9b7effc06129bD5462D77BC20A8A59BE7',
                to: '0x0e14abcaDAF3F930fa4e37eb2f6EA3A44A41C901',
                value: '0x1ccb7497200',
              },
              {
                purpose: 'refund',
                from: '0x5a2B80a9b7effc06129bD5462D77BC20A8A59BE7',
                to: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                value: '0x0',
              },
              {
                purpose: 'refund',
                from: '0xbC5C3a7Adecf54D34169fd90dbD1B7d3142DF067',
                to: '0x0e14abcaDAF3F930fa4e37eb2f6EA3A44A41C901',
                value: '0x11e0331480',
              },
              {
                purpose: 'refund',
                from: '0xbC5C3a7Adecf54D34169fd90dbD1B7d3142DF067',
                to: '0x0F1439027Fa720d0e6E266677B71843dc7609bc3',
                value: '0x0',
              },
              {
                purpose: 'escrow',
                from: '0x6d0f620CcE7aC81b563f505Dd2C35384581398fe',
                to: '0x0e14abcaDAF3F930fa4e37eb2f6EA3A44A41C901',
                value: '0x0',
              },
            ],
          },
        ],
      },
      output: [
        // the EVM call leg — what a trace-only reader sees today
        {
          amount: 18737881743893477720n,
          blockNumber: 26983341,
          from: '0x0f1439027fa720d0e6e266677b71843dc7609bc3',
          index: '',
          timestamp: '2026-08-03T18:37:23.000Z',
          to: '0xfd03abcadaf3f930fa4e37eb2f6ea3a44a41b7f0',
          tokenType: 'NATIVE',
          transactionGasFee: 437584112000n,
          transactionHash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
        },
        // the funding leg — invisible before this change
        {
          amount: 18737881743893477720n,
          blockNumber: 26983341,
          from: '0x6d0f620cce7ac81b563f505dd2c35384581398fe',
          index: 'oob-0-escrow',
          timestamp: '2026-08-03T18:37:23.000Z',
          to: '0x0f1439027fa720d0e6e266677b71843dc7609bc3',
          tokenType: 'NATIVE',
          transactionGasFee: 437584112000n,
          transactionHash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
        },
        {
          amount: 233912651000n,
          blockNumber: 26983341,
          from: '0xbc5c3a7adecf54d34169fd90dbd1b7d3142df067',
          index: 'oob-5-refund',
          timestamp: '2026-08-03T18:37:23.000Z',
          to: '0x0e14abcadaf3f930fa4e37eb2f6ea3a44a41c901',
          tokenType: 'NATIVE',
          transactionGasFee: 437584112000n,
          transactionHash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
        },
        {
          amount: 1978760000000n,
          blockNumber: 26983341,
          from: '0x5a2b80a9b7effc06129bd5462d77bc20a8a59be7',
          index: 'oob-7-refund',
          timestamp: '2026-08-03T18:37:23.000Z',
          to: '0x0e14abcadaf3f930fa4e37eb2f6ea3a44a41c901',
          tokenType: 'NATIVE',
          transactionGasFee: 437584112000n,
          transactionHash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
        },
        {
          amount: 76775888000n,
          blockNumber: 26983341,
          from: '0xbc5c3a7adecf54d34169fd90dbd1b7d3142df067',
          index: 'oob-9-refund',
          timestamp: '2026-08-03T18:37:23.000Z',
          to: '0x0e14abcadaf3f930fa4e37eb2f6ea3a44a41c901',
          tokenType: 'NATIVE',
          transactionGasFee: 437584112000n,
          transactionHash: '0x2c71e49abff1a989dba62e0bf7ff8754f043dfe7325b92e6af7f07598211285e',
        },
      ],
    },
  ],
};

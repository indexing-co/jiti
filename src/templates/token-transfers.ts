import { evmAddressToChecksum, evmDecodeLogWithMetadata } from '../utils';
import { Template } from '../types';

type NetworkTransfer = {
  amount: bigint;
  blockNumber: number;
  from: string;
  index?: string;
  timestamp: string;
  to: string;
  token?: string;
  tokenId?: string;
  tokenType: 'NATIVE' | 'TOKEN' | 'NFT';
  transactionGasFee: bigint;
  transactionHash: string;
};

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const tokenTransfers: Template = {
  key: 'tokenTransfers',
  name: 'Token Transfers',
  description: 'Get all token transfers for a set of token types.',
  tags: ['EVM', 'ERC20', 'ERC721', 'NFT', 'TOKEN'],
  disabled: false,
  params: [{ key: 'tokenTypes', name: 'Token Types', type: 'STRING', multiple: true, optional: true }],

  transform: (block, _ctx) => {
    const TOKEN_TYPES = (_ctx.params.tokenTypes as NetworkTransfer['tokenType'][]) || [];
    const transfers: NetworkTransfer[] = [];

    switch (block._network) {
      // @TODO: expand to non-EVM

      // assume EVM as default for now
      default: {
        for (const tx of block.transactions as any[]) {
          if (!tx.receipt) {
            continue;
          }

          const timestamp = new Date((block.timestamp as number) * 1000).toISOString();
          const transactionGasFee = BigInt(tx.receipt.gasUsed) * BigInt(tx.receipt.effectiveGasPrice);

          // track direct ETH transfers
          if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NATIVE')) {
            if ((tx.value as string)?.length >= 3 || /\d+/.test(tx.value as string)) {
              transfers.push({
                amount: BigInt(tx.value as string),
                blockNumber: tx.blockNumber as number,
                from: evmAddressToChecksum(tx.from) || NULL_ADDRESS,
                timestamp,
                to: evmAddressToChecksum(tx.to) || NULL_ADDRESS,
                tokenType: 'NATIVE',
                transactionGasFee,
                transactionHash: tx.hash,
              });

              if (Array.isArray(tx.traces)) {
                for (const trace of tx.traces.filter((t) => t.action)) {
                  const action = trace.action as unknown as { from: string; to: string; value: string };
                  if (!action?.value) continue;

                  transfers.push({
                    amount: BigInt(action.value),
                    blockNumber: tx.blockNumber as number,
                    from: evmAddressToChecksum(action.from) || NULL_ADDRESS,
                    index: trace.traceAddress?.join('-'),
                    timestamp,
                    to: evmAddressToChecksum(action.to) || NULL_ADDRESS,
                    tokenType: 'NATIVE',
                    transactionGasFee,
                    transactionHash: tx.hash,
                  });
                }
              }
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
                  from: evmAddressToChecksum(txfer.decoded.from as string) || NULL_ADDRESS,
                  index: log.logIndex,
                  timestamp,
                  to: evmAddressToChecksum(txfer.decoded.to as string) || NULL_ADDRESS,
                  token: evmAddressToChecksum(log.address as string),
                  tokenType: 'TOKEN',
                  transactionGasFee,
                  transactionHash: tx.hash,
                });
              }
            }
          }

          // @TODO: add NFT transfers
          if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NFT')) {
            for (const log of tx.receipt.logs) {
            }
          }
        }
      }
    }

    return transfers.filter((txfer) => txfer.amount > BigInt(0));
  },
};

export default tokenTransfers;

import { evmAddressToChecksum, evmDecodeLogWithMetadata } from '../utils';

type NetworkTransfer = {
  amount: bigint;
  blockNumber: number;
  from: string;
  timestamp: string;
  to: string;
  token?: string;
  tokenId?: string;
  // @TODO: tokenType: 'CURRENCY' | 'NFT';
  transactionGasFee: bigint;
  transactionHash: string;
};

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export function tokenTransfers(block) {
  const transfers: NetworkTransfer[] = [];

  switch (block._network) {
    // @TODO: port non-EVM handlers over

    // assume EVM as default for now
    default: {
      for (const tx of block.transactions) {
        if (!tx.receipt) {
          continue;
        }

        const timestamp = new Date((block.timestamp as number) * 1000).toISOString();
        const transactionGasFee = BigInt(tx.receipt.gasUsed) * BigInt(tx.receipt.effectiveGasPrice);

        // track direct ETH transfers
        if ((tx.value as string)?.length >= 3 || /\d+/.test(tx.value as string)) {
          transfers.push({
            amount: BigInt(tx.value as string),
            blockNumber: tx.blockNumber as number,
            from: evmAddressToChecksum(tx.from) || NULL_ADDRESS,
            timestamp,
            to: evmAddressToChecksum(tx.to) || NULL_ADDRESS,
            transactionGasFee,
            transactionHash: tx.hash,
          });
        }

        // track ERC20 transfers
        for (const log of tx.receipt.logs) {
          const txfer = evmDecodeLogWithMetadata(log, [
            'Transfer(address indexed from, address indexed to, uint256 value)',
          ]);
          if (txfer) {
            transfers.push({
              amount: txfer.decoded.value as bigint,
              blockNumber: tx.blockNumber as number,
              from: evmAddressToChecksum(txfer.decoded.from as string) || NULL_ADDRESS,
              timestamp,
              to: evmAddressToChecksum(txfer.decoded.to as string) || NULL_ADDRESS,
              token: evmAddressToChecksum(log.address as string),
              transactionGasFee,
              transactionHash: tx.hash,
            });
          }
        }

        if (Array.isArray(tx.traces)) {
          for (const trace of tx.traces.filter((t) => t.action)) {
            const action = trace.action as unknown as { from: string; to: string; value: string };
            if (!action?.value) continue;

            transfers.push({
              amount: BigInt(action.value),
              blockNumber: tx.blockNumber as number,
              from: evmAddressToChecksum(action.from) || NULL_ADDRESS,
              timestamp,
              to: evmAddressToChecksum(action.to) || NULL_ADDRESS,
              transactionGasFee,
              transactionHash: tx.hash,
            });
          }
        }
      }
    }
  }

  return transfers.filter((txfer) => txfer.amount > BigInt(0));
}

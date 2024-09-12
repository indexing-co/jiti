import { evmDecodeLog } from '../utils/evm-decode-log';

export function erc20Transfers(block) {
  const txfers = [];

  for (const tx of block.transactions) {
    if (!tx.receipt) continue;

    for (const log of tx.receipt.logs) {
      const txfer = evmDecodeLog(log, 'Transfer(address indexed from, address indexed to, uint256 value)');
      if (txfer) {
        txfers.push({
          blockNumber: block.number,
          timestamp: new Date(block.timestamp * 1000).toISOString(),
          transactionHash: tx.hash,
          ...txfer,
        });
      }
    }
  }

  return txfers;
}

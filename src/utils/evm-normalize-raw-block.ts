import { evmAddressToChecksum } from './evm-address-to-checksum';

export function normalizeEVMBlock(rawBlock: Record<string, unknown>): Record<string, unknown> {
  for (const k of ['baseFeePerGas', 'gasLimit', 'gasUsed', 'number', 'size', 'timestamp']) {
    if (typeof rawBlock[k] === 'string') {
      rawBlock[k] = parseInt(rawBlock[k] as string);
    }
  }

  for (const k of ['difficulty', 'totalDifficulty']) {
    if (typeof rawBlock[k] === 'string') {
      rawBlock[k] = BigInt(rawBlock[k] as string).toString();
    }
  }
  for (const k of ['miner']) {
    rawBlock[k] = evmAddressToChecksum(rawBlock[k] as string);
  }

  rawBlock.transactions = (
    rawBlock.transactions as { receipt: Record<string, unknown>; traces: Record<string, unknown>[] } & Record<
      string,
      unknown
    >[]
  ).map((tx) => {
    for (const k of [
      'blockNumber',
      'cumulativeGasUsed',
      'effectiveGasPrice',
      'gas',
      'gasUsed',
      'nonce',
      'status',
      'transactionIndex',
    ]) {
      if (typeof tx[k] === 'string') {
        tx[k] = parseInt(tx[k] as string);
      }
      if (typeof tx.receipt[k] === 'string') {
        tx.receipt[k] = parseInt(tx.receipt[k] as string);
      }
    }

    for (const k of ['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value']) {
      if (typeof tx[k] === 'string') {
        tx[k] = BigInt(tx[k] as string).toString();
      }
      if (typeof tx.receipt[k] === 'string') {
        tx.receipt[k] = BigInt(tx.receipt[k] as string).toString();
      }
    }

    for (const k of ['from', 'to']) {
      if (typeof tx[k] === 'string') {
        tx[k] = evmAddressToChecksum(tx[k] as string);
      }
    }
    for (const k of ['contractAddress']) {
      if (typeof tx.receipt[k] === 'string') {
        tx.receipt[k] = evmAddressToChecksum(tx.receipt[k] as string);
      }
    }

    tx.type = parseInt(tx.type as string);
    tx.receipt['status'] = Boolean(tx.receipt['status'] as string);

    tx.receipt['logs'] = (tx.receipt['logs'] as Record<string, unknown>[])?.map((log) => {
      for (const k of ['blockNumber', 'logIndex', 'transactionIndex']) {
        if (typeof log[k] === 'string') {
          log[k] = parseInt(log[k] as string);
        }
      }
      log['address'] = evmAddressToChecksum(log['address'] as string);
      return log;
    });

    return tx;
  });

  return rawBlock;
}

import { blockToVM } from './block-to-vm';

export function blockToTimestamp(block: Record<string, unknown>): Date {
  const vm = blockToVM(block);

  switch (vm) {
    case 'APTOS': {
      return new Date(
        parseInt((block as { transactions: { timestamp: string }[] }).transactions[0].timestamp, 10) / 1_000
      );
    }
    case 'CARDANO': {
      return new Date(block.timestamp as number);
    }
    case 'COSMOS': {
      return new Date((block as { block: { header: { time: string } } }).block.header.time);
    }
    case 'EVM': {
      return new Date((block.timestamp as number) * 1000);
    }
    case 'FILECOIN': {
      return new Date((block as { Blocks: { Timestamp: number }[] }).Blocks[0].Timestamp * 1000);
    }
    case 'RIPPLE': {
      return new Date(block.close_time_iso as string);
    }
    case 'STARKNET': {
      return new Date((block.timestamp as number) * 1000);
    }
    case 'STELLAR': {
      return new Date((block as { transactions: { created_at: string }[] }).transactions[0].created_at);
    }
    case 'SUBSTRATE': {
      const timestampExtrinsic = (block.extrinsics as { method: string; args: any[] }[]).find(
        (ex) => ex.method === 'timestamp.set'
      );
      return new Date(Number(timestampExtrinsic.args[0].toString().replace(/,/g, '')));
    }
    case 'SUI': {
      return new Date(parseInt(block.timestamp as string, 10));
    }
    case 'SVM': {
      return new Date((block.blockTime as number) * 1000);
    }
    case 'TON': {
      return new Date((block.shards?.[0]?.gen_utime as number) * 1000);
    }
    case 'UTXO': {
      return new Date((block.time as number) * 1000);
    }
  }

  return null;
}

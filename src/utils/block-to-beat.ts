import { blockToVM } from './block-to-vm';

export function blockToBeat(block: Record<string, unknown>): number {
  const vm = blockToVM(block);

  switch (vm) {
    case 'APTOS': {
      return parseInt(block.block_height as string, 10);
    }
    case 'CARDANO': {
      return (block.block_identifier as { index: number }).index;
    }
    case 'COSMOS': {
      const typedBlock = block as {
        block: { header: { height: string } };
      };
      return Number(typedBlock.block.header.height);
    }
    case 'EVM': {
      return block.number as number;
    }
    case 'FILECOIN': {
      return block.Height as number;
    }
    case 'RIPPLE': {
      return parseInt(block.ledger_index as string, 10);
    }
    case 'STARKNET': {
      return block.block_number as number;
    }
    case 'STELLAR': {
      return block.sequence as number;
    }
    case 'SUBSTRATE': {
      return block.blockNumber as number;
    }
    case 'SUI': {
      return parseInt(block.sequence as string, 10);
    }
    case 'SVM': {
      return (block.parentSlot as number) + 1;
    }
    case 'TON': {
      return block.seqno as number;
    }
    case 'UTXO': {
      return block.height as number;
    }
  }

  return null;
}

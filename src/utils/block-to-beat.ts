import { blockToVM } from './block-to-vm';
import type { AptosBlock } from '../types/beats/aptos';
import type { CardanoBlock } from '../types/beats/cardano';
import type { CosmosBlock } from '../types/beats/cosmos';
import type { EvmBlock } from '../types/beats/evm';
import type { FilecoinBlock } from '../types/beats/filecoin';
import type { RippleLedger } from '../types/beats/ripple';
import type { StarknetBlock } from '../types/beats/starknet';
import type { StellarLedger } from '../types/beats/stellar';
import type { SubstrateBlock } from '../types/beats/substrate';
import type { SuiCheckpoint } from '../types/beats/sui';
import type { SvmBlock } from '../types/beats/svm';
import type { TonBlock } from '../types/beats/ton';
import type { UtxoBlock } from '../types/beats/utxo';

export function blockToBeat(block: Record<string, unknown>): number {
  const vm = blockToVM(block);

  switch (vm) {
    case 'APTOS': {
      return parseInt((block as unknown as AptosBlock).block_height, 10);
    }
    case 'CARDANO': {
      return (block as unknown as CardanoBlock).block_identifier.index;
    }
    case 'COSMOS': {
      return Number((block as unknown as CosmosBlock).block.header.height);
    }
    case 'EVM': {
      return (block as unknown as EvmBlock).number;
    }
    case 'FILECOIN': {
      return (block as unknown as FilecoinBlock).Height;
    }
    case 'RIPPLE': {
      return parseInt((block as unknown as RippleLedger).ledger_index, 10);
    }
    case 'STARKNET': {
      return (block as unknown as StarknetBlock).block_number;
    }
    case 'STELLAR': {
      return (block as unknown as StellarLedger).sequence;
    }
    case 'SUBSTRATE': {
      return (block as unknown as SubstrateBlock).blockNumber;
    }
    case 'SUI': {
      return parseInt((block as unknown as SuiCheckpoint).sequence, 10);
    }
    case 'SVM': {
      return (block as unknown as SvmBlock).parentSlot + 1;
    }
    case 'TON': {
      return (block as unknown as TonBlock).seqno;
    }
    case 'UTXO': {
      return (block as unknown as UtxoBlock).height;
    }
  }

  return null;
}

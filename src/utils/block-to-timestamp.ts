import { blockToVM } from './block-to-vm';
import type { AptosBlock } from '../types/beats/aptos';
import type { CardanoBlock } from '../types/beats/cardano';
import type { CosmosBlock } from '../types/beats/cosmos';
import type { EvmBlock } from '../types/beats/evm';
import type { FilecoinBlock } from '../types/beats/filecoin';
import type { HederaBlock } from '../types/beats/hedera';
import type { RippleLedger } from '../types/beats/ripple';
import type { StarknetBlock } from '../types/beats/starknet';
import type { StellarLedger } from '../types/beats/stellar';
import type { SubstrateBlock } from '../types/beats/substrate';
import type { SuiCheckpoint } from '../types/beats/sui';
import type { SvmBlock } from '../types/beats/svm';
import type { TonBlock } from '../types/beats/ton';
import type { UtxoBlock } from '../types/beats/utxo';

export function blockToTimestamp(block: Record<string, unknown>): Date {
  const vm = blockToVM(block);

  switch (vm) {
    case 'APTOS': {
      const aptosBlock = block as unknown as AptosBlock;
      return new Date(parseInt(aptosBlock.transactions[0].timestamp, 10) / 1_000);
    }
    case 'CARDANO': {
      return new Date((block as unknown as CardanoBlock).timestamp);
    }
    case 'COSMOS': {
      return new Date((block as unknown as CosmosBlock).block.header.time);
    }
    case 'EVM': {
      return new Date((block as unknown as EvmBlock).timestamp * 1000);
    }
    case 'FILECOIN': {
      return new Date((block as unknown as FilecoinBlock).Blocks[0].Timestamp * 1000);
    }
    case 'HEDERA': {
      // Record files carry a consensus window; the block's own time is where it opens.
      // `seconds.nanos` — Date holds milliseconds, so the remainder is truncated, never
      // rounded up past the window.
      const [seconds, nanos = ''] = (block as unknown as HederaBlock).timestamp.from.split('.');
      return new Date(Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, '0')) / 1_000_000));
    }
    case 'RIPPLE': {
      return new Date((block as unknown as RippleLedger).close_time_iso);
    }
    case 'STARKNET': {
      return new Date((block as unknown as StarknetBlock).timestamp * 1000);
    }
    case 'STELLAR': {
      const stellarBlock = block as unknown as StellarLedger;
      return new Date(stellarBlock.transactions[0].created_at);
    }
    case 'SUBSTRATE': {
      const substrateBlock = block as unknown as SubstrateBlock;
      const timestampExtrinsic = substrateBlock.extrinsics.find((ex) => ex.method === 'timestamp.set');
      return new Date(Number(timestampExtrinsic.args[0].toString().replace(/,/g, '')));
    }
    case 'SUI': {
      return new Date(parseInt((block as unknown as SuiCheckpoint).timestamp, 10));
    }
    case 'SVM': {
      return new Date((block as unknown as SvmBlock).blockTime * 1000);
    }
    case 'TON': {
      const tonBlock = block as unknown as TonBlock;
      return new Date(tonBlock.shards?.[0]?.gen_utime * 1000);
    }
    case 'UTXO': {
      return new Date((block as unknown as UtxoBlock).time * 1000);
    }
  }

  return null;
}

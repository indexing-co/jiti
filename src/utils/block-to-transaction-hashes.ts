import { sha256 } from 'viem';
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

export function blockToTransactionHashes(block: Record<string, unknown>): string[] {
  const vm = blockToVM(block);
  const hashes = new Set<string>();

  try {
    switch (vm) {
      case 'APTOS': {
        for (const tx of (block as unknown as AptosBlock).transactions || []) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'CARDANO': {
        for (const tx of (block as unknown as CardanoBlock).transactions || []) {
          hashes.add(tx.transaction_identifier?.hash);
        }
        break;
      }
      case 'COSMOS': {
        const cosmosBlock = block as unknown as CosmosBlock;
        for (const txRaw of cosmosBlock.block.data.txs || []) {
          const txHash = sha256(new Uint8Array(Buffer.from(txRaw, 'base64')));
          hashes.add(txHash.slice(2).toUpperCase());
        }
        break;
      }
      case 'EVM': {
        for (const tx of (block as unknown as EvmBlock).transactions) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'FILECOIN': {
        const filecoinBlock = block as unknown as FilecoinBlock;
        for (const msgGroup of filecoinBlock.messages) {
          const secpkMessages = msgGroup.blockMessages.SecpkMessages || [];
          for (const msg of secpkMessages) {
            hashes.add(msg.CID['/']);
          }
        }
        break;
      }
      case 'RIPPLE': {
        for (const tx of (block as unknown as RippleLedger).transactions || []) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'STARKNET': {
        for (const tx of (block as unknown as StarknetBlock).transactions || []) {
          hashes.add(tx.transaction_hash);
        }
        break;
      }
      case 'STELLAR': {
        for (const tx of (block as unknown as StellarLedger).transactions || []) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'SUBSTRATE': {
        for (const extrinsic of (block as unknown as SubstrateBlock).extrinsics) {
          hashes.add(extrinsic.hash);
        }
        break;
      }
      case 'SUI': {
        for (const tx of (block as unknown as SuiCheckpoint).transactions || []) {
          hashes.add(tx.digest);
        }
        break;
      }
      case 'SVM': {
        for (const tx of (block as unknown as SvmBlock).transactions || []) {
          hashes.add(tx.transaction.signatures[0]);
        }
        break;
      }
      case 'TON': {
        const tonBlock = block as unknown as TonBlock;
        for (const shard of tonBlock.shards || []) {
          for (const tx of shard.transactions || []) {
            hashes.add(tx.transaction_id.hash);
          }
        }
        break;
      }
      case 'UTXO': {
        for (const tx of (block as unknown as UtxoBlock).tx) {
          hashes.add(tx.txid);
        }
        break;
      }
    }

    return Array.from(hashes).filter((v) => v?.length);
  } catch (e) {
    console.error(e);
    return [];
  }
}

import { sha256 } from 'viem';
import { blockToVM } from './block-to-vm';

export function blockToTransactionHashes(block: Record<string, unknown>): string[] {
  const vm = blockToVM(block);
  const hashes = new Set<string>();

  try {
    switch (vm) {
      case 'APTOS': {
        for (const tx of (block.transactions as Record<string, unknown>[]) || []) {
          hashes.add(tx.hash as string);
        }
        break;
      }
      case 'CARDANO': {
        for (const tx of (block.transactions as unknown[]) || []) {
          const typedTx = tx as {
            transaction_identifier?: { hash?: string };
          };
          hashes.add(typedTx.transaction_identifier?.hash);
        }
        break;
      }
      case 'COSMOS': {
        const typedBlock = block as {
          block: { data: { txs?: string[] } };
        };
        for (const txRaw of typedBlock.block.data.txs || []) {
          const txHash = sha256(new Uint8Array(Buffer.from(txRaw, 'base64')));
          hashes.add(txHash.slice(2).toUpperCase());
        }
        break;
      }
      case 'EVM': {
        for (const tx of block.transactions as { hash: string }[]) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'FILECOIN': {
        const typedBlock = block as {
          messages: Array<{
            blockMessages: {
              SecpkMessages?: Array<{
                CID: { '/': string };
              }>;
            };
          }>;
        };

        for (const msgGroup of typedBlock.messages) {
          const secpkMessages = msgGroup.blockMessages.SecpkMessages || [];

          for (const msg of secpkMessages) {
            hashes.add(msg.CID['/']);
          }
        }
        break;
      }
      case 'RIPPLE': {
        for (const tx of (block.transactions as { hash: string }[]) || []) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'STARKNET': {
        for (const tx of (block.transactions as { transaction_hash: string }[]) || []) {
          hashes.add(tx.transaction_hash);
        }
        break;
      }
      case 'STELLAR': {
        for (const tx of (block.transactions as { hash: string }[]) || []) {
          hashes.add(tx.hash);
        }
        break;
      }
      case 'SUBSTRATE': {
        for (const extrinsic of block.extrinsics as { hash: string }[]) {
          hashes.add(extrinsic.hash);
        }
        break;
      }
      case 'SUI': {
        for (const tx of (block.transactions as { digest: string }[]) || []) {
          hashes.add(tx.digest);
        }
        break;
      }
      case 'SVM': {
        for (const tx of (block.transactions as { transaction: { signatures: string[] } }[]) || []) {
          hashes.add(tx.transaction.signatures[0]);
        }
        break;
      }
      case 'TON': {
        for (const shard of (block.shards as any[]) || []) {
          for (const tx of (shard.transactions as any[]) || []) {
            hashes.add(tx.transacion_id.hash as string);
          }
        }
        break;
      }
      case 'UTXO': {
        for (const tx of block.tx as { txid: string }[]) {
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

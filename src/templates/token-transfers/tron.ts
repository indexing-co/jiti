import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import { blockToVM } from '../../utils/block-to-vm';
import { EVMTokenTransfers } from './evm';
import type { TronBlock, TronTrc10Transfer } from '../../types/beats/tron';

// TRON is ingested through the eth-compat (EVM) pacemaker, so the block arrives in
// EVM shape: native TRX surfaces as `tx.value` and TRC-20 as ERC-20 `Transfer` logs
// — both handled correctly by the EVM template. The gap is TRC-10
// (`TransferAssetContract`), a native Tron token type with no EVM analog: the
// eth-compat node maps only its amount into `tx.value` and drops the asset id, so
// EVM emits it as a phantom NATIVE TRX transfer. The oscar ingestion layer recovers
// the dropped asset ids from Tron's native HTTP API and attaches them as `_trc10`;
// here we relabel those phantom natives into their real TRC-10 TOKEN rows.
export const TRONTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'TRON',

  transform(block, _ctx = { params: {} }) {
    // Reuse the full EVM extraction — native TRX + TRC-20 (Transfer logs ride on the
    // receipts the eth-compat path already fetches).
    const evmTransfers = EVMTokenTransfers.transform(block, _ctx) as NetworkTransfer[];

    const trc10 = ((block as unknown as TronBlock)._trc10 || []) as TronTrc10Transfer[];
    if (!trc10.length) {
      return evmTransfers;
    }

    const trc10ByHash = new Map(trc10.map((t) => [t.hash, t]));
    const relabeled = new Set<string>();

    // Relabel the phantom NATIVE that eth-compat produced for each TRC-10 tx (amount
    // → tx.value) into the real TOKEN row, keeping the EVM-computed block / timestamp
    // / gas fee and taking the authoritative asset id + amount + owner/to from the
    // native data.
    const transfers: NetworkTransfer[] = evmTransfers.map((t) => {
      const match = t.tokenType === 'NATIVE' ? trc10ByHash.get(t.transactionHash) : undefined;
      if (!match) {
        return t;
      }
      relabeled.add(match.hash);
      return {
        ...t,
        tokenType: 'TOKEN',
        token: match.token,
        amount: BigInt(match.amount),
        from: match.from,
        to: match.to,
      };
    });

    // Defensive: a TRC-10 tx that left no phantom NATIVE to relabel (a positive-amount
    // asset transfer always sets tx.value, so this should not happen — but never drop
    // a real transfer). Emit it directly, borrowing block/timestamp/fee from any EVM
    // row on the same tx, else the block header.
    const evmByHash = new Map(evmTransfers.map((t) => [t.transactionHash, t]));
    const typedBlock = block as unknown as TronBlock;
    for (const m of trc10) {
      if (relabeled.has(m.hash)) {
        continue;
      }
      const ref = evmByHash.get(m.hash);
      transfers.push({
        amount: BigInt(m.amount),
        blockNumber: ref?.blockNumber ?? Number(typedBlock.number),
        from: m.from,
        timestamp: ref?.timestamp ?? new Date((typedBlock.timestamp as unknown as number) * 1000).toISOString(),
        to: m.to,
        token: m.token,
        tokenType: 'TOKEN',
        transactionGasFee: ref?.transactionGasFee ?? 0n,
        transactionHash: m.hash,
      });
    }

    return transfers;
  },

  tests: [
    {
      // Synthetic TRON block: a native TRX transfer and a TRC-10 transfer. The TRC-10
      // arrives EVM-shaped (its amount in `tx.value`, empty logs) so EVM emits a
      // phantom NATIVE; the `_trc10` supplement (asset id 1005168, à la Mircea's
      // Pay.bi repro) relabels it to a TOKEN, while the genuine native TRX is untouched.
      params: { network: 'TRON' },
      payload: {
        _network: 'TRON',
        number: 84058381,
        timestamp: 1782844609,
        transactions: [
          {
            hash: 'native-trx-hash',
            blockNumber: 84058381,
            from: '0x1111111111111111111111111111111111111111',
            to: '0x2222222222222222222222222222222222222222',
            value: '1000000',
            receipt: { gasUsed: '0', logs: [] },
          },
          {
            hash: 'trc10-hash',
            blockNumber: 84058381,
            from: '0x3333333333333333333333333333333333333333',
            to: '0x4444444444444444444444444444444444444444',
            // eth-compat mapped the TRC-10 amount into value; asset id is gone here.
            value: '4444444444',
            receipt: { gasUsed: '0', logs: [] },
          },
        ],
        _trc10: [
          {
            hash: 'trc10-hash',
            token: '1005168',
            amount: '4444444444',
            from: '0x3333333333333333333333333333333333333333',
            to: '0x4444444444444444444444444444444444444444',
          },
        ],
      },
      output: [
        {
          amount: 1000000n,
          blockNumber: 84058381,
          from: '0x1111111111111111111111111111111111111111',
          timestamp: '2026-06-30T18:36:49.000Z',
          to: '0x2222222222222222222222222222222222222222',
          tokenType: 'NATIVE',
          transactionGasFee: 0n,
          transactionHash: 'native-trx-hash',
        },
        {
          amount: 4444444444n,
          blockNumber: 84058381,
          from: '0x3333333333333333333333333333333333333333',
          timestamp: '2026-06-30T18:36:49.000Z',
          to: '0x4444444444444444444444444444444444444444',
          token: '1005168',
          tokenType: 'TOKEN',
          transactionGasFee: 0n,
          transactionHash: 'trc10-hash',
        },
      ],
    },
  ],
};

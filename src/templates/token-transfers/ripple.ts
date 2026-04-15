import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { RippleLedger } from '../../types/beats/ripple';

export const RippleTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'RIPPLE',

  transform(block) {
    let transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as RippleLedger;

    if (!Array.isArray(typedBlock.transactions)) {
      return [];
    }

    for (const typedTx of typedBlock.transactions || []) {
      if (typedTx.TransactionType !== 'Payment') {
        continue;
      }
      // Failed XRPL payments still burn Fee. Emit a fee-only transfer (to: null) so
      // callers account for the gas, and skip the payment amount that never landed.
      if (typedTx.metaData?.TransactionResult && typedTx.metaData.TransactionResult !== 'tesSUCCESS') {
        transfers.push({
          amount: BigInt(typedTx.Fee ?? '0'),
          blockNumber: parseInt(typedBlock.ledger_index, 10),
          from: typedTx.Account ?? 'UNKNOWN',
          memo: typedTx.DestinationTag,
          timestamp: typedBlock.close_time_iso || null,
          to: null,
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: BigInt(typedTx.Fee ?? '0'),
          transactionHash: typedTx.hash ?? '',
        });
        continue;
      }
      const deliveredOrAmount = (typedTx.metaData?.delivered_amount ?? typedTx.Amount ?? '0') as
        | string
        | { currency: string; issuer: string; value: string };
      let tokenSymbol = 'XRP';
      let tokenType: 'NATIVE' | 'TOKEN' | 'NFT' = 'NATIVE';

      let parsedAmount: bigint;

      if (typeof deliveredOrAmount === 'object') {
        tokenSymbol = deliveredOrAmount.currency?.toUpperCase() ?? 'UNKNOWN';
        tokenType = 'TOKEN';
        const floatVal = parseFloat(deliveredOrAmount.value);
        const smallestUnit = Math.round(floatVal * 1_000_000);
        parsedAmount = BigInt(smallestUnit);
      } else {
        parsedAmount = BigInt(String(deliveredOrAmount));
      }
      transfers.push({
        amount: parsedAmount,
        blockNumber: parseInt(typedBlock.ledger_index, 10),
        from: typedTx.Account ?? 'UNKNOWN',
        memo: typedTx.DestinationTag,
        timestamp: typedBlock.close_time_iso || null,
        to: typedTx.Destination ?? 'UNKNOWN',
        token: tokenSymbol,
        tokenType: tokenType,
        transactionGasFee: BigInt(typedTx.Fee ?? '0'),
        transactionHash: typedTx.hash ?? '',
      });
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'RIPPLE',
        walletAddress: 'rnDGxzUM2snx58Bvyn72xhJKqvkDxo2tQm',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ripple/88104659',
      output: [
        {
          amount: 43110000n,
          blockNumber: 88104659,
          from: 'rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G',
          memo: 30195674,
          timestamp: '2024-05-19T22:18:52Z',
          to: 'rnDGxzUM2snx58Bvyn72xhJKqvkDxo2tQm',
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 10000n,
          transactionHash: 'B32A6A5455777283212407FBD8CCA701505C654E5F4ADFFBE9D4D22F00889D87',
        },
      ],
    },
    // Failed XRPL payments emit ONLY a fee transfer (to: null) — the payment Amount
    // never reached the Destination, but the Fee was still burned.
    {
      params: { network: 'RIPPLE' },
      payload: {
        _network: 'RIPPLE',
        ledger_index: '100000000',
        close_time_iso: '2026-04-04T08:02:44Z',
        transactions: [
          {
            TransactionType: 'Payment',
            Account: 'rFAILFROMxxxxxxxxxxxxxxxxxxxxxxxxx',
            Destination: 'rFAILTOxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Amount: '1000000',
            Fee: '10',
            hash: 'FAILEDXRPLTXHASH',
            metaData: { TransactionResult: 'tecPATH_DRY' },
          },
        ],
      },
      output: [
        {
          amount: 10n,
          blockNumber: 100000000,
          from: 'rFAILFROMxxxxxxxxxxxxxxxxxxxxxxxxx',
          memo: undefined,
          timestamp: '2026-04-04T08:02:44Z',
          to: null,
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 10n,
          transactionHash: 'FAILEDXRPLTXHASH',
        },
      ],
    },
  ],
};

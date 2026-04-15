import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { StellarLedger } from '../../types/beats/stellar';

export const StellarTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'STELLAR',

  transform(block) {
    let transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as StellarLedger;

    for (const typedTx of typedBlock.transactions || []) {
      // Failed txs still burn fee_charged — emit a fee transfer (to: null) so callers
      // can account for the gas, but skip the payment ops that never actually moved funds.
      if (!typedTx.successful) {
        transfers.push({
          amount: BigInt(typedTx.fee_charged),
          blockNumber: typedBlock.sequence,
          from: typedTx.source_account,
          memo: typedTx.memo,
          timestamp: typedTx.created_at,
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: BigInt(typedTx.fee_charged),
          transactionHash: typedTx.hash,
        });
        continue;
      }
      for (const op of typedTx.operations) {
        if (op.type === 'payment') {
          transfers.push({
            amount: BigInt(op.amount.replace('.', '')),
            blockNumber: typedBlock.sequence,
            from: op.from,
            memo: typedTx.memo,
            timestamp: typedTx.created_at,
            to: op.to,
            token: op.asset_type === 'native' ? null : op.asset_issuer,
            tokenType: op.asset_type === 'native' ? 'NATIVE' : 'TOKEN',
            transactionGasFee: BigInt(typedTx.fee_charged),
            transactionHash: typedTx.hash,
          });
        }
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'STELLAR',
        walletAddress: 'GC5HUFIKZBK5XRNOBPXR4PBR3PWR26GP5UFRKSCOOOIENYVSF3NMA23U',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/59592273',
      output: [
        {
          amount: 651200000n,
          blockNumber: 59592273,
          from: 'GC5HUFIKZBK5XRNOBPXR4PBR3PWR26GP5UFRKSCOOOIENYVSF3NMA23U',
          memo: '315004227',
          timestamp: '2025-10-28T17:24:17Z',
          to: 'GABFQIK63R2NETJM7T673EAMZN4RJLLGP3OFUEJU5SZVTGWUKULZJNL6',
          token: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          tokenType: 'TOKEN',
          transactionGasFee: 200n,
          transactionHash: 'a0e5f0cbc64a13816db1d8428c4e2f849ed9ec475b80d4cbd23a8119b1b1c010',
        },
        {
          amount: 4445100000n,
          blockNumber: 59592273,
          from: 'GAUA7XL5K54CC2DDGP77FJ2YBHRJLT36CPZDXWPM6MP7MANOGG77PNJU',
          memo: undefined,
          timestamp: '2025-10-28T17:24:17Z',
          to: 'GC5HUFIKZBK5XRNOBPXR4PBR3PWR26GP5UFRKSCOOOIENYVSF3NMA23U',
          token: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          tokenType: 'TOKEN',
          transactionGasFee: 300n,
          transactionHash: 'c554aed41145304e03c0877c9de526cdcb8a8255c9bf156ff0dec202ab12e20d',
        },
      ],
    },
    // Failed Stellar txs emit ONLY a fee transfer (to: null), never the failed payment
    // operations. Ledger 61961851 / tx 9024ba4b... is the Mesh incident — the source
    // tried to send 1_000_000_000 stroops to GAGLH6..., the tx reverted, and the only
    // on-chain effect was the 100-stroop fee being charged.
    {
      params: {
        network: 'STELLAR',
        transactionHash: '9024ba4b558b09042cb02afd1d46eea72597891691801375acee332273c5c26d',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/61961851',
      output: [
        {
          amount: 100n,
          blockNumber: 61961851,
          from: 'GCP7I54JXTOZ4SJG4UARWJOMJ25JQXRHSHXQWDSV4TRVRJFDG67VUEXP',
          memo: undefined,
          timestamp: '2026-04-04T08:02:44Z',
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 100n,
          transactionHash: '9024ba4b558b09042cb02afd1d46eea72597891691801375acee332273c5c26d',
        },
      ],
    },
  ],
};

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
  ],
};

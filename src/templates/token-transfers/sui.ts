import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { SuiCheckpoint } from '../../types/beats/sui';

export const SUITokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'SUI',

  transform(block) {
    let transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as SuiCheckpoint;

    const blockNumber = parseInt(typedBlock.sequence, 10);
    const blockTimestamp = new Date(parseInt(typedBlock.timestamp, 10)).toISOString();

    const transactions = typedBlock.transactions || [];
    for (const tx of transactions) {
      const transactionHash = tx.digest;

      let transactionGasFee = BigInt(0);
      if (tx.effects?.gasUsed) {
        const gu = tx.effects.gasUsed;
        transactionGasFee =
          BigInt(gu.computationCost) +
          BigInt(gu.storageCost) -
          BigInt(gu.storageRebate) +
          BigInt(gu.nonRefundableStorageFee);
        if (transactionGasFee < 0n) {
          transactionGasFee = 0n;
        }
      }
      const balanceChanges = tx.balanceChanges || [];
      for (const bc of balanceChanges) {
        let rawAmt = BigInt(bc.amount);
        if (rawAmt === 0n) continue;

        let fromAddr: string | undefined;
        let toAddr: string | undefined;

        const rawOwner =
          (bc.owner as any)?.AddressOwner ||
          (bc.owner as any)?.ObjectOwner ||
          (bc.owner as any)?.Shared?.initial_shared_version ||
          'UNKNOWN_OWNER';

        if (rawAmt < 0n) {
          fromAddr = String(rawOwner);
          toAddr = undefined;
          rawAmt = -rawAmt;
        } else {
          fromAddr = undefined;
          toAddr = String(rawOwner);
        }

        transfers.push({
          blockNumber,
          from: fromAddr,
          to: toAddr,
          amount: rawAmt,
          token: bc.coinType,
          tokenType: 'NATIVE',
          timestamp: blockTimestamp,
          transactionHash,
          transactionGasFee,
        });
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'SUI',
        walletAddress: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/sui/132734364',
      output: [
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 5321172n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: '4JWC8DX8eKYhwvRgzesGNWsb5t5RUyQVSNibKxLRaN22',
          transactionGasFee: 5408344n,
        },
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 825772n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: '5bXBDeoYqXTawkf2bCDriAE2M6Vu2EgYKEgJ1hW4qagZ',
          transactionGasFee: 901544n,
        },
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 5321248n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: '6KZYwvaAk76AL9p5kjkA27Tj5Jy47ipCxLKiCXtBbngo',
          transactionGasFee: 5408496n,
        },
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 5321096n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: 'HcJAHtSUypt8z2us2HqDm7PzB5HKS3ASY86pDKNAsgnE',
          transactionGasFee: 5408192n,
        },
      ],
    },
  ],
};

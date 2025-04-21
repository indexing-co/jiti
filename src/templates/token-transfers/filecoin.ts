import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';

export const FilecoinTokenTransfers: SubTemplate = {
  match: (block) => ['FILECOIN'].includes(block._network as string),

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as {
      Height: number;
      Blocks: Array<{ ParentBaseFee: string; Timestamp: number }>;
      messages: Array<{
        blockMessages: {
          BlsMessages?: Array<unknown>;
          SecpkMessages?: Array<{
            Message: {
              From: string;
              To: string;
              Value: string;
              GasFeeCap: string;
              GasPremium: string;
            };
            CID: { '/': string };
          }>;
        };
      }>;
      receipts: Array<{ GasUsed: number }>;
    };

    const blockNumber = typedBlock.Height;
    const blockTimestamp = new Date(typedBlock.Blocks[0].Timestamp * 1000).toISOString();
    const parentBaseFee = BigInt(typedBlock.Blocks[0].ParentBaseFee);

    let receiptIndex = 0;

    for (const msgGroup of typedBlock.messages) {
      const secpkMessages = msgGroup.blockMessages.SecpkMessages || [];

      for (const msg of secpkMessages) {
        const receipt = typedBlock.receipts[receiptIndex++];
        const gasUsed = receipt ? BigInt(receipt.GasUsed) : BigInt(0);
        const gasFeeCap = BigInt(msg.Message.GasFeeCap);
        const gasPremium = BigInt(msg.Message.GasPremium);
        const baseFeeBurn = gasUsed * parentBaseFee;
        const minerTip = gasUsed * (gasPremium < gasFeeCap - parentBaseFee ? gasPremium : gasFeeCap - parentBaseFee);
        const transactionGasFee = baseFeeBurn + minerTip;

        transfers.push({
          amount: BigInt(msg.Message.Value),
          blockNumber,
          from: msg.Message.From,
          to: msg.Message.To,
          token: null,
          tokenType: 'NATIVE',
          timestamp: blockTimestamp,
          transactionGasFee,
          transactionHash: msg.CID['/'],
        });
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'FILECOIN',
        walletAddress: 'f1e3aa3z6gkaqxxwmbbna5gf2frggswwjaeavx7bq',
      },
      payload: 'https://jiti.indexing.co/networks/filecoin/4818438',
      output: [
        {
          amount: 7896300000000000000n,
          blockNumber: 4818438,
          from: 'f1e3aa3z6gkaqxxwmbbna5gf2frggswwjaeavx7bq',
          timestamp: '2025-03-24T23:39:00.000Z',
          to: 'f1bqdligg7ipuiizvmdn7ijobhbkwaieh6z6lah5y',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 1592498365133760n,
          transactionHash: 'bafy2bzacecxud3tayyq3caagjej5srufcx5fufjuqkz3ltgfty27wdsrmqeew',
        },
      ],
    },
  ],
};

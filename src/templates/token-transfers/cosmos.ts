import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes as defaultStargateTypes } from '@cosmjs/stargate';
import { sha256 } from 'viem';

import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import blockToVM from '../../utils/block-to-vm';

export const CosmosTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'COSMOS',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as {
      block: { header: { height: string; time: string }; data: { txs?: string[] } };
      block_id: { hash: string };
    };

    const blockNumber = Number(typedBlock.block.header.height);
    const blockTimestamp = new Date(typedBlock.block.header.time).toISOString();

    for (const txRaw of typedBlock.block.data.txs || []) {
      const decoded = decodeTxRaw(new Uint8Array(Buffer.from(txRaw, 'base64')));
      const txHash = sha256(new Uint8Array(Buffer.from(txRaw, 'base64')));
      const transactionGasFee = BigInt(decoded.authInfo.fee?.amount?.[0]?.amount || '0');

      const registry = new Registry(defaultStargateTypes);
      for (const message of decoded.body.messages) {
        if (['/ibc.applications.transfer.v1.MsgTransfer', '/cosmos.bank.v1beta1.MsgSend'].includes(message.typeUrl)) {
          const decodedMsg = registry.decode(message);
          transfers.push({
            blockNumber,
            from: decodedMsg.sender,
            to: decodedMsg.receiver,
            amount: BigInt(decodedMsg.token.amount),
            token: decodedMsg.token.denom,
            tokenType: 'NATIVE',
            timestamp: blockTimestamp,
            transactionHash: txHash.slice(2).toUpperCase(),
            transactionGasFee,
          });
        }
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'COSMOS',
        walletAddress: 'cosmos1x4qvmtcfc02pklttfgxzdccxcsyzklrxavteyz',
        contractAddress: 'ibc/F663521BF1836B00F5F177680F74BFB9A8B5654A694D0D2BC249E03CF2509013',
      },
      payload: 'https://jiti.indexing.co/networks/cosmos/24419691',
      output: [
        {
          blockNumber: 24419691,
          from: 'cosmos1x4qvmtcfc02pklttfgxzdccxcsyzklrxavteyz',
          to: 'noble1x4qvmtcfc02pklttfgxzdccxcsyzklrx4073uv',
          amount: 500000n,
          token: 'ibc/F663521BF1836B00F5F177680F74BFB9A8B5654A694D0D2BC249E03CF2509013',
          tokenType: 'NATIVE',
          timestamp: '2025-02-14T21:48:22.809Z',
          transactionHash: '963D4D7BB59C1280F58A7ECA2F1934E2AA005109A989193C815C7B98EDCD7445',
          transactionGasFee: 4860n,
        },
      ],
    },
  ],
};

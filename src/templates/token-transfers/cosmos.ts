import { DecodedTxRaw, decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes as defaultStargateTypes } from '@cosmjs/stargate';
import { sha256 } from 'viem';

import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import { blockToVM } from '../../utils/block-to-vm';
import type { CosmosBlock } from '../../types/beats/cosmos';

export const CosmosTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'COSMOS',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as unknown as CosmosBlock;

    const blockNumber = Number(typedBlock.block.header.height);
    const blockTimestamp = new Date(typedBlock.block.header.time).toISOString();

    for (const txRaw of typedBlock.block.data.txs || []) {
      let decoded: DecodedTxRaw;
      try {
        decoded = decodeTxRaw(new Uint8Array(Buffer.from(txRaw, 'base64')));
      } catch (e) {
        continue;
      }
      const txHash = sha256(new Uint8Array(Buffer.from(txRaw, 'base64')));
      const transactionGasFee = BigInt(decoded.authInfo.fee?.amount?.[0]?.amount || '0');

      const registry = new Registry(defaultStargateTypes);
      for (const message of decoded.body.messages) {
        if (['/ibc.applications.transfer.v1.MsgTransfer', '/cosmos.bank.v1beta1.MsgSend'].includes(message.typeUrl)) {
          const decodedMsg = registry.decode(message);
          transfers.push({
            amount: BigInt(decodedMsg.token?.amount || decodedMsg.amount?.find((a) => a?.amount)?.amount || 0),
            blockNumber,
            from: decodedMsg.sender || decodedMsg.fromAddress,
            memo: decodedMsg.memo,
            timestamp: blockTimestamp,
            to: decodedMsg.receiver || decodedMsg.toAddress,
            token: decodedMsg.token?.denom || decodedMsg.amount?.find((a) => a?.denom)?.denom,
            tokenType: 'NATIVE',
            transactionGasFee,
            transactionHash: txHash.slice(2).toUpperCase(),
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
        walletAddress: 'cosmos1q9d0rjr687a37lckllujf6dmtnympx9g5ca37u',
      },
      payload: 'https://jiti.indexing.co/networks/cosmos/28168958',
      output: [
        {
          amount: 31684895n,
          blockNumber: 28168958,
          from: 'cosmos1q9d0rjr687a37lckllujf6dmtnympx9g5ca37u',
          memo: '{"wasm":{"contract":"neutron1zvesudsdfxusz06jztpph4d3h5x6veglqsspxns2v2jqml9nhywskcc923","msg":{"swap_and_action":{"user_swap":{"swap_exact_asset_in":{"swap_venue_name":"neutron-duality","operations":[{"pool":"564172","denom_in":"ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9","denom_out":"ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81"},{"pool":"495849","denom_in":"ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81","denom_out":"ibc/376222D6D9DAE23092E29740E56B758580935A6D77C24C2ABD57A6A78A1F3955"}]}},"min_asset":{"native":{"denom":"ibc/376222D6D9DAE23092E29740E56B758580935A6D77C24C2ABD57A6A78A1F3955","amount":"817899530"}},"timeout_timestamp":1761673107828834380,"post_swap_action":{"ibc_transfer":{"ibc_info":{"source_channel":"channel-10","receiver":"osmo1q9d0rjr687a37lckllujf6dmtnympx9gurwpgw","fee":{"recv_fee":[],"ack_fee":[{"denom":"untrn","amount":"100000"}],"timeout_fee":[{"denom":"untrn","amount":"100000"}]},"memo":"","recover_address":"neutron1q9d0rjr687a37lckllujf6dmtnympx9gs85nym"},"fee_swap":{"swap_venue_name":"neutron-duality","operations":[{"pool":"2769551","denom_in":"ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9","denom_out":"ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81"},{"pool":"717963","denom_in":"ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81","denom_out":"untrn"}],"refund_address":"neutron1q9d0rjr687a37lckllujf6dmtnympx9gs85nym"}}},"affiliates":[{"basis_points_fee":"60","address":"neutron15tw0qy5sspq2sgef77vhhykhtphlrv57ju78e4"},{"basis_points_fee":"15","address":"neutron14gf6xslwe9phn2z965t4dcu7vchhthfgqw99g3"}]}}}}',
          timestamp: '2025-10-28T17:33:35.080Z',
          to: 'neutron1zvesudsdfxusz06jztpph4d3h5x6veglqsspxns2v2jqml9nhywskcc923',
          token: 'uatom',
          tokenType: 'NATIVE',
          transactionGasFee: 2201n,
          transactionHash: 'DA3680301DEB2C5D4F12F695C252CB75612792952AD12A699C80B261E8A029E3',
        },
      ],
    },
  ],
};

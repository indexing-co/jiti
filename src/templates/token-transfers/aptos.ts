import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';

export const AptosTokenTransfers: SubTemplate = {
  match: (block) => ['APTOS', 'APTOS_TESTNET'].includes(block._network as string),

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    for (const tx of block.transactions as Record<string, unknown>[]) {
      if (!tx?.events || !Array.isArray(tx.events)) {
        continue;
      }

      const timestamp = tx.timestamp ? new Date(parseInt(tx.timestamp as string, 10) / 1_000).toISOString() : null;

      const transfersByKey: Record<
        string,
        {
          amount: string;
          tokenAddress?: string;
          from?: string;
          to?: string;
        }
      > = {};

      for (const evt of tx.events as Record<string, unknown>[]) {
        const evtType = evt.type as string;
        if (/::(Withdraw|Deposit)[^:]*/.test(evtType)) {
          const data = evt.data as Record<string, any>;
          const amount = data.amount as string;
          const accountAddr = data.store_owner || (evt.guid as { account_address?: string })?.account_address || '';

          let tokenAddr = '0x1::aptos_coin::AptosCoin';
          if (data.store) {
            tokenAddr =
              (tx.changes as { address: string; data: { type: string; data: { metadata: { inner: string } } } }[]).find(
                (c) => c.address === data.store && c.data.type === '0x1::fungible_asset::FungibleStore'
              )?.data?.data?.metadata?.inner || data.store;
          }

          const compositeKey = `${tx.hash}-${tokenAddr}-${amount}`;
          if (!transfersByKey[compositeKey]) {
            transfersByKey[compositeKey] = {
              amount,
              tokenAddress: tokenAddr,
            };
          }

          if (/::Withdraw[^:]*/.test(evtType)) {
            transfersByKey[compositeKey].from = accountAddr;
          } else {
            transfersByKey[compositeKey].to = accountAddr;
          }
        }
      }

      for (const partial of Object.values(transfersByKey)) {
        if (!partial.from || !partial.to) {
          continue;
        }

        const fromAddr = partial.from.length < 66 ? `0x0${partial.from.slice(2)}` : partial.from;
        const toAddr = partial.to.length < 66 ? `0x0${partial.to.slice(2)}` : partial.to;

        let finalToken: string | null = null;
        let finalTokenType: 'NATIVE' | 'TOKEN' | 'NFT' = 'TOKEN';

        if (partial.tokenAddress?.toLowerCase().includes('aptos_coin')) {
          finalToken = null;
        } else {
          finalToken = partial.tokenAddress?.toLowerCase();
        }

        const gasUsed = BigInt((tx.gas_used as string) || '0');

        transfers.push({
          amount: BigInt(partial.amount),
          blockNumber: parseInt(block.block_height as string, 10),
          from: fromAddr,
          to: toAddr,
          timestamp,
          token: finalToken,
          tokenType: finalTokenType,
          transactionGasFee: gasUsed,
          transactionHash: tx.hash as string,
        });
      }
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'APTOS',
        walletAddress: '0x5bd7de5c56d5691f32ea86c973c73fec7b1445e59736c97158020018c080bb00',
      },
      payload: 'https://jiti.indexing.co/networks/aptos/297956660',
      output: [
        {
          amount: 1611839920n,
          blockNumber: 297956660,
          from: '0x5bd7de5c56d5691f32ea86c973c73fec7b1445e59736c97158020018c080bb00',
          to: '0x3b5d2e7e8da86903beb19d5a7135764aac812e18af193895d75f3a8f6a066cb0',
          timestamp: '2025-03-02T21:07:06.002Z',
          token: null,
          tokenType: 'TOKEN',
          transactionGasFee: 13n,
          transactionHash: '0xfbdef795d11df124cca264f3370b09fb04fb1c1d24a2d2e1df0693c096a76d13',
        },
        {
          amount: 1502138836n,
          blockNumber: 297956660,
          from: '0x5bd7de5c56d5691f32ea86c973c73fec7b1445e59736c97158020018c080bb00',
          to: '0x04b2b6bc8c2c5794c51607c962f482593f9b5ea09373a8ce249a1f799cca7a1e',
          timestamp: '2025-03-02T21:07:06.002Z',
          token: null,
          tokenType: 'TOKEN',
          transactionGasFee: 13n,
          transactionHash: '0xfbdef795d11df124cca264f3370b09fb04fb1c1d24a2d2e1df0693c096a76d13',
        },
      ],
    },
    {
      params: {
        network: 'APTOS',
        contractAddress: '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b',
      },
      payload: 'https://jiti.indexing.co/networks/aptos/303623631',
      output: [
        {
          amount: 1000060n,
          blockNumber: 303623631,
          from: '0xa4e7455d27731ab857e9701b1e6ed72591132b909fe6e4fd99b66c1d6318d9e8',
          timestamp: '2025-03-14T15:39:49.845Z',
          to: '0x9317336bfc9ba6987d40492ddea8d41e11b7c2e473f3556a9c82309d326e79ce',
          token: '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0x24b8854bad1f6543b35069eacd6ec40a583ca7fa452b422b04d747d24b65279c',
        },
      ],
    },
  ],
};

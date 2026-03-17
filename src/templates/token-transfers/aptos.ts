import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { AptosBlock } from '../../types/beats/aptos';

export const AptosTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'APTOS',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as unknown as AptosBlock;

    for (const tx of (typedBlock.transactions as unknown as Record<string, unknown>[]) || []) {
      if (!tx?.events || !Array.isArray(tx.events)) {
        continue;
      }

      const timestamp = tx.timestamp ? new Date(parseInt(tx.timestamp as string, 10) / 1_000).toISOString() : null;
      const gasUsed = BigInt((tx.gas_used as string) || '0');

      const transfersByKey: Record<
        string,
        {
          amount: string;
          tokenAddress?: string;
          from?: string;
          to?: string;
        }
      > = {};

      const sender = tx.sender as string;
      const accountAddressMap: Record<string, string> = {};
      const changes = tx.changes as {
        address: string;
        data: {
          data: { balance: string; metadata?: { inner: string }; owner?: string };
          type: string;
        };
      }[];

      for (let ci = 0; ci < changes.length; ci += 1) {
        if (!changes[ci]?.data) continue;
        const {
          address: accountAddress,
          data: { data: changeData, type: changeType },
        } = changes[ci];
        const { balance, metadata, owner } = changeData || {};

        if (changeType === '0x1::fungible_asset::FungibleStore') {
          if (!accountAddressMap[accountAddress]) {
            accountAddressMap[accountAddress] = changes[ci + 1]?.data?.data?.owner;
          }
          const to = accountAddressMap[accountAddress];
          const tokenAddress = metadata?.inner;
          if (!to || !tokenAddress || to === sender) continue;
          transfers.push({
            amount: BigInt(balance),
            blockNumber: parseInt(typedBlock.block_height, 10),
            from: sender,
            to,
            timestamp,
            token: tokenAddress,
            tokenType: 'TOKEN',
            transactionGasFee: gasUsed,
            transactionHash: tx.hash as string,
          });
        } else if (owner?.length > 4) {
          const payload = tx.payload as { function: string; arguments: string[]; type_arguments?: string[] };
          if (payload && payload.function === '0x1::aptos_account::transfer_coins') {
            const coinType = payload.type_arguments?.[0];
            const isNative = !coinType || coinType.toLowerCase().includes('aptos_coin');
            transfers.push({
              amount: BigInt(payload.arguments[1]),
              blockNumber: parseInt(typedBlock.block_height, 10),
              from: sender,
              to: owner,
              timestamp,
              token: isNative ? null : coinType.toLowerCase(),
              tokenType: isNative ? 'NATIVE' : 'TOKEN',
              transactionGasFee: gasUsed,
              transactionHash: tx.hash as string,
            });
          }
        }
      }

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
        if (partial.to === '0x00') continue;

        let finalToken: string | null = null;
        let finalTokenType: NetworkTransfer['tokenType'] = 'TOKEN';

        if (partial.tokenAddress?.toLowerCase().includes('aptos_coin')) {
          finalToken = null;
        } else {
          finalToken = partial.tokenAddress?.toLowerCase();
        }

        transfers.push({
          amount: BigInt(partial.amount || 0),
          blockNumber: parseInt(typedBlock.block_height, 10),
          from: partial.from,
          to: partial.to,
          timestamp,
          token: finalToken,
          tokenType: finalTokenType,
          transactionGasFee: gasUsed,
          transactionHash: tx.hash as string,
        });
      }
    }

    return transfers
      .filter((txfer) => txfer.to?.length > 4)
      .map((txfer) => {
        const fromAddr = txfer.from.length < 66 ? `0x${txfer.from.slice(2).padStart(64, '0')}` : txfer.from;
        const toAddr = txfer.to.length < 66 ? `0x${txfer.to.slice(2).padStart(64, '0')}` : txfer.to;
        return {
          ...txfer,
          from: fromAddr,
          to: toAddr,
        };
      });
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
          amount: 3000160n,
          blockNumber: 303623631,
          from: '0xa4e7455d27731ab857e9701b1e6ed72591132b909fe6e4fd99b66c1d6318d9e8',
          timestamp: '2025-03-14T15:39:49.845Z',
          to: '0x9317336bfc9ba6987d40492ddea8d41e11b7c2e473f3556a9c82309d326e79ce',
          token: '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0x24b8854bad1f6543b35069eacd6ec40a583ca7fa452b422b04d747d24b65279c',
        },
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

    {
      params: {
        network: 'APTOS',
        contractAddress: '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b',
        walletAddress: '0x1a07942979574456e8197ac0ba8e3bfcf93d7922493cc3ca0c6b46b580b0a47e',
      },
      payload: 'https://jiti.indexing.co/networks/aptos/326121833',
      output: [
        {
          amount: 10000000n,
          blockNumber: 326121833,
          from: '0xd91c64b777e51395c6ea9dec562ed79a4afa0cd6dad5a87b187c37198a1f855a',
          timestamp: '2025-04-19T08:57:28.135Z',
          to: '0x1a07942979574456e8197ac0ba8e3bfcf93d7922493cc3ca0c6b46b580b0a47e',
          token: '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b',
          tokenType: 'TOKEN',
          transactionGasFee: 10877n,
          transactionHash: '0xc5a21679a947f986908b09091516bc3896245d974686ca2bd5709b7dbc5118fb',
        },
      ],
    },

    {
      params: {
        network: 'APTOS',
        contractAddress: '',
        walletAddress: '0x089556578008574ed3fddda6bc2ea6bee475b042e237bbb2f447c263086edcc5',
      },
      payload: 'https://jiti.indexing.co/networks/aptos/403873552',
      output: [
        {
          amount: 19500000n,
          blockNumber: 403873552,
          from: '0x8509aa39bc09ea530b0481c573c0215781c01fa363c135996614bb11cf337703',
          timestamp: '2025-08-11T11:07:54.286Z',
          to: '0x089556578008574ed3fddda6bc2ea6bee475b042e237bbb2f447c263086edcc5',
          token: '0xa',
          tokenType: 'TOKEN',
          transactionGasFee: 18n,
          transactionHash: '0xa7d2d682f6940c1023d95ae8950b8d1dc0604abd34a4a2cc654f1be6f330ca44',
        },
        {
          amount: 9500000n,
          blockNumber: 403873552,
          from: '0x8509aa39bc09ea530b0481c573c0215781c01fa363c135996614bb11cf337703',
          timestamp: '2025-08-11T11:07:54.286Z',
          to: '0x089556578008574ed3fddda6bc2ea6bee475b042e237bbb2f447c263086edcc5',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 18n,
          transactionHash: '0xa7d2d682f6940c1023d95ae8950b8d1dc0604abd34a4a2cc654f1be6f330ca44',
        },
      ],
    },

    // transfer_coins with non-native token (PROPS) — should NOT produce token: null
    // Bug: the transfer_coins code path blindly sets token: null, tokenType: 'NATIVE'
    // even when type_arguments indicates a non-native coin
    {
      params: {
        network: 'APTOS',
        transactionHash: '0xaaec78039e7392b430c554bc33291c2786a1c92669e8f8f88280f419b0792d29',
      },
      payload: 'https://jiti.indexing.co/networks/aptos/661127894',
      output: [
        {
          amount: 18740000000000n,
          blockNumber: 661127894,
          from: '0xaa0090c74e4976834ff1b9b9ef945e1c4b6cdb49cccf37c2554ef026081312f1',
          to: '0xaa0090c74e4976834ff1b9b9ef945e1c4b6cdb49cccf37c2554ef026081312f1',
          timestamp: '2026-03-13T15:33:48.659Z',
          token: '0xe50684a338db732d8fb8a3ac71c4b8633878bd0193bca5de2ebc852a83b35099::propbase_coin::props',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0xaaec78039e7392b430c554bc33291c2786a1c92669e8f8f88280f419b0792d29',
        },
        {
          amount: 53458526229170n,
          blockNumber: 661127894,
          from: '0xaa0090c74e4976834ff1b9b9ef945e1c4b6cdb49cccf37c2554ef026081312f1',
          to: '0xf520886f20b097e2e2e4116ab66d943f13a3f107d2ba09f6f1abc38e872b234c',
          timestamp: '2026-03-13T15:33:48.659Z',
          token: '0x6dba1728c73363be1bdd4d504844c40fbb893e368ccbeff1d1bd83497dbc756d',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0xaaec78039e7392b430c554bc33291c2786a1c92669e8f8f88280f419b0792d29',
        },
        {
          amount: 18740000000000n,
          blockNumber: 661127894,
          from: '0xaa0090c74e4976834ff1b9b9ef945e1c4b6cdb49cccf37c2554ef026081312f1',
          to: '0xf520886f20b097e2e2e4116ab66d943f13a3f107d2ba09f6f1abc38e872b234c',
          timestamp: '2026-03-13T15:33:48.659Z',
          token: '0xe50684a338db732d8fb8a3ac71c4b8633878bd0193bca5de2ebc852a83b35099::propbase_coin::props',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0xaaec78039e7392b430c554bc33291c2786a1c92669e8f8f88280f419b0792d29',
        },
      ],
    },
  ],
};

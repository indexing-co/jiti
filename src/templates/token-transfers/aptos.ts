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

      const legs: Record<string, { token: string; amount: string; froms: string[]; tos: string[] }> = {};

      const changes =
        (tx.changes as {
          address: string;
          data: {
            data: { metadata?: { inner: string }; owner?: string };
            type: string;
          };
        }[]) || [];

      // Fungible-asset Deposit/Withdraw events carry only the fungible-store
      // object address, not its owner (guid.account_address is 0x0 and older
      // events omit store_owner). The owner is recoverable from the store's
      // 0x1::object::ObjectCore change, present in the same tx — build a
      // store -> owner map so the events pass below resolves real accounts.
      const storeOwner: Record<string, string> = {};
      for (const change of changes) {
        if (change?.data?.type === '0x1::object::ObjectCore' && change.data.data?.owner) {
          storeOwner[change.address] = change.data.data.owner;
        }
      }

      // Group canonical Withdraw + Deposit half-legs by (token, amount). Only
      // the framework's own 0x1::fungible_asset / 0x1::coin events are
      // authoritative — an asset module may ALSO emit its own
      // <module>::{Withdraw,Deposit} for the same movement (e.g. a stablecoin),
      // which must not be double-counted. Excluding those non-framework
      // duplicates here (rather than relying on the (token, amount) bucket to
      // collapse them) means each bucket holds one entry per REAL half-leg, so N
      // distinct transfers of the same asset + amount in one tx are preserved
      // instead of collapsed into one.
      const canonical = /^0x1::(fungible_asset::(Withdraw|Deposit)|coin::(Withdraw|Deposit)Event)$/;
      for (const evt of tx.events as Record<string, unknown>[]) {
        const evtType = evt.type as string;
        if (!canonical.test(evtType)) {
          continue;
        }

        const data = evt.data as Record<string, any>;
        const amount = data.amount as string;
        const accountAddr =
          data.store_owner ||
          (data.store ? storeOwner[data.store as string] : undefined) ||
          (evt.guid as { account_address?: string })?.account_address ||
          '';

        // Resolve the asset id. Fungible-asset events carry a `store` whose
        // metadata object is the asset; legacy coin events carry no store — the
        // coin type is the <T> of the owner's 0x1::coin::CoinStore<T> change.
        // Defaulting to APT only when neither resolves avoids mislabeling a
        // non-APT legacy coin as native.
        let tokenAddr = '0x1::aptos_coin::AptosCoin';
        if (data.store) {
          tokenAddr =
            changes.find((c) => c.address === data.store && c.data.type === '0x1::fungible_asset::FungibleStore')?.data
              ?.data?.metadata?.inner || data.store;
        } else {
          const coinType = changes
            .find((c) => c.address === accountAddr && /^0x1::coin::CoinStore<.+>$/.test(c.data?.type ?? ''))
            ?.data?.type?.match(/^0x1::coin::CoinStore<(.+)>$/)?.[1];
          if (coinType) tokenAddr = coinType;
        }

        const key = `${tokenAddr}-${amount}`;
        if (!legs[key]) {
          legs[key] = { token: tokenAddr, amount, froms: [], tos: [] };
        }
        if (evtType.includes('Withdraw')) {
          legs[key].froms.push(accountAddr);
        } else {
          legs[key].tos.push(accountAddr);
        }
      }

      for (const leg of Object.values(legs)) {
        // Native APT is the legacy coin (0x1::aptos_coin::AptosCoin) and its
        // migrated fungible-asset metadata object (0xa / its zero-padded long
        // form): both normalize to a null token with tokenType NATIVE. Every
        // other asset keeps its (lowercased) address.
        const tokenAddrLower = leg.token.toLowerCase();
        const isNative =
          tokenAddrLower.includes('aptos_coin') || tokenAddrLower.replace(/^0x/, '').replace(/^0+/, '') === 'a';

        // Pair each withdrawal with a deposit of the same (token, amount), in
        // event order. A balanced transfer has one of each; a one-sender→many or
        // many→one-recipient batch pairs index-wise. Half-legs with no
        // counterpart (mints, burns, fee-only legs) fall outside the paired
        // range and are dropped.
        const pairCount = Math.min(leg.froms.length, leg.tos.length);
        for (let i = 0; i < pairCount; i += 1) {
          const from = leg.froms[i];
          const to = leg.tos[i];
          if (!from || !to || to === '0x00') {
            continue;
          }
          transfers.push({
            amount: BigInt(leg.amount || 0),
            blockNumber: parseInt(typedBlock.block_height, 10),
            from,
            to,
            timestamp,
            token: isNative ? null : tokenAddrLower || null,
            tokenType: isNative ? 'NATIVE' : 'TOKEN',
            transactionGasFee: gasUsed,
            transactionHash: tx.hash as string,
          });
        }
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
          tokenType: 'NATIVE',
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
          tokenType: 'NATIVE',
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

    // Migrated coin (PROPS) sent via aptos_account::transfer_coins. One real
    // movement — 18_740_000_000_000 from the sender to 0xf520…, reported once by
    // the asset's fungible-asset metadata object (0x6dba…). Previously this
    // produced three rows: a spurious self-transfer (to === sender), a
    // post-balance amount (53_458_526_229_170 = the recipient's resulting
    // balance), and a coin-type-named duplicate.
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
          to: '0xf520886f20b097e2e2e4116ab66d943f13a3f107d2ba09f6f1abc38e872b234c',
          timestamp: '2026-03-13T15:33:48.659Z',
          token: '0x6dba1728c73363be1bdd4d504844c40fbb893e368ccbeff1d1bd83497dbc756d',
          tokenType: 'TOKEN',
          transactionGasFee: 16n,
          transactionHash: '0xaaec78039e7392b430c554bc33291c2786a1c92669e8f8f88280f419b0792d29',
        },
      ],
    },

    // Legacy (unpaired) coin moved via 0x1::coin Withdraw/Deposit events: the
    // events carry no fungible-store, so the asset is the <T> of the owner's
    // 0x1::coin::CoinStore<T> change. A non-APT coin must surface as that TOKEN,
    // not be mislabeled native. (Synthetic block — these are increasingly rare
    // on mainnet as coins migrate to the fungible-asset standard.)
    {
      params: { network: 'APTOS' },
      payload: {
        _network: 'APTOS',
        block_height: '999000001',
        transactions: [
          {
            type: 'user_transaction',
            hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
            timestamp: '1700000000000000',
            gas_used: '7',
            sender: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            events: [
              {
                type: '0x1::coin::WithdrawEvent',
                guid: { account_address: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
                data: { amount: '500' },
              },
              {
                type: '0x1::coin::DepositEvent',
                guid: { account_address: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' },
                data: { amount: '500' },
              },
            ],
            changes: [
              {
                address: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
                data: {
                  type: '0x1::coin::CoinStore<0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5::usdc::USDC>',
                  data: {},
                },
              },
              {
                address: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
                data: {
                  type: '0x1::coin::CoinStore<0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5::usdc::USDC>',
                  data: {},
                },
              },
            ],
          },
        ],
      },
      output: [
        {
          amount: 500n,
          blockNumber: 999000001,
          from: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          to: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          timestamp: '2023-11-14T22:13:20.000Z',
          token: '0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5::usdc::usdc',
          tokenType: 'TOKEN',
          transactionGasFee: 7n,
          transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        },
      ],
    },

    // Legacy APT moved via 0x1::coin events resolves to native (token null,
    // tokenType NATIVE) — the CoinStore<T> is 0x1::aptos_coin::AptosCoin.
    {
      params: { network: 'APTOS' },
      payload: {
        _network: 'APTOS',
        block_height: '999000002',
        transactions: [
          {
            type: 'user_transaction',
            hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
            timestamp: '1700000000000000',
            gas_used: '3',
            sender: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            events: [
              {
                type: '0x1::coin::WithdrawEvent',
                guid: { account_address: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
                data: { amount: '900' },
              },
              {
                type: '0x1::coin::DepositEvent',
                guid: { account_address: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' },
                data: { amount: '900' },
              },
            ],
            changes: [
              {
                address: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
                data: { type: '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>', data: {} },
              },
              {
                address: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
                data: { type: '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>', data: {} },
              },
            ],
          },
        ],
      },
      output: [
        {
          amount: 900n,
          blockNumber: 999000002,
          from: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          to: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          timestamp: '2023-11-14T22:13:20.000Z',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 3n,
          transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        },
      ],
    },

    // One sender → two recipients of the same fungible asset with DISTINCT
    // amounts in a single tx: each movement is its own row (no collapse, no
    // dropped transfer), with owners resolved from the stores' ObjectCore.
    {
      params: { network: 'APTOS' },
      payload: {
        _network: 'APTOS',
        block_height: '999000003',
        transactions: [
          {
            type: 'user_transaction',
            hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
            timestamp: '1700000000000000',
            gas_used: '5',
            sender: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            events: [
              {
                type: '0x1::fungible_asset::Withdraw',
                guid: { account_address: '0x0' },
                data: { store: '0x5151515151515151515151515151515151515151515151515151515151515151', amount: '100' },
              },
              {
                type: '0x1::fungible_asset::Deposit',
                guid: { account_address: '0x0' },
                data: { store: '0x5252525252525252525252525252525252525252525252525252525252525252', amount: '100' },
              },
              {
                type: '0x1::fungible_asset::Withdraw',
                guid: { account_address: '0x0' },
                data: { store: '0x5151515151515151515151515151515151515151515151515151515151515151', amount: '200' },
              },
              {
                type: '0x1::fungible_asset::Deposit',
                guid: { account_address: '0x0' },
                data: { store: '0x5353535353535353535353535353535353535353535353535353535353535353', amount: '200' },
              },
            ],
            changes: [
              {
                address: '0x5151515151515151515151515151515151515151515151515151515151515151',
                data: {
                  type: '0x1::fungible_asset::FungibleStore',
                  data: { metadata: { inner: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' } },
                },
              },
              {
                address: '0x5252525252525252525252525252525252525252525252525252525252525252',
                data: {
                  type: '0x1::fungible_asset::FungibleStore',
                  data: { metadata: { inner: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' } },
                },
              },
              {
                address: '0x5353535353535353535353535353535353535353535353535353535353535353',
                data: {
                  type: '0x1::fungible_asset::FungibleStore',
                  data: { metadata: { inner: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' } },
                },
              },
              {
                address: '0x5151515151515151515151515151515151515151515151515151515151515151',
                data: {
                  type: '0x1::object::ObjectCore',
                  data: { owner: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
                },
              },
              {
                address: '0x5252525252525252525252525252525252525252525252525252525252525252',
                data: {
                  type: '0x1::object::ObjectCore',
                  data: { owner: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' },
                },
              },
              {
                address: '0x5353535353535353535353535353535353535353535353535353535353535353',
                data: {
                  type: '0x1::object::ObjectCore',
                  data: { owner: '0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3' },
                },
              },
            ],
          },
        ],
      },
      output: [
        {
          amount: 100n,
          blockNumber: 999000003,
          from: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          to: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          timestamp: '2023-11-14T22:13:20.000Z',
          token: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
          tokenType: 'TOKEN',
          transactionGasFee: 5n,
          transactionHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        },
        {
          amount: 200n,
          blockNumber: 999000003,
          from: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          to: '0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
          timestamp: '2023-11-14T22:13:20.000Z',
          token: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
          tokenType: 'TOKEN',
          transactionGasFee: 5n,
          transactionHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        },
      ],
    },

    // Two transfers of the SAME asset AND SAME amount in one tx (an equal-split
    // batch send) must NOT collapse: the canonical half-legs are paired
    // index-wise, so each surfaces as its own row.
    {
      params: { network: 'APTOS' },
      payload: {
        _network: 'APTOS',
        block_height: '999000004',
        transactions: [
          {
            type: 'user_transaction',
            hash: '0x4444444444444444444444444444444444444444444444444444444444444444',
            timestamp: '1700000000000000',
            gas_used: '6',
            sender: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            events: [
              {
                type: '0x1::fungible_asset::Withdraw',
                guid: { account_address: '0x0' },
                data: { store: '0x5151515151515151515151515151515151515151515151515151515151515151', amount: '100' },
              },
              {
                type: '0x1::fungible_asset::Deposit',
                guid: { account_address: '0x0' },
                data: { store: '0x5252525252525252525252525252525252525252525252525252525252525252', amount: '100' },
              },
              {
                type: '0x1::fungible_asset::Withdraw',
                guid: { account_address: '0x0' },
                data: { store: '0x5151515151515151515151515151515151515151515151515151515151515151', amount: '100' },
              },
              {
                type: '0x1::fungible_asset::Deposit',
                guid: { account_address: '0x0' },
                data: { store: '0x5353535353535353535353535353535353535353535353535353535353535353', amount: '100' },
              },
            ],
            changes: [
              {
                address: '0x5151515151515151515151515151515151515151515151515151515151515151',
                data: {
                  type: '0x1::fungible_asset::FungibleStore',
                  data: { metadata: { inner: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' } },
                },
              },
              {
                address: '0x5252525252525252525252525252525252525252525252525252525252525252',
                data: {
                  type: '0x1::fungible_asset::FungibleStore',
                  data: { metadata: { inner: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' } },
                },
              },
              {
                address: '0x5353535353535353535353535353535353535353535353535353535353535353',
                data: {
                  type: '0x1::fungible_asset::FungibleStore',
                  data: { metadata: { inner: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' } },
                },
              },
              {
                address: '0x5151515151515151515151515151515151515151515151515151515151515151',
                data: {
                  type: '0x1::object::ObjectCore',
                  data: { owner: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
                },
              },
              {
                address: '0x5252525252525252525252525252525252525252525252525252525252525252',
                data: {
                  type: '0x1::object::ObjectCore',
                  data: { owner: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' },
                },
              },
              {
                address: '0x5353535353535353535353535353535353535353535353535353535353535353',
                data: {
                  type: '0x1::object::ObjectCore',
                  data: { owner: '0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3' },
                },
              },
            ],
          },
        ],
      },
      output: [
        {
          amount: 100n,
          blockNumber: 999000004,
          from: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          to: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          timestamp: '2023-11-14T22:13:20.000Z',
          token: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
          tokenType: 'TOKEN',
          transactionGasFee: 6n,
          transactionHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
        },
        {
          amount: 100n,
          blockNumber: 999000004,
          from: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
          to: '0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
          timestamp: '2023-11-14T22:13:20.000Z',
          token: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
          tokenType: 'TOKEN',
          transactionGasFee: 6n,
          transactionHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
        },
      ],
    },
  ],
};

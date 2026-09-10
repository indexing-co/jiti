import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { UtxoBlock } from '../../types/beats/utxo';

export const UTXOTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'UTXO',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const typedBlock = block as unknown as UtxoBlock;
    const timestamp = typedBlock.time ? new Date(typedBlock.time * 1000).toISOString() : null;
    for (const tx of typedBlock.tx) {
      const vin = tx.vin[0];
      const vout = tx.vout;

      const fromVout = Math.min(vin?.vout || 1000, vout.length - 1);
      // ⚠️ The prevout must consult `addresses[]` too, not just `address`.
      //
      // These two branches are not interchangeable: the first is the REAL sender, the second is a
      // guess (an output of this same transaction, picked by the input's index). The guess branch
      // already fell back to the legacy `addresses` array and the prevout branch did not -- and
      // Litecoin and Dogecoin, whose daemons predate `address`, emit exactly that legacy shape.
      //
      // So on precisely the chains where a resolved prevout is hardest to come by, a correct one
      // was read as absent and silently discarded in favour of the guess. Measured live: a
      // prevout carrying `addresses: ["ltc1q7vqvjh0l7n..."]` -- the true sender -- still produced
      // the wrong `from`.
      const fromAddress =
        vin?.prevout?.scriptPubKey?.address ||
        vin?.prevout?.scriptPubKey?.addresses?.[0] ||
        vout[fromVout]?.scriptPubKey?.address ||
        vout[fromVout]?.scriptPubKey?.addresses?.[0];
      if (!fromAddress) {
        continue;
      }

      for (const v of vout) {
        transfers.push({
          amount: BigInt(Math.round(v.value * Math.pow(10, 8))),
          blockNumber: typedBlock.height,
          from: fromAddress,
          timestamp,
          to: v.scriptPubKey.address || v.scriptPubKey.addresses?.[0],
          transactionGasFee: BigInt(Math.round((tx.fee || 0) * Math.pow(10, 8))),
          transactionHash: tx.txid,
          token: null,
          tokenType: 'NATIVE',
        });
      }
    }

    return transfers;
  },

  tests: [
    // ⭐ Regression: a prevout in the LEGACY shape (`addresses[]`, no `address`).
    //
    // Inline rather than remote because no live endpoint serves it: Litecoin's daemon has no
    // prevout at any verbosity, so this block shape only exists once something resolves the
    // prevouts itself (the indexer's by-hash path, or the tip machine). That is exactly why the
    // bug survived -- there was nothing to catch it. The decoy matters: `vout[min(vin.vout,
    // len-1)]` picks index 1, so if the prevout is ignored, `from` becomes the DECOY address and
    // this test fails loudly instead of silently guessing.
    {
      params: {
        network: 'LITECOIN',
        walletAddress: '',
        contractAddress: '',
      },
      payload: {
        _network: 'LITECOIN',
        height: 3171907,
        time: 1788524231,
        tx: [
          {
            txid: '0ca2186b946da963fb6b39dbf5a30b5fa03d2b46a3cc4902ec8768de3012c9d5',
            fee: 0.00000345,
            vin: [
              {
                txid: '1e3a234d18d97299071e8836feb9955ca3faa9c3e2efab4aac7277503891b218',
                vout: 5,
                prevout: {
                  value: 623.34702046,
                  scriptPubKey: {
                    asm: '0 f300c95dfff4de6dce451e40a331d602bce64dbe',
                    hex: '0014f300c95dfff4de6dce451e40a331d602bce64dbe',
                    type: 'witness_v0_keyhash',
                    reqSigs: 1,
                    addresses: ['ltc1q7vqvjh0l7n0xmnj9req2xvwkq27wvnd7nj7njh'],
                  },
                },
              },
            ],
            vout: [
              {
                value: 4.342485,
                scriptPubKey: {
                  asm: '0 f6e2 5226 b0 d9 62 ee bc 0 84 fe 38 c 52 4b 2d 12 9c',
                  hex: '0014f6e25226b0d962eebc084fe38c524b2d129c',
                  type: 'witness_v0_keyhash',
                  addresses: ['ltc1q7m39yf4sxevfm4upp8lr33fyt95ff8730shju3'],
                },
              },
              {
                value: 0.51812171,
                scriptPubKey: {
                  asm: '0 c1 2a 16 b3 e2 8a 7 ca 8 3f cf 20 6a d5 c 5c e3 e8 f1',
                  hex: '0014c12a16b3e28a07ca083fcf206ad50c5ce3e8f1',
                  type: 'witness_v0_keyhash',
                  addresses: ['ltc1qcy59vk03n2q89070yp4dtzj4ec8arc37vn5t9t'],
                },
              },
            ],
          },
        ],
      },
      output: [
        {
          amount: 434248500n,
          blockNumber: 3171907,
          from: 'ltc1q7vqvjh0l7n0xmnj9req2xvwkq27wvnd7nj7njh',
          timestamp: '2026-09-04T12:17:11.000Z',
          to: 'ltc1q7m39yf4sxevfm4upp8lr33fyt95ff8730shju3',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 345n,
          transactionHash: '0ca2186b946da963fb6b39dbf5a30b5fa03d2b46a3cc4902ec8768de3012c9d5',
        },
        {
          amount: 51812171n,
          blockNumber: 3171907,
          from: 'ltc1q7vqvjh0l7n0xmnj9req2xvwkq27wvnd7nj7njh',
          timestamp: '2026-09-04T12:17:11.000Z',
          to: 'ltc1qcy59vk03n2q89070yp4dtzj4ec8arc37vn5t9t',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 345n,
          transactionHash: '0ca2186b946da963fb6b39dbf5a30b5fa03d2b46a3cc4902ec8768de3012c9d5',
        },
      ],
    },

    {
      params: {
        network: 'DOGECOIN',
        walletAddress: 'DMqRVLrhbam3Kcfddpxd6EYvEBbpi3bEpP',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/dogecoin/1000075',
      output: [
        {
          amount: 1008521000000n,
          blockNumber: 1000075,
          from: 'DMqRVLrhbam3Kcfddpxd6EYvEBbpi3bEpP',
          to: 'DMqRVLrhbam3Kcfddpxd6EYvEBbpi3bEpP',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 0n,
          transactionHash: '9873fe46ab29f61cefdec498b691af68e0ad29a7599c94f42d2d4e9a5d461dbe',
          timestamp: '2015-12-13T19:59:52.000Z',
        },
      ],
    },

    {
      params: {
        network: 'ZCASH',
        walletAddress: 't1XTjBLgWWTpH1yeZkndggpSLYMYFRUGhaK',
      },
      payload: 'https://jiti.indexing.co/networks/zcash/3178246',
      output: [
        {
          amount: 1500000n,
          blockNumber: 3178246,
          from: 't1XTjBLgWWTpH1yeZkndggpSLYMYFRUGhaK',
          timestamp: '2025-12-22T14:39:23.000Z',
          to: 't1XTjBLgWWTpH1yeZkndggpSLYMYFRUGhaK',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 0n,
          transactionHash: '2c9b4e084a0d3b289c54761523ffa57b8b792bfadca3ebc7d26141343ca79f5c',
        },
      ],
    },
  ],
};

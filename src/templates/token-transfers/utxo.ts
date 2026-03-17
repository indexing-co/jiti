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
      const fromAddress =
        vin?.prevout?.scriptPubKey?.address ||
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

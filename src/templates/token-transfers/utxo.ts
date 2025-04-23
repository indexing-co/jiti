import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';

export const UTXOTokenTransfers: SubTemplate = {
  match: (block) => ['BITCOIN', 'BITCOIN_TESTNET', 'LITECOIN', 'DOGECOIN'].includes(block._network as string),

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    const timestamp = block.time ? new Date((block.time as number) * 1000).toISOString() : null;
    for (const tx of block.tx as Record<string, unknown>[]) {
      const vin = tx.vin[0] as { prevout?: { scriptPubKey: { address: string } }; vout?: number };
      const vout = tx.vout as { value: number; scriptPubKey?: { address: string; addresses?: string[] } }[];

      const fromVout = Math.min(vin.vout || 1000, vout.length - 1);
      const fromAddress =
        vin.prevout?.scriptPubKey?.address ||
        vout[fromVout]?.scriptPubKey?.address ||
        vout[fromVout]?.scriptPubKey?.addresses?.[0];
      if (!fromAddress) {
        continue;
      }

      for (const v of vout) {
        transfers.push({
          amount: BigInt(Math.round(v.value * Math.pow(10, 8))),
          blockNumber: block.height as number,
          from: fromAddress,
          timestamp,
          to: v.scriptPubKey.address || v.scriptPubKey.addresses?.[0],
          transactionGasFee: BigInt(Math.round(((tx.fee as number) || 0) * Math.pow(10, 8))),
          transactionHash: tx.txid as string,
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
  ],
};

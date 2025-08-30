import { Template } from '../types';
import blockToVM from '../utils/block-to-vm';
import tokenTransfersTemplate from './token-transfers';

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const filterValuesTemplate: Template = {
  key: 'filter_values',
  name: 'Filter Values',
  description: 'Get all filterable values.',
  disabled: false,
  tags: [],
  params: [],

  transform: (block) => {
    let finalValues: string[] = [];

    const vm = block._vm || blockToVM(block);

    switch (vm) {
      case 'APTOS': {
        const values = new Set<string>();
        for (const tx of block.transactions as Record<string, unknown>[]) {
          values.add(tx.sender as string);
          if (!Array.isArray(tx.events)) continue;
          for (const evt of tx.events as { guid: { account_address: string } }[]) {
            values.add(evt.guid?.account_address);
          }
        }
        for (const txfer of tokenTransfersTemplate.transform(block) as { from: string; to: string }[]) {
          values.add(txfer.from);
          values.add(txfer.to);
        }
        finalValues = Array.from(values)
          .filter((v) => v?.length > 3)
          .map((v) => (v.startsWith('0x') && v.length === 66 ? v.toLowerCase() : v));
        break;
      }

      case 'COSMOS': {
        const values = new Set<string>();
        for (const tx of block.txs_results as { events: { attributes: { value: string }[] }[] }[]) {
          for (const evt of tx.events || []) {
            for (const attr of evt.attributes || []) {
              let val = attr.value;
              if (typeof val === 'string' && val?.length > 35 && val?.length < 70) {
                if (val.endsWith('=')) {
                  val = atob(val);
                }
                values.add(val);
              }
            }
          }
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }

      case 'EVM': {
        const values = new Set<string>();

        for (const tx of (block.transactions as Record<string, unknown>[]) || []) {
          values.add(tx.hash as string);

          const from = (tx.from as string)?.toLowerCase() || NULL_ADDRESS;
          const to = (tx.to as string)?.toLowerCase() || NULL_ADDRESS;
          values.add(from);
          values.add(to);

          if (tx.receipt) {
            if (to === NULL_ADDRESS && (tx.receipt as Record<string, string>).contractAddress) {
              values.add((tx.receipt as Record<string, string>).contractAddress.toLowerCase());
            }

            for (const log of (tx.receipt as { logs: (Record<string, string> & { topics: string[] })[] }).logs || []) {
              values.add(log.address.toLowerCase());
              values.add(log.topics[0]);
              log.topics.slice(1).forEach((topic) => {
                // logic here is fuzzy to check if the topic *feels* like an address
                if (topic.startsWith('0x000000000000000000000000') && topic.slice(26, 36).match(/[1-9A-z]/g)?.length) {
                  values.add('0x' + topic.slice(26).toLowerCase());
                }
              });
            }
          }

          for (const trace of (tx.traces as Record<string, unknown>[]) || []) {
            const from = (trace.action as Record<string, string>)?.from?.toLowerCase() || NULL_ADDRESS;
            const to = (trace.action as Record<string, string>)?.to?.toLowerCase() || NULL_ADDRESS;
            values.add(from);
            values.add(to);

            if (to === NULL_ADDRESS && (trace.result as Record<string, string>)?.address) {
              values.add((trace.result as Record<string, string>).address.toLowerCase());
            }
          }
        }

        finalValues = Array.from(values).filter((v) => v?.length);

        if (params.pacemaker.toUpperCase() === 'TRON') {
          finalValues = finalValues
            .map((fv) => (fv.length === 42 ? [parseText('tronAddress', fv) as string, fv] : fv))
            .flat();
        }
        break;
      }

      case 'RIPPLE': {
        const values = new Set<string>();
        for (const tx of block.transactions as Record<string, string | Record<string, string>>[]) {
          values.add(tx.Account as string);
          values.add(tx.Destination as string);
          for (const key in tx) {
            if ((tx[key] as Record<string, string>)?.issuer) {
              values.add((tx[key] as Record<string, string>)?.issuer);
            }
          }
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }

      case 'STARKNET': {
        const values = new Set<string>();

        for (const tx of (block.transactions as Record<string, unknown>[]) || []) {
          const from = (tx.send_address as string)?.toLowerCase() || NULL_ADDRESS;
          values.add(from);

          if (tx.receipt as Record<string, unknown>) {
            for (const evt of (tx.receipt as { events: { from_address: string; data: string[] }[] }).events || []) {
              values.add(evt.from_address?.toLowerCase());
              for (const d of evt.data || []) {
                values.add(d);
              }
            }
          }
        }

        finalValues = Array.from(values).filter((v) => v?.length);
        break;
      }

      case 'STELLAR': {
        const values = new Set<string>();
        for (const tx of block.transactions as {
          source_account: string;
          operations: { from: string; to: string; asset_issuer: string; source_account: string }[];
        }[]) {
          values.add(tx.source_account);
          tx.operations?.forEach((op) => {
            values.add(op.from);
            values.add(op.to);
            values.add(op.asset_issuer);
            values.add(op.source_account);
          });
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }

      case 'SUBSTRATE': {
        const values = new Set<string>();
        for (const ext of (block?.extrinsics as {
          signer: string;
          args: (string | Record<string, unknown>)[];
        }[]) || []) {
          for (const arg of ext.args || []) {
            if (!arg) continue;
            if (typeof arg === 'string') {
              values.add(arg);
            } else if (typeof arg === 'object') {
              for (const key in arg) {
                if (typeof arg[key] == 'string') {
                  values.add(arg[key]);
                }
              }
            }
          }
        }
        finalValues = Array.from(values).filter((v) => v?.length);
        break;
      }

      case 'SUI': {
        const values = new Set<string>();
        for (const tx of block.transactions as {
          sender: string;
          balanceChanges: { owner: string; coinRepr: string }[];
        }[]) {
          values.add(tx.sender);
          tx.balanceChanges?.forEach((bc) => {
            values.add(bc.owner);
            values.add(bc.coinRepr);
          });
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }

      case 'SVM': {
        const values = new Set<string>();
        for (const tx of block.transactions as {
          transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
          meta: Record<string, { mint: string; owner: string }[]>;
        }[]) {
          tx.transaction.message.accountKeys.forEach((a) => values.add(typeof a === 'string' ? a : a.pubkey));
          tx.meta.postTokenBalances.concat(tx.meta.preTokenBalances).forEach((tb) => {
            values.add(tb.owner);
            values.add(tb.mint);
          });
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }

      case 'TON': {
        const values = new Set<string>();
        for (const shard of block.shards as {
          transactions: {
            address?: { account_address: string };
            in_msg: {
              source: {
                account_address: string;
              };
              destination: { account_address: string };
            };
            out_msgs: {
              source: {
                account_address: string;
              };
              destination: { account_address: string };
            }[];
          }[];
        }[]) {
          for (const tx of shard.transactions) {
            values.add(tx.address?.account_address);
            values.add(tx.in_msg?.source?.account_address);
            values.add(tx.in_msg?.destination?.account_address);
            tx.out_msgs?.forEach((msg) => {
              values.add(msg.source?.account_address);
              values.add(msg.destination?.account_address);
            });
          }
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }

      case 'UTXO': {
        const values = new Set<string>();
        for (const tx of block.tx as {
          vin: { prevout?: { scriptPubKey: { address: string } } }[];
          vout: { scriptPubKey: { address: string; addresses?: string[] } }[];
        }[]) {
          tx.vin.forEach((v) => values.add(v.prevout?.scriptPubKey.address));
          tx.vout.forEach((v) => {
            values.add(v.scriptPubKey.address);
            [v.scriptPubKey.addresses].flat().forEach((a) => values.add(a));
          });
        }
        finalValues = Array.from(values).filter((v) => v?.length > 3);
        break;
      }
    }

    return finalValues;
  },

  tests: [],
};

export default filterValuesTemplate;

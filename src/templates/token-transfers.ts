import { evmDecodeLogWithMetadata } from '../utils';
import { Template } from '../types';

type NetworkTransfer = {
  amount: number | bigint;
  blockNumber: number;
  from: string;
  index?: string;
  timestamp: string;
  to: string;
  token?: string;
  tokenId?: string;
  tokenType: 'NATIVE' | 'TOKEN' | 'NFT';
  transactionGasFee: bigint;
  transactionHash: string;
};

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const tokenTransfersTemplate: Template = {
  key: 'token_transfers',
  name: 'Token Transfers',
  description: 'Get all token transfers for a set of token types.',
  tags: ['EVM', 'ERC20', 'ERC721', 'NFT', 'TOKEN'],
  disabled: false,
  params: [
    { key: 'network', name: 'Network', type: 'NETWORK', optional: false },
    { key: 'contractAddress', name: 'Contract Address', type: 'ADDRESS', optional: true },
    { key: 'walletAddress', name: 'Wallet Address', type: 'ADDRESS', optional: true },
    {
      key: 'tokenTypes',
      name: 'Token Types',
      type: 'STRING',
      multiple: true,
      optional: true,
      values: ['NATIVE', 'TOKEN', 'NFT'],
    },
  ],

  transform: (block, _ctx) => {
    const TOKEN_TYPES = (_ctx.params.tokenTypes as NetworkTransfer['tokenType'][]) || [];
    let transfers: NetworkTransfer[] = [];

    switch (block._network) {
      case 'APTOS':
      case 'APTOS_TESTNET': {
        for (const tx of block.transactions as Record<string, unknown>[]) {
          if (!tx?.events || !Array.isArray(tx.events)) {
            break;
          }

          const timestamp = tx.timestamp ? new Date(parseInt(tx.timestamp as string) / 1000).toISOString() : null;
          const txfersByKey: Record<string, Record<string, string>> = {};

          for (const evt of tx.events as Record<string, unknown>[]) {
            if (['0x1::coin::WithdrawEvent', '0x1::coin::DepositEvent'].includes(evt.type as string)) {
              const amount = (evt.data as Record<string, string>)?.amount;
              const key = `0x1-${amount}`;
              txfersByKey[key] ||= { amount, tokenAddress: null };
              if ((evt.type as string).endsWith('WithdrawEvent')) {
                txfersByKey[key].from = (evt.guid as Record<string, string>)?.account_address;
              } else {
                txfersByKey[key].to = (evt.guid as Record<string, string>)?.account_address;
              }
            }
          }

          for (const partial of Object.values(txfersByKey)) {
            if (!partial.from || !partial.to) continue;
            transfers.push({
              amount: BigInt(partial.amount),
              blockNumber: parseInt(block.block_height as string),
              from: partial.from,
              timestamp,
              to: partial.to,
              token: partial.tokenAddress,
              tokenType: 'NATIVE',
              transactionGasFee: BigInt(tx.gas_used as string),
              transactionHash: tx.hash as string,
            });
          }
        }
        break;
      }

      case 'BITCOIN':
      case 'BITCOIN_TESTNET':
      case 'LITCOIN': // @TODO
      case 'DOGECOIN': {
        for (const tx of block.tx as Record<string, unknown>[]) {
          const timestamp = tx.time ? new Date((tx.time as number) * 1000).toISOString() : null;
          const vin = tx.vin[0] as { prevout?: { scriptPubKey: { address: string } }; vout?: number };
          const vout = tx.vout as { value: number; scriptPubKey?: { address: string; addresses?: string[] } }[];

          const fromVout = Math.min(vin.vout || 1000, vout.length - 1);
          const fromAddress =
            vin.prevout?.scriptPubKey?.address ||
            vout[fromVout]?.scriptPubKey?.address ||
            vout[fromVout]?.scriptPubKey?.addresses?.[0];
          if (!fromAddress) {
            break;
          }

          for (const v of vout) {
            transfers.push({
              amount: BigInt(Math.round(v.value * Math.pow(10, 8))),
              blockNumber: block.height as number,
              from: fromAddress,
              timestamp,
              to: v.scriptPubKey.address || v.scriptPubKey.addresses?.[0],
              transactionGasFee: BigInt((tx.fee as number) || 0) * BigInt(Math.pow(10, 8)),
              transactionHash: tx.txid as string,
              token: null,
              tokenType: 'NATIVE',
            });
          }

          break;
        }
        break;
      }

      case 'CARDANO': {
        for (const tx of block.transactions as unknown[]) {
          const typedTx = tx as {
            transaction_identifier?: { hash?: string };
            operations?: {
              type: string;
              account?: { address?: string };
              amount?: {
                value?: string;
                currency?: {
                  symbol?: string;
                  decimals?: number;
                };
              };
            }[];
            timestamp?: number;
          };

          if (!Array.isArray(typedTx.operations)) {
            continue;
          }

          const transactionHash = typedTx.transaction_identifier?.hash || '';
          const timestamp = typedTx.timestamp ? new Date(typedTx.timestamp).toISOString() : null;

          const inputs = typedTx.operations.filter((op) => op.type === 'input');
          const outputs = typedTx.operations.filter((op) => op.type === 'output');

          if (!inputs.length && !outputs.length) {
            break;
          }

          const fromAddress = inputs[0]?.account?.address;
          if (!fromAddress) {
            continue;
          }

          const sumInputs = inputs.reduce((acc, op) => {
            const val = BigInt(op.amount?.value || '0');
            return acc + val;
          }, BigInt(0));
          const sumOutputs = outputs.reduce((acc, op) => {
            const val = BigInt(op.amount?.value || '0');
            return acc + val;
          }, BigInt(0));

          const transactionFee = sumInputs + BigInt(sumOutputs);

          for (const out of outputs) {
            const rawValue = out.amount?.value || '0';
            const absoluteValue = BigInt(rawValue);
            transfers.push({
              amount: absoluteValue < 0 ? -absoluteValue : absoluteValue,
              blockNumber: (block.block_identifier as { index: number }).index,
              from: fromAddress,
              timestamp,
              to: out.account?.address || '',
              token: out.amount?.currency?.symbol?.toUpperCase() === 'ADA' ? null : out.amount?.currency?.symbol,
              tokenType: out.amount?.currency?.symbol?.toUpperCase() === 'ADA' ? 'NATIVE' : 'TOKEN',
              transactionGasFee: transactionFee < 0 ? -transactionFee : transactionFee,
              transactionHash,
            });
          }
        }
        break;
      }

      case 'RIPPLE': {
        if (!Array.isArray(block.transactions)) {
          break;
        }

        for (const rawTx of block.transactions) {
          const typedTx = rawTx as {
            Account?: string;
            Amount?: string | { currency: string; issuer: string; value: string };
            Destination?: string;
            Fee?: string;
            hash?: string;
            TransactionType?: string;
            date?: number;
            metaData?: {
              delivered_amount?: string | { currency: string; issuer: string; value: string };
            };
          };

          if (typedTx.TransactionType !== 'Payment') {
            continue;
          }

          const deliveredOrAmount = typedTx.metaData?.delivered_amount ?? typedTx.Amount ?? '0';

          function parseRippleDeliveredAmount(
            delivered: string | number | { currency: string; issuer: string; value: string } | undefined
          ): bigint {
            if (!delivered) {
              return 0n;
            }

            if (typeof delivered === 'object') {
              const floatVal = parseFloat(delivered.value);
              const smallestUnit = Math.round(floatVal * 1_000_000);
              return BigInt(smallestUnit);
            }

            const s = String(delivered);
            return BigInt(s);
          }

          const parsedAmount = parseRippleDeliveredAmount(deliveredOrAmount);

          transfers.push({
            amount: parsedAmount,
            blockNumber: parseInt(block.ledger_index as string, 10),
            from: typedTx.Account ?? 'UNKNOWN',
            timestamp: typedTx.date ? new Date((typedTx.date + 946684800) * 1000).toISOString() : null,
            to: typedTx.Destination ?? 'UNKNOWN',
            token: 'XRP',
            tokenType: 'NATIVE',
            transactionGasFee: BigInt(typedTx.Fee ?? '0'),
            transactionHash: typedTx.hash ?? '',
          });
        }

        break;
      }

      case 'SOLANA': {
        for (const tx of block.transactions as unknown[]) {
          const solanaTx = tx as {
            meta: {
              fee: number;
              postTokenBalances: {
                accountIndex: number;
                mint: string;
                owner: string;
                uiTokenAmount: { amount: string };
              }[];
              preTokenBalances: {
                accountIndex: number;
                mint: string;
                owner: string;
                uiTokenAmount: { amount: string };
              }[];
              postBalances: number[];
              preBalances: number[];
            };
            transaction: {
              message: { accountKeys: (string | { pubkey: string })[]; instructions: unknown[] };
              signatures: string[];
            };
          };
          const txHash = solanaTx.transaction.signatures[0];
          const timestamp = block.blockTime ? new Date((block.blockTime as number) * 1000).toISOString() : null;

          let txFee = BigInt(solanaTx.meta.fee);
          if (txFee < BigInt(10)) {
            txFee = txFee * BigInt(Math.pow(10, 9));
          }

          const transfersByKey: Record<string, NetworkTransfer> = {};
          for (const post of solanaTx.meta.postTokenBalances) {
            let matched = false;
            for (const pre of solanaTx.meta.preTokenBalances) {
              if (post.mint === pre.mint && post.owner === pre.owner) {
                let diff = BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount);
                if (diff === BigInt(0)) {
                  continue;
                }
                if (diff < 0) {
                  diff = -diff;
                }

                const key = `${post.mint}-${diff.toString()}`;
                const txfer: NetworkTransfer = {
                  amount: diff,
                  blockNumber: block.blockHeight as number,
                  from: pre.owner,
                  timestamp,
                  to: post.owner,
                  transactionGasFee: txFee,
                  transactionHash: txHash,
                  token: post.mint,
                  tokenType: 'TOKEN',
                };
                if (transfersByKey[key]) {
                  if (diff > 0) {
                    delete txfer.from;
                  } else {
                    delete txfer.to;
                  }
                }
                transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
                matched = true;
              }
            }

            if (!matched) {
              let diff = BigInt(post.uiTokenAmount.amount);
              if (diff < 0) {
                diff = -diff;
              }
              const key = `${post.mint}-${diff.toString()}`;
              const txfer: NetworkTransfer = {
                amount: diff,
                blockNumber: block.blockHeight as number,
                from: null,
                timestamp,
                to: post.owner,
                token: post.mint,
                tokenType: 'TOKEN',
                transactionGasFee: txFee,
                transactionHash: txHash,
              };
              delete txfer.from;
              transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
            }
          }

          for (let i = 1; i < solanaTx.meta.postBalances.length; i += 1) {
            const post = solanaTx.meta.postBalances[i];
            const pre = solanaTx.meta.preBalances[i];
            if (post !== undefined && pre !== undefined && post !== pre) {
              let diff = BigInt(post) - BigInt(pre);
              if (diff < 0) {
                diff = -diff;
              }
              const key = `null-${diff.toString()}`;

              const txfer: NetworkTransfer = {
                amount: diff,
                blockNumber: block.blockHeight as number,
                from:
                  post > pre
                    ? typeof solanaTx.transaction.message.accountKeys[0] === 'string'
                      ? solanaTx.transaction.message.accountKeys[0]
                      : (solanaTx.transaction.message.accountKeys[0] as { pubkey: string })?.pubkey
                    : typeof solanaTx.transaction.message.accountKeys[i] === 'string'
                      ? (solanaTx.transaction.message.accountKeys[i] as string)
                      : (solanaTx.transaction.message.accountKeys[i] as { pubkey: string })?.pubkey,
                timestamp,
                to:
                  typeof solanaTx.transaction.message.accountKeys[i] === 'string'
                    ? (solanaTx.transaction.message.accountKeys[i] as string)
                    : (solanaTx.transaction.message.accountKeys[i] as { pubkey: string })?.pubkey?.toString(),
                token: null,
                tokenType: 'NATIVE',
                transactionGasFee: txFee,
                transactionHash: txHash,
              };
              if (transfersByKey[key]) {
                if (post > pre) {
                  delete txfer.from;
                } else {
                  delete txfer.to;
                }
              }
              transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
            }
          }

          transfers.push(...Object.values(transfersByKey));
        }
        break;
      }

      // @TODO:
      case 'STARKNET': {
        break;
      }

      case 'STELLAR': {
        for (const tx of block.transactions as unknown[]) {
          const typedTx = tx as {
            hash: string;
            created_at: string;
            fee_charged: string;
            operations: {
              type: string;
              from: string;
              to: string;
              amount: string;
              asset_type: string;
              asset_issuer: string;
            }[];
          };
          for (const op of typedTx.operations) {
            if (op.type === 'payment') {
              transfers.push({
                amount: BigInt(op.amount.replace('.', '')),
                blockNumber: block.sequence as number,
                from: op.from,
                timestamp: typedTx.created_at,
                to: op.to,
                token: op.asset_type === 'native' ? null : op.asset_issuer,
                tokenType: op.asset_type === 'native' ? 'NATIVE' : 'TOKEN',
                transactionGasFee: BigInt(typedTx.fee_charged),
                transactionHash: typedTx.hash,
              });
            }
          }
        }
        break;
      }

      // @TODO:
      case 'SUI': {
        // @TODO
        break;
      }

      // @TODO:
      case 'TON': {
        break;
      }

      // attempt to introspect data types
      default: {
        // @TODO: COSMOS

        // otherwise assume EVM
        for (const tx of block.transactions as any[]) {
          if (!tx.receipt) {
            continue;
          }

          const timestamp = new Date((block.timestamp as number) * 1000).toISOString();
          const transactionGasFee = BigInt(tx.receipt.gasUsed) * BigInt(tx.receipt.effectiveGasPrice);

          // track direct ETH transfers
          if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NATIVE')) {
            // pull from traces, if available
            if (Array.isArray(tx.traces)) {
              for (const trace of tx.traces.filter((t) => t.action)) {
                const action = trace.action as unknown as { from: string; to: string; value: string };
                if (!action?.value) continue;

                transfers.push({
                  amount: BigInt(action.value),
                  blockNumber: tx.blockNumber as number,
                  from: action.from?.toLowerCase() || NULL_ADDRESS,
                  index: trace.traceAddress?.join('-'),
                  timestamp,
                  to: action.to?.toLowerCase() || NULL_ADDRESS,
                  tokenType: 'NATIVE',
                  transactionGasFee,
                  transactionHash: tx.hash,
                });
              }
            } else if ((tx.value as string)?.length >= 3 || /\d+/.test(tx.value as string)) {
              transfers.push({
                amount: BigInt(tx.value as string),
                blockNumber: tx.blockNumber as number,
                from: tx.from?.toLowerCase() || NULL_ADDRESS,
                timestamp,
                to: tx.to?.toLowerCase() || NULL_ADDRESS,
                tokenType: 'NATIVE',
                transactionGasFee,
                transactionHash: tx.hash,
              });
            }
          }

          // track ERC20 transfers
          if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('TOKEN')) {
            for (const log of tx.receipt.logs) {
              const txfer = evmDecodeLogWithMetadata(log, [
                'Transfer(address indexed from, address indexed to, uint256 value)',
              ]);
              if (txfer) {
                transfers.push({
                  amount: txfer.decoded.value as bigint,
                  blockNumber: tx.blockNumber as number,
                  from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                  index: log.logIndex,
                  timestamp,
                  to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                  token: (log.address as string).toLowerCase(),
                  tokenType: 'TOKEN',
                  transactionGasFee,
                  transactionHash: tx.hash,
                });
              }
            }
          }

          if (!TOKEN_TYPES.length || TOKEN_TYPES.includes('NFT')) {
            for (const log of tx.receipt.logs) {
              const txfer = evmDecodeLogWithMetadata(log, [
                'Transfer(address indexed from, address indexed to, uint256 indexed value)',
                'TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
                'TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
              ]);

              if (!txfer) continue;

              switch (txfer.metadata.name) {
                case 'Transfer': {
                  transfers.push({
                    amount: 1,
                    blockNumber: tx.blockNumber as number,
                    from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                    index: log.logIndex,
                    timestamp,
                    to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                    token: (log.address as string).toLowerCase(),
                    tokenId: (txfer.decoded.value as bigint).toString(),
                    tokenType: 'NFT',
                    transactionGasFee,
                    transactionHash: tx.hash,
                  });
                  break;
                }
                case 'TransferSingle': {
                  transfers.push({
                    amount: txfer.decoded.value as bigint,
                    blockNumber: tx.blockNumber as number,
                    from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                    index: log.logIndex,
                    timestamp,
                    to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                    token: (log.address as string).toLowerCase(),
                    tokenId: (txfer.decoded.id as bigint).toString(),
                    tokenType: 'NFT',
                    transactionGasFee,
                    transactionHash: tx.hash,
                  });
                  break;
                }
                case 'TransferBatch': {
                  for (let i = 0; i < (txfer.decoded.ids as bigint[]).length; i += 1) {
                    transfers.push({
                      amount: txfer.decoded.values[i] as bigint,
                      blockNumber: tx.blockNumber as number,
                      from: (txfer.decoded.from as string)?.toLowerCase() || NULL_ADDRESS,
                      index: log.logIndex,
                      timestamp,
                      to: (txfer.decoded.to as string)?.toLowerCase() || NULL_ADDRESS,
                      token: (log.address as string).toLowerCase(),
                      tokenId: (txfer.decoded.ids[i] as bigint).toString(),
                      tokenType: 'NFT',
                      transactionGasFee,
                      transactionHash: tx.hash,
                    });
                  }
                  break;
                }
              }
            }
          }
        }
        if (typeof _ctx.params.contractAddress === 'string') {
          _ctx.params.contractAddress = _ctx.params.contractAddress.toLowerCase();
        }
        if (typeof _ctx.params.walletAddress === 'string') {
          _ctx.params.walletAddress = _ctx.params.walletAddress.toLowerCase();
        }
        break;
      }
    }

    transfers = transfers.filter((txfer) => {
      if (txfer.amount <= BigInt(0)) {
        return false;
      }
      if (_ctx.params.contractAddress && _ctx.params.contractAddress !== txfer.token && txfer.token) {
        return false;
      }
      if (_ctx.params.walletAddress && ![txfer.from, txfer.to].includes(_ctx.params.walletAddress as string)) {
        return false;
      }
      return true;
    });

    return transfers;
  },

  tests: [
    // APTOS
    {
      params: {
        network: 'APTOS',
        walletAddress: '0xb3589951a7d8579a2918a749260804047abc60438bf0738c4e67683e972b41cd',
        contractAddress: '0x1',
      },
      payload: 'https://jiti.indexing.co/networks/aptos/237372198',
      output: [
        {
          amount: 12776498n,
          blockNumber: 237372198,
          from: '0xb3589951a7d8579a2918a749260804047abc60438bf0738c4e67683e972b41cd',
          timestamp: '2024-10-10T16:59:34.414Z',
          to: '0x1f5d15c9a1330389bda239ed2f40d8d2a2ba446e7a48ee57483a047d5ed1aafe',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 507n,
          transactionHash: '0xbabaf20c07c80ace9f1f2f6539e0df6c57c9a6b24d5e62fa4989b46c0807d9bb',
        },
      ],
    },

    // BASE
    {
      params: {
        network: 'BASE',
        walletAddress: '0x4F80864cD68782144e3736626896990acAe15a11',
        contractAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
      },
      payload: 'https://jiti.indexing.co/networks/base/23507423',
      output: [
        {
          amount: 1000000000000000000000n,
          blockNumber: 23507423,
          from: '0x053002b4b332b422733c9469ddf9990bb6235e3d',
          index: 536,
          timestamp: '2024-12-10T04:16:33.000Z',
          to: '0x4f80864cd68782144e3736626896990acae15a11',
          token: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
          tokenType: 'TOKEN',
          transactionGasFee: 1192354854229n,
          transactionHash: '0x69c9b12ccbe2d4f2f1dfc7c4a8557fc099fc5df276424417815acbc79a06fd56',
        },
      ],
    },

    // DOGECOIN
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

    // CARDANO
    {
      params: {
        network: 'CARDANO',
        walletAddress:
          'addr1q9syxu908lef7r6rsvk0h7gsx3rxj22cuykgx2a2l4hcfd8e9y2e9vtv4w9dyej96w99wwj8hwgc273862lk6a3vt30qjjrund',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/cardano/11443286',
      output: [
        {
          amount: 1110000n,
          blockNumber: 11443286,
          from: 'addr1qymdv285few5tyqvya86rl97r9e608njs37shfew6l2nn473aw2pcnrcvfwfgg2dnew99m4tjj0apsu7232w2euzwpysndh0h3',
          timestamp: null,
          to: 'addr1q9syxu908lef7r6rsvk0h7gsx3rxj22cuykgx2a2l4hcfd8e9y2e9vtv4w9dyej96w99wwj8hwgc273862lk6a3vt30qjjrund',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 174257n,
          transactionHash: '261c42ba9124f55d8e169ebb692cd3759d796a54369acb316ee449b546e79309',
        },
      ],
    },

    // RIPPLE
    {
      params: {
        network: 'RIPPLE',
        walletAddress: 'rUUgoiJmjTPEbxfZ4RsS9pVS9Kv813Wpui',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ripple/88104659',
      output: [
        {
          amount: 238n,
          blockNumber: 88104659,
          from: 'rMAGnTv4eMWktZnhKa5cHcDiY84ZiKUaQm',
          timestamp: null,
          to: 'rUUgoiJmjTPEbxfZ4RsS9pVS9Kv813Wpui',
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 15n,
          transactionHash: '03564E6109261CDE73FCC5062C2A0A70F365CB1A0F9408C065B60EC3E94E4DBF',
        },
      ],
    },

    // STELLAR
    {
      params: {
        network: 'STELLAR',
        walletAddress: 'GA5KLTNAWV27IOTBX5PKUOMVWFMLX4X7CPMQJ4QLR3G266MMVL7NMA4X',
        contractAddress: 'GC4Z2TDXU4GXVLHOS5P5SU6HKBCP7NKN4TJ5ZGTVRBW7MCBZTU7SNUSA',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/51720546',
      output: [
        {
          amount: 150000n,
          blockNumber: 51720546,
          from: 'GA5KLTNAWV27IOTBX5PKUOMVWFMLX4X7CPMQJ4QLR3G266MMVL7NMA4X',
          timestamp: '2024-05-18T04:41:39Z',
          to: 'GC4Z2TDXU4GXVLHOS5P5SU6HKBCP7NKN4TJ5ZGTVRBW7MCBZTU7SNUSA',
          token: 'GC4Z2TDXU4GXVLHOS5P5SU6HKBCP7NKN4TJ5ZGTVRBW7MCBZTU7SNUSA',
          tokenType: 'TOKEN',
          transactionGasFee: 100n,
          transactionHash: '4fb2441210cbe87f5003abdfa86f03bafa54f789ed041feccbda0bd054297c4d',
        },
      ],
    },
  ],
};

export default tokenTransfersTemplate;

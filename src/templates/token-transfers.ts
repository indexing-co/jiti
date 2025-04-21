import { evmDecodeLogWithMetadata } from '../utils';
import { Template, TemplateTest } from '../types';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes as defaultStargateTypes } from '@cosmjs/stargate';
import { sha256 } from 'viem';

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
                  (
                    tx.changes as { address: string; data: { type: string; data: { metadata: { inner: string } } } }[]
                  ).find((c) => c.address === data.store && c.data.type === '0x1::fungible_asset::FungibleStore')?.data
                    ?.data?.metadata?.inner || data.store;
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
        break;
      }

      case 'CARDANO': {
        const blockTimestamp = new Date((block.timestamp as number) * 1000).toISOString();

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
          };

          if (!Array.isArray(typedTx.operations)) {
            continue;
          }

          const transactionHash = typedTx.transaction_identifier?.hash || '';

          const inputs = typedTx.operations.filter((op) => op.type === 'input');
          const outputs = typedTx.operations.filter((op) => op.type === 'output');

          if (!inputs.length && !outputs.length) {
            continue;
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
              timestamp: blockTimestamp,
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
          let tokenSymbol = 'XRP';
          let tokenType: 'NATIVE' | 'TOKEN' | 'NFT' = 'NATIVE';

          let parsedAmount: bigint;

          if (typeof deliveredOrAmount === 'object') {
            tokenSymbol = deliveredOrAmount.currency?.toUpperCase() ?? 'UNKNOWN';
            tokenType = 'TOKEN';
            const floatVal = parseFloat(deliveredOrAmount.value);
            const smallestUnit = Math.round(floatVal * 1_000_000);
            parsedAmount = BigInt(smallestUnit);
          } else {
            parsedAmount = BigInt(String(deliveredOrAmount));
          }
          transfers.push({
            amount: parsedAmount,
            blockNumber: parseInt(block.ledger_index as string, 10),
            from: typedTx.Account ?? 'UNKNOWN',
            timestamp: block.close_time_iso ? (block.close_time_iso as string) : null,
            to: typedTx.Destination ?? 'UNKNOWN',
            token: tokenSymbol,
            tokenType: tokenType,
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
              loadedAddresses: { readonly: string[]; writable: string[] };
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
          const allAccounts = solanaTx.transaction.message.accountKeys
            .concat(solanaTx.meta.loadedAddresses.writable)
            .concat(solanaTx.meta.loadedAddresses.readonly);

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
                const isNegDiff = diff < 0;
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
                if (isNegDiff) {
                  delete txfer.to;
                } else {
                  delete txfer.from;
                }
                transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
                matched = true;
              }
            }

            if (!matched) {
              let diff = BigInt(post.uiTokenAmount.amount);
              const isNegDiff = diff < 0;
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
              if (isNegDiff) {
                delete txfer.to;
              } else {
                delete txfer.from;
              }
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
                    ? typeof allAccounts[0] === 'string'
                      ? allAccounts[0]
                      : (allAccounts[0] as { pubkey: string })?.pubkey
                    : typeof allAccounts[i] === 'string'
                      ? (allAccounts[i] as string)
                      : (allAccounts[i] as { pubkey: string })?.pubkey,
                timestamp,
                to:
                  typeof allAccounts[i] === 'string'
                    ? (allAccounts[i] as string)
                    : (allAccounts[i] as { pubkey: string })?.pubkey?.toString(),
                token: null,
                tokenType: 'NATIVE',
                transactionGasFee: txFee,
                transactionHash: txHash,
              };
              if (post > pre) {
                if (transfersByKey[key]) {
                  delete txfer.from;
                }
              } else {
                delete txfer.to;
              }
              transfersByKey[key] = Object.assign(transfersByKey[key] || {}, txfer);
            }
          }

          const unmatchedFrom: Record<string, NetworkTransfer[]> = {};
          const unmatchedTo: Record<string, NetworkTransfer[]> = {};
          for (const key in transfersByKey) {
            const txfer = transfersByKey[key];
            if (!txfer.from) {
              if (!unmatchedFrom[txfer.token]) unmatchedFrom[txfer.token] = [];
              unmatchedFrom[txfer.token].push(txfer);
              delete transfersByKey[key];
            } else if (!txfer.to) {
              if (!unmatchedTo[txfer.token]) unmatchedTo[txfer.token] = [];
              unmatchedTo[txfer.token].push(txfer);
              delete transfersByKey[key];
            }
          }

          for (const token in unmatchedFrom) {
            if (
              unmatchedTo[token]?.length &&
              unmatchedTo[token].reduce((a, b) => a + BigInt(b.amount), BigInt(0)) -
                unmatchedFrom[token].reduce((a, b) => a + BigInt(b.amount), BigInt(0)) ===
                BigInt(0)
            ) {
              unmatchedTo[token].sort((a, b) => (a.amount > b.amount ? 1 : -1));
              unmatchedFrom[token].forEach((um) => {
                um.from = unmatchedTo[token][0].from;
                transfersByKey[`${token}-${um.amount.toString()}`] = um;
              });
            }
          }

          transfers.push(...Object.values(transfersByKey));
        }
        break;
      }

      case 'STARKNET': {
        if (!Array.isArray(block.transactions)) {
          break;
        }

        for (const tx of block.transactions) {
          const typedTx = tx as {
            transaction_hash: string;
            sender_address: string;
            receipt?: {
              actual_fee?: {
                amount?: string;
                unit?: string;
              };
              events?: {
                keys: string[];
                data: string[];
              }[];
            };
            timestamp?: number | string;
            data_availability?: Record<string, unknown>;
          };

          const timestamp = block.timestamp ? new Date((block.timestamp as number) * 1000).toISOString() : null;

          let transactionGasFee = BigInt(0);
          if (typedTx?.receipt?.actual_fee?.amount) {
            transactionGasFee = BigInt(typedTx.receipt.actual_fee.amount);
          }

          const transactionHash = typedTx.transaction_hash;

          if (!typedTx.receipt?.events) {
            continue;
          }

          for (const event of typedTx.receipt.events) {
            if (!event.keys.includes('0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9')) {
              continue;
            }
            if (event.data.length < 3) {
              continue;
            }

            const [from, to, amountHex] = event.data;
            const amount = BigInt(amountHex);

            transfers.push({
              amount,
              blockNumber: block.block_number as number,
              from,
              timestamp,
              to,
              token: null,
              tokenType: 'NATIVE',
              transactionGasFee,
              transactionHash,
            });
          }
        }
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

      case 'SUI': {
        const blockNumber = parseInt(block.sequence as string, 10);
        const blockTimestamp = new Date(parseInt(block.timestamp as string, 10)).toISOString();

        const transactions = (block.transactions as any[]) || [];
        for (const tx of transactions) {
          const transactionHash = tx.digest as string;

          let transactionGasFee = BigInt(0);
          if (tx.effects?.gasUsed) {
            const gu = tx.effects.gasUsed;
            transactionGasFee =
              BigInt(gu.computationCost) +
              BigInt(gu.storageCost) -
              BigInt(gu.storageRebate) +
              BigInt(gu.nonRefundableStorageFee);
            if (transactionGasFee < 0n) {
              transactionGasFee = 0n;
            }
          }
          const balanceChanges = (tx.balanceChanges as any[]) || [];
          for (const bc of balanceChanges) {
            let rawAmt = BigInt(bc.amount as string);
            if (rawAmt === 0n) continue;

            let fromAddr: string | undefined;
            let toAddr: string | undefined;

            const rawOwner =
              bc.owner?.AddressOwner ||
              bc.owner?.ObjectOwner ||
              bc.owner?.Shared?.initial_shared_version ||
              'UNKNOWN_OWNER';

            if (rawAmt < 0n) {
              fromAddr = String(rawOwner);
              toAddr = undefined;
              rawAmt = -rawAmt;
            } else {
              fromAddr = undefined;
              toAddr = String(rawOwner);
            }

            transfers.push({
              blockNumber,
              from: fromAddr,
              to: toAddr,
              amount: rawAmt,
              token: bc.coinType as string,
              tokenType: 'NATIVE',
              timestamp: blockTimestamp,
              transactionHash,
              transactionGasFee,
            });
          }
        }
        break;
      }

      case 'TON': {
        const blockNumber = block.seqno as number;
        const blockTimestamp = new Date((block.shards?.[0]?.gen_utime as number) * 1000).toISOString();

        for (const shard of (block.shards as any[]) || []) {
          for (const tx of (shard.transactions as any[]) || []) {
            const transactionLT = tx.transaction_id.lt as string;
            const transactionHash = tx.transaction_id.hash as string;
            const transactionFee = BigInt((tx.fee as string) || '0');

            const inVal = BigInt((tx.in_msg?.value as string) || '0');
            if (inVal > 0n) {
              transfers.push({
                blockNumber,
                from: tx.in_msg?.source?.account_address as string,
                to: tx.address?.account_address as string,
                amount: inVal,
                token: 'TON',
                tokenType: 'NATIVE',
                timestamp: blockTimestamp,
                transactionHash,
                transactionGasFee: transactionFee,
              });
            }

            for (const outMsg of (tx.out_msgs as any[]) || []) {
              const outVal = BigInt((outMsg.value as string) || '0');
              if (outVal > 0n) {
                transfers.push({
                  blockNumber,
                  from: outMsg.source?.account_address as string,
                  to: outMsg.destination?.account_address as string,
                  amount: outVal,
                  token: 'TON',
                  tokenType: 'NATIVE',
                  timestamp: blockTimestamp,
                  transactionHash,
                  transactionGasFee: transactionFee,
                });
              }
            }
          }
        }

        break;
      }

      case 'ASTAR':
      case 'ENJIN':
      case 'KUSAMA':
      case 'POLKADOT':
      case 'BITTENSOR': {
        const typedBlock = block as {
          blockNumber: number;
          header: { number: string };
          extrinsics: {
            method: string;
            signer: string;
            args: any[];
            hash: string;
          }[];
        };

        const blockNumber = typedBlock.blockNumber;

        const timestampExtrinsic = typedBlock.extrinsics.find((ex) => ex.method === 'timestamp.set');
        const blockTimestamp = timestampExtrinsic
          ? new Date(Number(timestampExtrinsic.args[0].toString().replace(/,/g, ''))).toISOString()
          : new Date().toISOString();

        for (const extrinsic of typedBlock.extrinsics) {
          if (['balances.transfer', 'balances.transferKeepAlive'].includes(extrinsic.method)) {
            const from = extrinsic.signer;
            const to = (extrinsic.args[0] as { Id?: string })?.Id || '';
            const amount = BigInt((extrinsic.args[1] as string).replace(/,/g, ''));

            transfers.push({
              amount,
              blockNumber,
              from,
              to,
              token: null,
              tokenType: 'NATIVE',
              timestamp: blockTimestamp,
              transactionGasFee: 0n,
              transactionHash: extrinsic.hash,
            });
          }
        }
        break;
      }

      case 'FILECOIN': {
        const typedBlock = block as {
          Height: number;
          Blocks: Array<{ ParentBaseFee: string; Timestamp: number }>;
          messages: Array<{
            blockMessages: {
              BlsMessages?: Array<unknown>;
              SecpkMessages?: Array<{
                Message: {
                  From: string;
                  To: string;
                  Value: string;
                  GasFeeCap: string;
                  GasPremium: string;
                };
                CID: { '/': string };
              }>;
            };
          }>;
          receipts: Array<{ GasUsed: number }>;
        };

        const blockNumber = typedBlock.Height;
        const blockTimestamp = new Date(typedBlock.Blocks[0].Timestamp * 1000).toISOString();
        const parentBaseFee = BigInt(typedBlock.Blocks[0].ParentBaseFee);

        let receiptIndex = 0;

        for (const msgGroup of typedBlock.messages) {
          const secpkMessages = msgGroup.blockMessages.SecpkMessages || [];

          for (const msg of secpkMessages) {
            const receipt = typedBlock.receipts[receiptIndex++];
            const gasUsed = receipt ? BigInt(receipt.GasUsed) : BigInt(0);
            const gasFeeCap = BigInt(msg.Message.GasFeeCap);
            const gasPremium = BigInt(msg.Message.GasPremium);
            const baseFeeBurn = gasUsed * parentBaseFee;
            const minerTip =
              gasUsed * (gasPremium < gasFeeCap - parentBaseFee ? gasPremium : gasFeeCap - parentBaseFee);
            const transactionGasFee = baseFeeBurn + minerTip;

            transfers.push({
              amount: BigInt(msg.Message.Value),
              blockNumber,
              from: msg.Message.From,
              to: msg.Message.To,
              token: null,
              tokenType: 'NATIVE',
              timestamp: blockTimestamp,
              transactionGasFee,
              transactionHash: msg.CID['/'],
            });
          }
        }
        break;
      }

      // attempt to introspect data types
      default: {
        // try Cosmos
        if (block.block) {
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
              if (
                ['/ibc.applications.transfer.v1.MsgTransfer', '/cosmos.bank.v1beta1.MsgSend'].includes(message.typeUrl)
              ) {
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

          break;
        }

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

    const seenTransfers = new Set<string>();

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

      const key = `${txfer.transactionHash}-${txfer.from}-${txfer.to}-${txfer.amount}-${txfer.token}`;

      if (seenTransfers.has(key)) {
        return false;
      }

      seenTransfers.add(key);

      return true;
    });

    return transfers;
  },

  tests: [
    // APTOS
    {
      params: {
        network: 'APTOS',
        walletAddress: '0x5bd7de5c56d5691f32ea86c973c73fec7b1445e59736c97158020018c080bb00',
        contractAddress: '0x3b5d2e7e8da86903beb19d5a7135764aac812e18af193895d75f3a8f6a066cb0',
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

    // APTOS
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

    // BITTENSOR
    {
      params: {
        network: 'BITTENSOR',
        walletAddress: '5G6WmJ4mym9oSQzUF5tr7LvsNMvH5vWtutZM8vMvRv1Wwy6J',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/bittensor/2652896',
      output: [
        {
          amount: 2154999850n,
          blockNumber: 2652896,
          from: '5G6WmJ4mym9oSQzUF5tr7LvsNMvH5vWtutZM8vMvRv1Wwy6J',
          to: '5CFwmfLfL1Z6vXU6hgGksh6irDFpcVXaTTNRoqDGMyHrDKK1',
          token: null,
          tokenType: 'NATIVE',
          timestamp: '2024-03-28T12:53:36.001Z',
          transactionGasFee: 0n,
          transactionHash: '0x9ea55a8f40b8d7704f27964155476ab9c744ec2ef2b1f431ad0e05a3a6f3c1ab',
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
          timestamp: '+057068-01-19T05:23:20.000Z',
          to: 'addr1q9syxu908lef7r6rsvk0h7gsx3rxj22cuykgx2a2l4hcfd8e9y2e9vtv4w9dyej96w99wwj8hwgc273862lk6a3vt30qjjrund',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 174257n,
          transactionHash: '261c42ba9124f55d8e169ebb692cd3759d796a54369acb316ee449b546e79309',
        },
      ],
    },

    // COSMOS
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

    // FILECOIN
    {
      params: {
        network: 'FILECOIN',
        walletAddress: 'f1e3aa3z6gkaqxxwmbbna5gf2frggswwjaeavx7bq',
        contractAddress: 'f1bqdligg7ipuiizvmdn7ijobhbkwaieh6z6lah5y',
      },
      payload: 'https://jiti.indexing.co/networks/filecoin/4818438',
      output: [
        {
          amount: 7896300000000000000n,
          blockNumber: 4818438,
          from: 'f1e3aa3z6gkaqxxwmbbna5gf2frggswwjaeavx7bq',
          timestamp: '2025-03-24T23:39:00.000Z',
          to: 'f1bqdligg7ipuiizvmdn7ijobhbkwaieh6z6lah5y',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 1592498365133760n,
          transactionHash: 'bafy2bzacecxud3tayyq3caagjej5srufcx5fufjuqkz3ltgfty27wdsrmqeew',
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
          timestamp: '2024-05-19T22:18:52Z',
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

    // STARKNET
    {
      params: {
        network: 'STARKNET',
        walletAddress: '0x309e6b209031362268d62d646a067365e6f6d6eb7f571b5212cbdfd5f26fe54',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/starknet/1149460',
      output: [
        {
          amount: 0x1c286f74458fc6n,
          blockNumber: 1149460,
          from: '0x309e6b209031362268d62d646a067365e6f6d6eb7f571b5212cbdfd5f26fe54',
          timestamp: '2025-02-13T17:36:52.000Z',
          to: '0x1176a1bd84444c89232ec27754698e5d2e7e1a7f1539f12027f28b23ec9f3d8',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 7925758505095110n,
          transactionHash: '0x707203dba31f442ae9a5477e6a8906f3676effa0f1d3bb19cbbc14e1ddfe21',
        },
      ],
    },
    // SUI
    {
      params: {
        network: 'SUI',
        walletAddress: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/sui/132734364',
      output: [
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 5321172n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: '4JWC8DX8eKYhwvRgzesGNWsb5t5RUyQVSNibKxLRaN22',
          transactionGasFee: 5408344n,
        },
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 825772n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: '5bXBDeoYqXTawkf2bCDriAE2M6Vu2EgYKEgJ1hW4qagZ',
          transactionGasFee: 901544n,
        },
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 5321248n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: '6KZYwvaAk76AL9p5kjkA27Tj5Jy47ipCxLKiCXtBbngo',
          transactionGasFee: 5408496n,
        },
        {
          blockNumber: 132734364,
          from: '0x39b9e5942df9a4686ebe727534077281d6adcee15a9bb74d3e052e56d78b2744',
          to: undefined,
          amount: 5321096n,
          token: '0x2::sui::SUI',
          tokenType: 'NATIVE',
          timestamp: '2025-04-11T14:57:40.091Z',
          transactionHash: 'HcJAHtSUypt8z2us2HqDm7PzB5HKS3ASY86pDKNAsgnE',
          transactionGasFee: 5408192n,
        },
      ],
    },
    // TON
    {
      params: {
        network: 'TON',
        walletAddress: 'EQAFukUyzmHjUvOYDOjNE-wbZFFl2FWas1rFJoh8IiTsWD40',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ton/44919328',
      output: [
        {
          blockNumber: 44919328,
          from: 'EQAFukUyzmHjUvOYDOjNE-wbZFFl2FWas1rFJoh8IiTsWD40',
          to: 'EQCFTFAHOU3vFt2NiZhRD5dwuS0k7GS59vIg3WfCKwfaQGW2',
          amount: 10000000n,
          token: 'TON',
          tokenType: 'NATIVE',
          timestamp: '2025-02-13T23:10:18.000Z',
          transactionHash: 'Vh5cWr2uvCsdhoouBQ+EiUcF54os9oqvh8A/62EroQc=',
          transactionGasFee: 2355233n,
        },
      ],
    },

    // SOLANA
    {
      params: {
        network: 'SOLANA',
        walletAddress: 'D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
      payload: 'https://jiti.indexing.co/networks/solana/326286476',
      output: [
        {
          amount: 3000350n,
          blockNumber: 304546603,
          from: 'D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf',
          timestamp: '2025-03-12T14:42:16.000Z',
          to: 'HTd5J9YhYnN1nwCAQiykpNBjoDrgtPVUcpk9TBPMCV4b',
          transactionGasFee: 105000n,
          transactionHash: '3HKaqRRPyA2NHvmf3xzJpgTemxXcextCRmgwWfHpKhDqDbJSqCdy8GtH5zG8tHQU2Dcznf7JgMP7sCLQSoNPw2E5',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: '5u3gUxSsiqddQf1QhRDRQqDaFe9f5S3pyVkVWy77gB85',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/solana/291562718',
      output: [
        {
          amount: 239999n,
          blockNumber: 270452291,
          from: '5u3gUxSsiqddQf1QhRDRQqDaFe9f5S3pyVkVWy77gB85',
          timestamp: '2024-09-23T16:45:56.000Z',
          to: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 45000n,
          transactionHash: '2TKq9VXjQocvyQGraxqRjyF8iASRPCmjJcGXkxYQbTknjFTToVB2rRSLMFCi5VwBx9uJ2fAN1YNt4Wr8TUVRuoMi',
        },
        {
          amount: 1n,
          blockNumber: 270452291,
          from: '5u3gUxSsiqddQf1QhRDRQqDaFe9f5S3pyVkVWy77gB85',
          timestamp: '2024-09-23T16:45:56.000Z',
          to: '8MCjBNEBEyT5uAnDBupUxQ8eiKHJcf4vh546g4uM7cjF',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 45000n,
          transactionHash: '2TKq9VXjQocvyQGraxqRjyF8iASRPCmjJcGXkxYQbTknjFTToVB2rRSLMFCi5VwBx9uJ2fAN1YNt4Wr8TUVRuoMi',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: '5cuy7pMhTPhVZN9xuhgSbykRb986siGJb6vnEtkuBrSU',
        contractAddress: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
      },
      payload: 'https://jiti.indexing.co/networks/solana/325076237',
      output: [
        {
          amount: 14216129n,
          blockNumber: 303338729,
          from: '8KbrpeSRYXYjWSSdG7gE1tR7Go8MmKKxKaei1gGc4U7Q',
          timestamp: '2025-03-07T01:16:59.000Z',
          to: '5cuy7pMhTPhVZN9xuhgSbykRb986siGJb6vnEtkuBrSU',
          transactionGasFee: 353096n,
          transactionHash: '54qvCYcmUvPX6K3KuKG1nGRJWq6696LxwPNsx7DX5rcRsLbFntGEuWCjHTVc5wMcUZhKs1MuXeqpuDswrvNjETNQ',
          token: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
          tokenType: 'TOKEN',
        },
      ],
    },
    {
      params: {
        network: 'SOLANA',
        walletAddress: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
      },
      payload: 'https://jiti.indexing.co/networks/solana/332450156',
      output: [
        {
          amount: 402062750n,
          blockNumber: 310691098,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '5yY5BGRgwa5rxvYPpMV9EkDpwp6w1vNNXUNzUCtMoFfR',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
        },
        {
          amount: 97937250n,
          blockNumber: 310691098,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '9zF2ZWTjnk6UkyWRxNtqy9UHims9u7LSaHGyhA5PwDSx',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
        },
        {
          amount: 19796403663n,
          blockNumber: 310691098,
          timestamp: '2025-04-10T02:29:35.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump',
          tokenType: 'TOKEN',
          from: '4acL7mD2J6GYJy2g3iVTvfpmHCQSZ1rb8DBuupjcVzHJ',
        },
      ],
    },
  ] as TemplateTest[],
};

export default tokenTransfersTemplate;

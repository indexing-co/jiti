import { Cell, beginCell } from '@ton/core';
import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { TonBlock } from '../../types/beats/ton';

// TEP-74 jetton `internal_transfer` op-code. This is the message a recipient's
// jetton wallet receives when it is credited, so it is the canonical signal of a
// jetton deposit landing — and the only jetton message whose executing account
// (`tx.address`) is the recipient jetton wallet itself.
const JETTON_INTERNAL_TRANSFER_OP = 0x178d4519;

type JettonInternalTransfer = {
  amount: bigint;
  from?: string;
};

// Decode a jetton `internal_transfer` message body (a base64-encoded BoC).
// Returns null when the body is absent, is not a BoC, or carries a different
// op-code (text comments, other jetton ops, arbitrary contract calls) — the
// caller then falls back to the native path. Body layout (TEP-74):
//   internal_transfer#0x178d4519 query_id:uint64 amount:(VarUInteger 16)
//     from:MsgAddress response_address:MsgAddress ...
function decodeJettonInternalTransfer(body: string | undefined): JettonInternalTransfer | null {
  if (!body) {
    return null;
  }

  try {
    const slice = Cell.fromBoc(Buffer.from(body, 'base64'))[0].beginParse();
    if (slice.loadUint(32) !== JETTON_INTERNAL_TRANSFER_OP) {
      return null;
    }

    slice.loadUintBig(64); // query_id
    const amount = slice.loadCoins();
    // `from` is the sending owner, read best-effort: it can be addr_none on some
    // mints/airdrops, and rare non-standard address encodings can throw. In
    // either case keep the (valid) amount and let the caller fall back to the
    // message source rather than dropping a real jetton transfer.
    let from: string | undefined;
    try {
      const fromAddress = slice.loadMaybeAddress();
      from = fromAddress ? fromAddress.toString({ urlSafe: true, bounceable: true, testOnly: false }) : undefined;
    } catch {
      from = undefined;
    }

    return { amount, from };
  } catch {
    return null;
  }
}

// Other TEP-74 jetton messages whose `in_msg.value` is only forwarded gas or a
// refund — never a user-facing TON transfer. Emitting a native transfer for
// these surfaces phantom TON hops around every jetton send:
//   0x0f8a7ea5 transfer              — owner → own jetton wallet (attached gas)
//   0x7362d09c transfer_notification — jetton wallet → owner (forwarded gas)
//   0xd53276db excesses              — jetton wallet → response addr (gas refund)
// `internal_transfer` (0x178d4519) is handled above as the jetton TOKEN row.
const JETTON_GAS_ONLY_OPS = new Set<number>([0x0f8a7ea5, 0x7362d09c, 0xd53276db]);

// True when the message body carries one of the jetton gas-only op-codes above.
// Reads only the 32-bit op-code; returns false for text comments, empty/non-BoC
// bodies, or any other op — which fall through to the native path.
function isJettonGasOnlyMessage(body: string | undefined): boolean {
  if (!body) {
    return false;
  }

  try {
    const slice = Cell.fromBoc(Buffer.from(body, 'base64'))[0].beginParse();
    return JETTON_GAS_ONLY_OPS.has(slice.loadUint(32));
  } catch {
    return false;
  }
}

export const TONTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'TON',

  transform(block) {
    const transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as TonBlock;
    const blockNumber = typedBlock.seqno;

    for (const shard of typedBlock.shards || []) {
      for (const tx of shard.transactions || []) {
        const inMsg = tx.in_msg;
        if (!inMsg) {
          continue;
        }

        const transactionHash = tx.transaction_id?.hash;
        const transactionGasFee = BigInt(tx.fee || '0');
        // Per-transaction time. shards[0].gen_utime — the previous source — is
        // wrong for any transaction outside the first shard and is undefined for
        // empty shards (producing `Invalid Date`).
        const timestamp = new Date((tx.utime || 0) * 1000).toISOString();
        // The account this transaction executed on: the recipient account for a
        // native transfer, or the recipient's jetton wallet for a jetton one
        // (== in_msg.destination).
        const to = tx.address?.account_address;

        // Walk `in_msg` only: every transfer is recorded once, at the
        // recipient's transaction, with `from` carried on the row so sender
        // queries still match. Walking `out_msgs` too would double-emit each hop
        // — the sender's and the recipient's transactions both fall in range.
        const jetton = decodeJettonInternalTransfer(inMsg.msg_data?.body);
        if (jetton) {
          // Jetton and native value are mutually exclusive per message: a jetton
          // `internal_transfer` also carries forwarded gas as `in_msg.value`, so
          // emitting a native transfer here too would surface a phantom TON hop.
          transfers.push({
            blockNumber,
            from: jetton.from || inMsg.source?.account_address,
            to,
            amount: jetton.amount,
            // The jetton master is not carried in the wallet-to-wallet
            // `internal_transfer`; a stateless template can't resolve it without
            // an RPC call, so `token` is intentionally left undefined.
            tokenType: 'TOKEN',
            timestamp,
            transactionHash,
            transactionGasFee,
          });
          continue;
        }

        // A jetton send's own gas hops (transfer / transfer_notification /
        // excesses) carry `in_msg.value` as forwarded gas, not a real TON
        // transfer — skip them so they don't surface as phantom native transfers
        // alongside the jetton `internal_transfer` row emitted above.
        if (isJettonGasOnlyMessage(inMsg.msg_data?.body)) {
          continue;
        }

        const inValue = BigInt(inMsg.value || '0');
        if (inValue > 0n) {
          transfers.push({
            blockNumber,
            from: inMsg.source?.account_address,
            to,
            amount: inValue,
            token: 'TON',
            tokenType: 'NATIVE',
            timestamp,
            transactionHash,
            transactionGasFee,
          });
        }
      }
    }

    return transfers;
  },

  tests: [
    {
      // Native TON transfer — `in_msg` carries value and no jetton body.
      params: {
        network: 'TON',
        transactionHash: 'rwDRQeWniNdxBayFcDavE/Wo35B+MsfO4lJJmvz5Edk=',
      },
      payload: 'https://jiti.indexing.co/networks/ton/71399000',
      output: [
        {
          blockNumber: 71399000,
          from: 'EQBkhlXTyZjri7SfyZcgFbRkjlLvq4kU3UjBTtiTtwLITn0H',
          to: 'EQABGo8KCza3ea8DNHMnSWZmbRzW-05332eTdfvW-XDQEjQM',
          amount: 203686310466n,
          token: 'TON',
          tokenType: 'NATIVE',
          timestamp: '2026-06-05T15:31:47.000Z',
          transactionHash: 'rwDRQeWniNdxBayFcDavE/Wo35B+MsfO4lJJmvz5Edk=',
          transactionGasFee: 6668n,
        },
      ],
    },
    {
      // Jetton transfer — `in_msg` is an internal_transfer (op 0x178d4519). The
      // message also carries 49740664 nanoTON of forwarded gas, which must NOT
      // surface as a phantom native transfer. `token` is left undefined (the
      // jetton master is not in the wallet-to-wallet message).
      params: {
        network: 'TON',
        transactionHash: 'Tx+nOxUzqo8kYpNkX20C2OTg6Dd9d6MHadQsknv4620=',
      },
      payload: 'https://jiti.indexing.co/networks/ton/71399000',
      output: [
        {
          blockNumber: 71399000,
          from: 'EQDshc_H_RAJNi5CG1oBQfUQ1lQBB6tz54Kf2h756Xp14_Cv',
          to: 'EQBMzIc7YUB_WkSkmaIooZyONQDayNfipt3PQ4IJRsGXsPGI',
          amount: 2800000000n,
          tokenType: 'TOKEN',
          timestamp: '2026-06-05T15:31:47.000Z',
          transactionHash: 'Tx+nOxUzqo8kYpNkX20C2OTg6Dd9d6MHadQsknv4620=',
          transactionGasFee: 233386n,
        },
      ],
    },
    {
      // Jetton gas hops must not surface as native transfers. Synthetic block
      // (inline payload, no network) with four txs: a genuine native transfer,
      // an `excesses` (0xd53276db), a `transfer_notification` (0x7362d09c), and a
      // jetton `internal_transfer` (0x178d4519). Only the native and the jetton
      // rows survive; the two gas-only ops are dropped despite carrying value.
      params: { network: 'TON' },
      payload: {
        _network: 'TON',
        seqno: 76697922,
        shards: [
          {
            transactions: [
              {
                address: { account_address: 'EQrecipient_native' },
                utime: 1782844609,
                fee: '100',
                transaction_id: { hash: 'native-hash' },
                in_msg: {
                  value: '1000000000',
                  source: { account_address: 'EQsender_native' },
                  msg_data: {},
                },
              },
              {
                address: { account_address: 'EQsubject' },
                utime: 1782844609,
                fee: '100',
                transaction_id: { hash: 'excesses-hash' },
                in_msg: {
                  value: '49490794',
                  source: { account_address: 'EQjetton_wallet' },
                  msg_data: {
                    body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell().toBoc().toString('base64'),
                  },
                },
              },
              {
                address: { account_address: 'EQowner' },
                utime: 1782844609,
                fee: '100',
                transaction_id: { hash: 'notification-hash' },
                in_msg: {
                  value: '49490794',
                  source: { account_address: 'EQowner_jetton_wallet' },
                  msg_data: {
                    body: beginCell().storeUint(0x7362d09c, 32).storeUint(0, 64).endCell().toBoc().toString('base64'),
                  },
                },
              },
              {
                address: { account_address: 'EQrecipient_jetton_wallet' },
                utime: 1782844609,
                fee: '200',
                transaction_id: { hash: 'jetton-hash' },
                in_msg: {
                  value: '49740664',
                  source: { account_address: 'EQsender_jetton_wallet' },
                  msg_data: {
                    body: beginCell()
                      .storeUint(0x178d4519, 32)
                      .storeUint(0, 64)
                      .storeCoins(2800000000n)
                      .storeAddress(null)
                      .endCell()
                      .toBoc()
                      .toString('base64'),
                  },
                },
              },
            ],
          },
        ],
      },
      output: [
        {
          blockNumber: 76697922,
          from: 'EQsender_native',
          to: 'EQrecipient_native',
          amount: 1000000000n,
          token: 'TON',
          tokenType: 'NATIVE',
          timestamp: '2026-06-30T18:36:49.000Z',
          transactionHash: 'native-hash',
          transactionGasFee: 100n,
        },
        {
          blockNumber: 76697922,
          from: 'EQsender_jetton_wallet',
          to: 'EQrecipient_jetton_wallet',
          amount: 2800000000n,
          tokenType: 'TOKEN',
          timestamp: '2026-06-30T18:36:49.000Z',
          transactionHash: 'jetton-hash',
          transactionGasFee: 200n,
        },
      ],
    },
  ],
};

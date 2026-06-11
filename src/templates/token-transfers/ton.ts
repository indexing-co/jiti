import { Cell } from '@ton/core';
import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { TonBlock, TonBlockShardsTransactionsOutMsgs } from '../../types/beats/ton';

// TEP-74 jetton `internal_transfer` op-code. This is the message a recipient's
// jetton wallet receives when it is credited, so it is the canonical signal of a
// jetton deposit landing — and the only jetton message whose executing account
// (`tx.address`) is the recipient jetton wallet itself.
const JETTON_INTERNAL_TRANSFER_OP = 0x178d4519;

// TEP-74 jetton `transfer_notification` op-code. A recipient's jetton wallet
// sends this to its OWNER, in the same transaction that credits it, when the
// transfer carried `forward_ton_amount > 0`. Its destination is the only in-band
// signal of the owner behind a jetton wallet; absent for `forward_ton_amount == 0`
// (the owner then cannot be resolved without a contract-state lookup).
const JETTON_TRANSFER_NOTIFICATION_OP = 0x7362d09c;

// Resolve the owner behind a recipient jetton wallet from the wallet's
// `transfer_notification` out-message. Returns undefined when none is present
// (forward_ton_amount == 0) or the body is not a recognisable BoC.
function recipientOwnerFromNotification(outMsgs: TonBlockShardsTransactionsOutMsgs[] | undefined): string | undefined {
  for (const out of outMsgs || []) {
    const body = out.msg_data?.body;
    if (!body) {
      continue;
    }

    try {
      const slice = Cell.fromBoc(Buffer.from(body, 'base64'))[0].beginParse();
      if (slice.loadUint(32) === JETTON_TRANSFER_NOTIFICATION_OP) {
        return out.destination?.account_address;
      }
    } catch {
      // Not a BoC / unexpected shape — keep scanning the remaining out-messages.
    }
  }

  return undefined;
}

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
          // Jetton transfers settle on per-(owner, jetton) wallets, not on the
          // owners. Surface owners on `from`/`to` (matching the Solana
          // convention) and the settling jetton wallets on
          // `fromTokenAccount`/`toTokenAccount`. The recipient owner is the
          // destination of the `transfer_notification` the wallet forwards in
          // this same transaction when `forward_ton_amount > 0`; absent for
          // `forward_ton_amount == 0`, where `to` falls back to the jetton wallet
          // (the owner is not recoverable without a contract-state lookup).
          const recipientOwner = recipientOwnerFromNotification(tx.out_msgs);
          // Jetton and native value are mutually exclusive per message: a jetton
          // `internal_transfer` also carries forwarded gas as `in_msg.value`, so
          // emitting a native transfer here too would surface a phantom TON hop.
          transfers.push({
            blockNumber,
            from: jetton.from || inMsg.source?.account_address,
            fromTokenAccount: inMsg.source?.account_address,
            to: recipientOwner || to,
            toTokenAccount: to,
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
      // Jetton transfer — `in_msg` is an internal_transfer (op 0x178d4519) that
      // also carries forwarded gas as `in_msg.value`, which must NOT surface as a
      // phantom native transfer. `token` is left undefined (the jetton master is
      // not in the wallet-to-wallet message). This transfer carried
      // `forward_ton_amount > 0`, so the recipient wallet forwarded a
      // `transfer_notification` to its owner: `from`/`to` are the owners and
      // `fromTokenAccount`/`toTokenAccount` are the jetton wallets.
      params: {
        network: 'TON',
        transactionHash: 'Tx+nOxUzqo8kYpNkX20C2OTg6Dd9d6MHadQsknv4620=',
      },
      payload: 'https://jiti.indexing.co/networks/ton/71399000',
      output: [
        {
          blockNumber: 71399000,
          from: 'EQDshc_H_RAJNi5CG1oBQfUQ1lQBB6tz54Kf2h756Xp14_Cv',
          fromTokenAccount: 'EQBkdsNpKnwQ-TRIKDo33AUxe1EAXdY1RqcgrvCDC3AeEVz-',
          to: 'EQBQmL3n0mWa1Uo0qlQlauc47bmqJMugKRu_lYJDUGVYmut1',
          toTokenAccount: 'EQBMzIc7YUB_WkSkmaIooZyONQDayNfipt3PQ4IJRsGXsPGI',
          amount: 2800000000n,
          tokenType: 'TOKEN',
          timestamp: '2026-06-05T15:31:47.000Z',
          transactionHash: 'Tx+nOxUzqo8kYpNkX20C2OTg6Dd9d6MHadQsknv4620=',
          transactionGasFee: 233386n,
        },
      ],
    },
  ],
};

import bs58 from 'bs58';
import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import type { SvmBlock } from '../../types/beats/svm';
import { RelayOrderEvent } from './types';
import { SVM_RELAY_TESTS } from './svm.fixtures';

// Solana side of Relay orders (verified 2026-09-13 against api.relay.link):
//   DEPOSIT: the Relay depository program emits an Anchor event per deposit:
//            discriminator(8) | depositor pubkey(32) | Option<mint>(1 [+32]) | amount u64 LE(8) | order id(32)
//            A None mint is a native SOL deposit.
//   PAYOUT:  solver fills are a plain transfer plus Memos carrying "0x" + 64 hex: the order id, and also Relay's
//            request id. Their order isn't guaranteed, so a PAYOUT is emitted per memo; joining on orderId ignores the
//            request-id one. The recipient is whoever's balance of the paid token went up in that transaction.
export const RELAY_DEPOSITORY_PROGRAM = '99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2';
const DEPOSIT_EVENT_DISCRIMINATOR = '78f83d531f8e6b90';
const MEMO_PROGRAMS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);
const ORDER_ID_TEXT = /^0x[0-9a-fA-F]{64}$/;

type Tx = SvmBlock['transactions'][number];

function accountKeys(tx: Tx): string[] {
  return (tx.transaction.message.accountKeys as (string | { pubkey: string })[])
    .concat(tx.meta.loadedAddresses?.writable || [], tx.meta.loadedAddresses?.readonly || [])
    .map((a) => (typeof a === 'string' ? a : a.pubkey));
}

function decodeDepositEvent(data: Buffer) {
  if (data.length < 8 + 32 + 1 + 8 + 32 || data.subarray(0, 8).toString('hex') !== DEPOSIT_EVENT_DISCRIMINATOR)
    return null;
  const depositor = bs58.encode(data.subarray(8, 40));
  const hasMint = data[40] === 1;
  const at = hasMint ? 73 : 41;
  if (data[40] > 1 || data.length !== at + 8 + 32) return null;
  return {
    depositor,
    token: hasMint ? bs58.encode(data.subarray(41, 73)) : 'native',
    amount: data.readBigUInt64LE(at),
    orderId: '0x' + data.subarray(at + 8, at + 40).toString('hex'),
  };
}

export const SVMRelayOrders: SubTemplate = {
  match: (block) => blockToVM(block) === 'SVM',

  transform(block) {
    const typedBlock = block as unknown as SvmBlock;
    const network = String(block._network || '').toUpperCase();
    const timestamp = typedBlock.blockTime ? new Date(typedBlock.blockTime * 1000).toISOString() : null;
    const blockNumber = typedBlock.parentSlot + 1;
    const events: RelayOrderEvent[] = [];

    for (const tx of typedBlock.transactions || []) {
      if (!tx?.meta || tx.meta.err) continue;
      const keys = accountKeys(tx);
      const base = { network, blockNumber, timestamp, transactionHash: tx.transaction.signatures[0] };

      if (keys.includes(RELAY_DEPOSITORY_PROGRAM)) {
        for (const line of tx.meta.logMessages || []) {
          if (!line.startsWith('Program data: ')) continue;
          const deposit = decodeDepositEvent(Buffer.from(line.slice('Program data: '.length), 'base64'));
          if (deposit) {
            events.push({
              ...base,
              type: 'DEPOSIT',
              orderId: deposit.orderId,
              address: deposit.depositor,
              token: deposit.token,
              amount: deposit.amount,
            });
          }
        }
      }

      const instructions = [
        ...tx.transaction.message.instructions,
        ...(tx.meta.innerInstructions || []).flatMap((inner) => inner.instructions),
      ];
      const orderIds = instructions
        .filter((ix) => MEMO_PROGRAMS.has(keys[ix.programIdIndex]))
        .map((ix) => Buffer.from(bs58.decode(ix.data)).toString('utf8').trim())
        .filter((text) => ORDER_ID_TEXT.test(text))
        .map((text) => text.toLowerCase());
      if (!orderIds.length) continue;

      // The recipient: the largest increase in any token balance (SPL), falling back to SOL.
      let best: { owner: string; token: string; amount: bigint } | null = null;
      const pre = new Map((tx.meta.preTokenBalances || []).map((b) => [b.accountIndex, b]));
      for (const post of tx.meta.postTokenBalances || []) {
        const delta =
          BigInt(post.uiTokenAmount.amount) - BigInt(pre.get(post.accountIndex)?.uiTokenAmount.amount || '0');
        if (delta > 0n && post.owner && (!best || delta > best.amount))
          best = { owner: post.owner, token: post.mint, amount: delta };
      }
      if (!best) {
        const signer = keys[0];
        tx.meta.postBalances.forEach((postBal, i) => {
          const delta = BigInt(postBal) - BigInt(tx.meta.preBalances[i] || 0);
          if (keys[i] !== signer && delta > 0n && (!best || delta > best.amount))
            best = { owner: keys[i], token: 'native', amount: delta };
        });
      }
      if (!best) continue;
      const recipient = best as { owner: string; token: string; amount: bigint };
      for (const orderId of orderIds) {
        events.push({
          ...base,
          type: 'PAYOUT',
          orderId,
          address: recipient.owner,
          token: recipient.token,
          amount: recipient.amount,
        });
      }
    }
    return events;
  },

  tests: SVM_RELAY_TESTS,
};

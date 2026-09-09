import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { HederaBlock, HederaTransaction } from '../../types/beats/hedera';

/**
 * Hedera NATIVE (HAPI) transfers, read from the mirror node.
 *
 * Hedera's JSON-RPC relay — the source behind the `HEDERA` EVM network — can only see
 * transactions that have an EVM shape (ETHEREUMTRANSACTION / CONTRACTCALL). Measured on
 * 1,000 consecutive mainnet transactions (2026-09-09): of 84 value-moving transactions
 * over 1 HBAR, 72 (85.7%) were native CRYPTOTRANSFER/HTS records with no EVM surface at
 * all. Those are invisible to the EVM rail — no EVM hash, no logs — which is why the
 * native rail exists rather than being folded into the existing network.
 *
 * ## Why `transfers[]` cannot be read literally
 *
 * The mirror node reports NET BALANCE DELTAS per account, not sender/receiver pairs, and
 * folds four kinds of protocol plumbing into the same array. Pairing them naively picks up
 * the fee collector as a counterparty and reports the wrong sender on a large share of
 * transactions — the same failure class Mesh filed against LTC on 2026-09-04, where
 * 63-76% of `from` addresses were wrong.
 *
 * The deltas are reduced to true economic movement in four steps, each verified against
 * live mainnet records (see tests):
 *
 *  1. drop the submitting consensus node's entry (`tx.node`) and the system fee/reward
 *     accounts — they collect fees, they are not counterparties;
 *  2. subtract `staking_reward_transfers` from the receiving account's delta — a staking
 *     payout rides along inside an unrelated transfer and otherwise inflates the amount
 *     credited to the recipient (fixture `0.0.1917742-1788980848-211302804` overstates the
 *     recipient by 108,992,000 tinybars without this step);
 *  3. credit `charged_tx_fee` back to the fee payer (the account prefix of
 *     `transaction_id`), whose delta is otherwise the transfer PLUS the fee;
 *  4. what remains balances exactly — negatives are senders, positives are receivers.
 *
 * Step 4 balancing is the invariant worth leaning on: on every sampled record the sender
 * and receiver totals agree to the tinybar once 1-3 are applied.
 *
 * ## Identifiers
 *
 * `transactionHash` is the hex form of the 48-byte HAPI transaction hash — the value a
 * "hash watch" matches, and what the Hedera SDK hands back as `TransactionResponse
 * .transactionHash`. Hedera's other canonical id, `transaction_id` (`payer-validStart`,
 * what Hashscan URLs use), has no slot of its own on NetworkTransfer, so it is carried in
 * `index` as `<transaction_id>:<n>` — which also keeps the dedup key stable across the
 * fan-out below. Addresses are native `0.0.x` entity ids, NOT the 0x EVM aliases the EVM
 * rail reports for the same accounts.
 */

// System accounts that appear in `transfers` as fee/reward plumbing rather than as a
// counterparty: 0.0.98 fee collector, 0.0.800 staking reward, 0.0.801 node reward,
// 0.0.802 the current fee collection account. The submitting node is excluded separately,
// per-transaction, off the record's own `node` field — reading it beats guessing at a
// reserved account-number range, which grows as the council adds nodes.
const SYSTEM_FEE_ACCOUNTS = new Set(['0.0.98', '0.0.800', '0.0.801', '0.0.802']);

// HBAR is denominated in tinybars (8dp) on the native rail. Set explicitly rather than
// omitted, because the SAME asset is reported in weibars (18dp) on the Hedera EVM rail,
// which mirrors the JSON-RPC relay. An implicit scale here is a 10^10 error waiting to
// happen for any consumer reading both rails.
const TINYBAR_DECIMALS = 8;

// `1788980682.181209584` -> ISO. Consensus timestamps carry nanosecond precision; Date
// holds milliseconds, so the sub-millisecond remainder is dropped (never rounded up —
// a timestamp must not travel forward past the block window it was fetched in).
function hederaTimestampToISO(ts: string | undefined): string | null {
  if (!ts) return null;
  const [seconds, nanos = ''] = ts.split('.');
  const millis = Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, '0')) / 1_000_000);
  return new Date(millis).toISOString();
}

function decodeBase64(value: string | null | undefined, encoding: 'utf8' | 'hex'): string | undefined {
  if (!value) return undefined;
  const decoded = Buffer.from(value, 'base64').toString(encoding);
  return decoded.length ? decoded : undefined;
}

/**
 * Steps 1-3 above: reduce `transfers[]` to true economic movement, keyed by account.
 * Zero deltas (an account that only paid the fee) drop out entirely.
 */
function netHbarDeltas(tx: HederaTransaction): Map<string, bigint> {
  const deltas = new Map<string, bigint>();
  const add = (account: string, amount: bigint) => {
    const next = (deltas.get(account) ?? 0n) + amount;
    deltas.set(account, next);
  };

  for (const entry of tx.transfers || []) {
    if (entry.account === tx.node || SYSTEM_FEE_ACCOUNTS.has(entry.account)) {
      continue;
    }
    add(entry.account, BigInt(entry.amount));
  }

  for (const reward of tx.staking_reward_transfers || []) {
    add(reward.account, -BigInt(reward.amount));
  }

  const payer = tx.transaction_id?.split('-')[0];
  if (payer && deltas.has(payer)) {
    add(payer, BigInt(tx.charged_tx_fee ?? 0));
  }

  for (const [account, amount] of Array.from(deltas.entries())) {
    if (amount === 0n) {
      deltas.delete(account);
    }
  }

  return deltas;
}

/**
 * Split netted deltas into sender -> receiver edges.
 *
 * The overwhelmingly common shape is one sender fanning out to N receivers (an NFT sale
 * paying seller + royalty recipients, say), which this reproduces exactly. A record with
 * multiple senders AND multiple receivers has no canonical pairing — the protocol only
 * commits to the totals — so edges are filled greedily in record order. Totals are
 * preserved either way; only the attribution between several simultaneous senders is a
 * convention.
 */
function pairDeltas(deltas: Map<string, bigint>): { from: string; to: string; amount: bigint }[] {
  const senders = Array.from(deltas.entries())
    .filter(([, amount]) => amount < 0n)
    .map(([account, amount]) => ({ account, remaining: -amount }));
  const receivers = Array.from(deltas.entries())
    .filter(([, amount]) => amount > 0n)
    .map(([account, amount]) => ({ account, remaining: amount }));

  const edges: { from: string; to: string; amount: bigint }[] = [];
  let s = 0;
  let r = 0;
  while (s < senders.length && r < receivers.length) {
    const amount = senders[s].remaining < receivers[r].remaining ? senders[s].remaining : receivers[r].remaining;
    if (amount > 0n) {
      edges.push({ from: senders[s].account, to: receivers[r].account, amount });
      senders[s].remaining -= amount;
      receivers[r].remaining -= amount;
    }
    if (senders[s].remaining === 0n) s++;
    if (receivers[r].remaining === 0n) r++;
  }

  return edges;
}

/** Fungible HTS deltas net the same way, per token — minus the fee plumbing, which is HBAR-only. */
function netTokenDeltas(tx: HederaTransaction): Map<string, Map<string, bigint>> {
  const byToken = new Map<string, Map<string, bigint>>();

  for (const entry of tx.token_transfers || []) {
    const deltas = byToken.get(entry.token_id) ?? new Map<string, bigint>();
    deltas.set(entry.account, (deltas.get(entry.account) ?? 0n) + BigInt(entry.amount));
    byToken.set(entry.token_id, deltas);
  }

  for (const deltas of byToken.values()) {
    for (const [account, amount] of Array.from(deltas.entries())) {
      if (amount === 0n) {
        deltas.delete(account);
      }
    }
  }

  return byToken;
}

export const HederaTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'HEDERA',

  transform(block) {
    const transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as HederaBlock;

    if (!Array.isArray(typedBlock.transactions)) {
      return [];
    }

    for (const tx of typedBlock.transactions) {
      // A failed record still charges a fee and still appears in the block — the live
      // sample carried an ETHEREUMTRANSACTION with `WRONG_NONCE` — but it moved no value.
      if (tx.result !== 'SUCCESS') {
        continue;
      }

      const timestamp = hederaTimestampToISO(tx.consensus_timestamp);
      const transactionHash = decodeBase64(tx.transaction_hash, 'hex') ?? '';
      const memo = decodeBase64(tx.memo_base64, 'utf8');
      const transactionGasFee = BigInt(tx.charged_tx_fee ?? 0);
      let n = 0;
      const nextIndex = () => `${tx.transaction_id}:${n++}`;

      const base = { blockNumber: typedBlock.number, memo, timestamp, transactionGasFee, transactionHash };

      for (const edge of pairDeltas(netHbarDeltas(tx))) {
        transfers.push({
          ...base,
          amount: edge.amount,
          decimals: TINYBAR_DECIMALS,
          from: edge.from,
          index: nextIndex(),
          to: edge.to,
          token: 'HBAR',
          tokenType: 'NATIVE',
        });
      }

      for (const [token, deltas] of netTokenDeltas(tx)) {
        const edges = pairDeltas(deltas);
        if (edges.length) {
          for (const edge of edges) {
            transfers.push({
              ...base,
              amount: edge.amount,
              from: edge.from,
              index: nextIndex(),
              to: edge.to,
              token,
              tokenType: 'TOKEN',
            });
          }
          continue;
        }
        // Supply changes (TOKENMINT credits the treasury, TOKENWIPE/TOKENBURN debit a
        // holder) are one-sided: real balance movement with no counterparty. Emitting them
        // with a null counterparty keeps a watched account's balance change visible, the
        // way a failed XRPL payment still reports its burned fee.
        for (const [account, amount] of deltas) {
          transfers.push({
            ...base,
            amount: amount < 0n ? -amount : amount,
            from: amount < 0n ? account : null,
            index: nextIndex(),
            to: amount < 0n ? null : account,
            token,
            tokenType: 'TOKEN',
          });
        }
      }

      for (const nft of tx.nft_transfers || []) {
        transfers.push({
          ...base,
          amount: 1n,
          from: nft.sender_account_id ?? null,
          index: nextIndex(),
          to: nft.receiver_account_id ?? null,
          token: nft.token_id,
          tokenId: String(nft.serial_number),
          tokenType: 'NFT',
        });
      }
    }

    return transfers;
  },

  tests: [
    // One real mainnet record file (block 99808576, 2026-09-09) carrying every shape the
    // rail has to get right. Inline rather than fetched: HEDERA_NATIVE has no published
    // beats until oscar's pacemaker ships, and these amounts are the whole point of the
    // template — they must stay pinned to bytes that came off the chain.
    //
    //   1. ETHEREUMTRANSACTION / WRONG_NONCE  -> emits nothing (fee charged, no value moved)
    //   2. CRYPTOTRANSFER, memo-routed deposit -> 4,237.93872559 HBAR, fee credited back to
    //      the payer so the sender's delta matches the receiver's to the tinybar
    //   3. CRYPTOTRANSFER carrying a staking reward -> 12,232,311,230 tinybars, NOT the
    //      12,341,303,230 the raw receiver delta shows (108,992,000 of that is the reward)
    //   4. CRYPTOTRANSFER of a fungible HTS token -> HBAR nets to zero (pure fee), so only
    //      the token edge is emitted
    //   5. NFT sale -> ONE sender fanning out to 8 receivers (seller + royalties), summing
    //      to exactly 79,200,000,000 tinybars, plus the 2 NFT edges
    //   6. TOKENWIPE -> one-sided supply change, emitted with a null counterparty
    {
      params: { network: 'HEDERA_NATIVE' },
      payload: {
        _network: 'HEDERA_NATIVE',
        count: 6,
        hash: '0xb2c721683e6213264fd89500755d040260a3e771d6056ffe080d98c890786817',
        number: 99808576,
        previous_hash: '0x77414a0aa4f8981965bea01c20ea5e469a2910bf32b540ded0d31bd35a8f83aa',
        timestamp: {
          from: '1788980680.188146104',
          to: '1788980682.181209584',
        },
        transactions: [
          {
            charged_tx_fee: 1576202,
            consensus_timestamp: '1788980682.181209584',
            entity_id: null,
            memo_base64: '',
            name: 'ETHEREUMTRANSACTION',
            nft_transfers: [],
            node: '0.0.8',
            nonce: 0,
            parent_consensus_timestamp: null,
            result: 'WRONG_NONCE',
            scheduled: false,
            staking_reward_transfers: [],
            token_transfers: [],
            transaction_hash: 'z8yhwuxDV4F7zXVOb416dIQYYC8q+0JXtkvZsMm561Niw88idbZmv+bBzH0Qh8re',
            transaction_id: '0.0.6319439-1788980678-284279404',
            transfers: [
              {
                account: '0.0.802',
                amount: 1576202,
              },
              {
                account: '0.0.6319439',
                amount: -1576202,
              },
            ],
          },
          {
            charged_tx_fee: 128145,
            consensus_timestamp: '1788981006.916824104',
            entity_id: null,
            memo_base64: 'MzMyNjU0ODMxMzU5NjM4',
            name: 'CRYPTOTRANSFER',
            nft_transfers: [],
            node: '0.0.4',
            nonce: 0,
            parent_consensus_timestamp: null,
            result: 'SUCCESS',
            scheduled: false,
            staking_reward_transfers: [],
            token_transfers: [],
            transaction_hash: '6MejKQ+8u6c0jwM3EZ09IT3XHFmbEQXC6BEwi1ykOZYyW+cI3o+O+Tn0iTO25rj7',
            transaction_id: '0.0.6288870-1788981001-310917355',
            transfers: [
              {
                account: '0.0.802',
                amount: 128145,
              },
              {
                account: '0.0.6125942',
                amount: 423793872559,
              },
              {
                account: '0.0.6288870',
                amount: -423794000704,
              },
            ],
          },
          {
            charged_tx_fee: 128145,
            consensus_timestamp: '1788980849.010696048',
            entity_id: null,
            memo_base64: '',
            name: 'CRYPTOTRANSFER',
            nft_transfers: [],
            node: '0.0.36',
            nonce: 0,
            parent_consensus_timestamp: null,
            result: 'SUCCESS',
            scheduled: false,
            staking_reward_transfers: [
              {
                account: '0.0.10025017',
                amount: 108992000,
              },
            ],
            token_transfers: [],
            transaction_hash: '12Cb6/FsfR8g5AyEiDuLKn2S4dt4UM1RxGhRIuRdnASLaG+ddKhgQChqEl9hGRR/',
            transaction_id: '0.0.1917742-1788980848-211302804',
            transfers: [
              {
                account: '0.0.800',
                amount: -108992000,
              },
              {
                account: '0.0.802',
                amount: 128145,
              },
              {
                account: '0.0.1917742',
                amount: -12232439375,
              },
              {
                account: '0.0.10025017',
                amount: 12341303230,
              },
            ],
          },
          {
            charged_tx_fee: 1281463,
            consensus_timestamp: '1788980867.267312104',
            entity_id: null,
            memo_base64: '',
            name: 'CRYPTOTRANSFER',
            nft_transfers: [],
            node: '0.0.7',
            nonce: 0,
            parent_consensus_timestamp: null,
            result: 'SUCCESS',
            scheduled: false,
            staking_reward_transfers: [],
            token_transfers: [
              {
                token_id: '0.0.456858',
                account: '0.0.10810953',
                amount: -2200000,
              },
              {
                token_id: '0.0.456858',
                account: '0.0.10834734',
                amount: 2200000,
              },
            ],
            transaction_hash: '8/Bz0VQyQf1w8+oI5LPz414CCc8bDykRICZ5IFXtJqNSFAFTmzHxCEM44KJuUirt',
            transaction_id: '0.0.10810953-1788980860-436496141',
            transfers: [
              {
                account: '0.0.802',
                amount: 1281463,
              },
              {
                account: '0.0.10810953',
                amount: -1281463,
              },
            ],
          },
          {
            charged_tx_fee: 3331808,
            consensus_timestamp: '1788980871.712203104',
            entity_id: null,
            memo_base64: 'U2VudFggQnVsayBJbnN0YW50IFNlbGwgb2YgMiBORlRzICgxLzEp',
            name: 'CRYPTOTRANSFER',
            nft_transfers: [
              {
                receiver_account_id: '0.0.10294329',
                sender_account_id: '0.0.791797',
                serial_number: 132,
                token_id: '0.0.10128315',
              },
              {
                receiver_account_id: '0.0.10294329',
                sender_account_id: '0.0.791797',
                serial_number: 876,
                token_id: '0.0.10128315',
              },
            ],
            node: '0.0.28',
            nonce: 0,
            parent_consensus_timestamp: null,
            result: 'SUCCESS',
            scheduled: false,
            staking_reward_transfers: [],
            token_transfers: [],
            transaction_hash: 'GP0UNVae2rnXdbu/2WKtiNRWYh27mq3mRxIc/+esI/wvPJfBk6blsVg03Ibop1WY',
            transaction_id: '0.0.10479156-1788980861-876422346',
            transfers: [
              {
                account: '0.0.802',
                amount: 3331808,
              },
              {
                account: '0.0.791797',
                amount: 71406720000,
              },
              {
                account: '0.0.1223480',
                amount: 198000000,
              },
              {
                account: '0.0.10126701',
                amount: 1552320000,
              },
              {
                account: '0.0.10127620',
                amount: 1552320000,
              },
              {
                account: '0.0.10128120',
                amount: 1552320000,
              },
              {
                account: '0.0.10128141',
                amount: 1552320000,
              },
              {
                account: '0.0.10294329',
                amount: -79200000000,
                is_approval: true,
              },
              {
                account: '0.0.10466510',
                amount: 158400000,
              },
              {
                account: '0.0.10479156',
                amount: -3331808,
              },
              {
                account: '0.0.10489694',
                amount: 1227600000,
              },
            ],
          },
          {
            charged_tx_fee: 1281463,
            consensus_timestamp: '1788980893.827865104',
            entity_id: '0.0.485527',
            memo_base64: 'U0tVeA==',
            name: 'TOKENWIPE',
            nft_transfers: [],
            node: '0.0.3',
            nonce: 0,
            parent_consensus_timestamp: null,
            result: 'SUCCESS',
            scheduled: false,
            staking_reward_transfers: [],
            token_transfers: [
              {
                token_id: '0.0.485527',
                account: '0.0.10605209',
                amount: -700,
              },
            ],
            transaction_hash: 'hJIfmF9vnskKyAO/5EJRO/gJ4TFXtSI17+KEQQh6xAPiu9tieABFavQJNpSN07+n',
            transaction_id: '0.0.485516-1788980882-816059439',
            transfers: [
              {
                account: '0.0.802',
                amount: 1281463,
              },
              {
                account: '0.0.485516',
                amount: -1281463,
              },
            ],
          },
        ],
      },
      output: [
        {
          amount: 423793872559n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.6288870',
          index: '0.0.6288870-1788981001-310917355:0',
          memo: '332654831359638',
          timestamp: '2026-09-09T19:10:06.916Z',
          to: '0.0.6125942',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 128145n,
          transactionHash:
            'e8c7a3290fbcbba7348f0337119d3d213dd71c599b1105c2e811308b5ca43996325be708de8f8ef939f48933b6e6b8fb',
        },
        {
          amount: 12232311230n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.1917742',
          index: '0.0.1917742-1788980848-211302804:0',
          memo: undefined,
          timestamp: '2026-09-09T19:07:29.010Z',
          to: '0.0.10025017',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 128145n,
          transactionHash:
            'd7609bebf16c7d1f20e40c84883b8b2a7d92e1db7850cd51c4685122e45d9c048b686f9d74a86040286a125f6119147f',
        },
        {
          amount: 2200000n,
          blockNumber: 99808576,
          from: '0.0.10810953',
          index: '0.0.10810953-1788980860-436496141:0',
          memo: undefined,
          timestamp: '2026-09-09T19:07:47.267Z',
          to: '0.0.10834734',
          token: '0.0.456858',
          tokenType: 'TOKEN',
          transactionGasFee: 1281463n,
          transactionHash:
            'f3f073d1543241fd70f3ea08e4b3f3e35e0209cf1b0f29112026792055ed26a3521401539b31f1084338e0a26e522aed',
        },
        {
          amount: 71406720000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:0',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.791797',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 198000000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:1',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.1223480',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1552320000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:2',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10126701',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1552320000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:3',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10127620',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1552320000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:4',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10128120',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1552320000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:5',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10128141',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 158400000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:6',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10466510',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1227600000n,
          decimals: 8,
          blockNumber: 99808576,
          from: '0.0.10294329',
          index: '0.0.10479156-1788980861-876422346:7',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10489694',
          token: 'HBAR',
          tokenType: 'NATIVE',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1n,
          blockNumber: 99808576,
          from: '0.0.791797',
          index: '0.0.10479156-1788980861-876422346:8',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10294329',
          token: '0.0.10128315',
          tokenId: '132',
          tokenType: 'NFT',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 1n,
          blockNumber: 99808576,
          from: '0.0.791797',
          index: '0.0.10479156-1788980861-876422346:9',
          memo: 'SentX Bulk Instant Sell of 2 NFTs (1/1)',
          timestamp: '2026-09-09T19:07:51.712Z',
          to: '0.0.10294329',
          token: '0.0.10128315',
          tokenId: '876',
          tokenType: 'NFT',
          transactionGasFee: 3331808n,
          transactionHash:
            '18fd1435569edab9d775bbbfd962ad88d456621dbb9aade647121cffe7ac23fc2f3c97c193a6e5b15834dc86e8a75598',
        },
        {
          amount: 700n,
          blockNumber: 99808576,
          from: '0.0.10605209',
          index: '0.0.485516-1788980882-816059439:0',
          memo: 'SKUx',
          timestamp: '2026-09-09T19:08:13.827Z',
          to: null,
          token: '0.0.485527',
          tokenType: 'TOKEN',
          transactionGasFee: 1281463n,
          transactionHash:
            '84921f985f6f9ec90ac803bfe442513bf809e13157b52235efe28441087ac403e2bbdb627800456af40936948dd3bfa7',
        },
      ],
    },
  ],
};

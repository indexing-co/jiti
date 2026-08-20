import { decodeTxRaw } from '@cosmjs/proto-signing';
import { sha256 } from 'viem';

import { SubTemplate } from '../../types';
import { NetworkTransfer } from './types';
import type { CosmosBlock } from '../../types/beats/cosmos';

// THORChain is Tendermint, so the generic Cosmos sub-template matches it — but cannot read it.
// That template protobuf-decodes `/cosmos.bank.v1beta1.MsgSend` and `/ibc…MsgTransfer` through
// the stargate registry, and THORChain moves RUNE with its own `/types.MsgSend` and
// `/types.MsgDeposit`, which are not registered types. Every THORChain block came out empty.
//
// Read the bank module's `transfer` events instead. Native RUNE settles through the bank module,
// so every RUNE movement — plain sends and memo-carrying deposits alike — emits one. THORChain's
// other assets (synths, secured, trade) live in its own ledger and emit custom `outbound` /
// `trade_account_deposit` events rather than bank transfers; those are not token transfers in the
// jiti sense and are deliberately not reported here.

// Mainnet `reserve` module account. Every native tx pays a flat RUNE fee to it in the ante
// handler, before message execution — that is a fee, not a transfer, so it is reported as
// `transactionGasFee` instead. The ante handler runs first and emits no `msg_index`, which is
// what distinguishes its event from the message's own.
const RESERVE_MODULE = 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt';

type EventAttributes = Record<string, string | undefined>;

const attributesOf = (event: { attributes?: { key: string; value: string }[] }): EventAttributes =>
  Object.fromEntries((event.attributes || []).map((a) => [a.key, a.value]));

// Coin strings are `<integer><denom>` with no separator ("2000000rune").
const parseCoin = (amount?: string): { amount: bigint; denom: string } | null => {
  const match = /^(\d+)(.+)$/.exec(amount || '');
  if (!match) return null;
  return { amount: BigInt(match[1]), denom: match[2] };
};

// `/types.MsgDeposit` carries the memo that routes the deposit (swap target, affiliate, the
// identifier a depositor is recognised by), and it is the whole point of the message. cosmjs
// cannot decode the type, so read field 2 — a length-delimited string — off the raw message
// rather than vendoring THORChain's protobuf definitions for one field.
function readDepositMemo(value: Uint8Array): string | undefined {
  let offset = 0;

  const varint = () => {
    let result = 0;
    let shift = 0;
    while (offset < value.length) {
      const byte = value[offset++];
      result += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) break;
      shift += 7;
    }
    return result;
  };

  while (offset < value.length) {
    const key = varint();
    const field = key >>> 3;
    switch (key & 0x07) {
      case 0:
        varint();
        break;
      case 1:
        offset += 8;
        break;
      case 5:
        offset += 4;
        break;
      case 2: {
        const length = varint();
        const start = offset;
        offset += length;
        if (field === 2) return Buffer.from(value.slice(start, offset)).toString('utf8');
        break;
      }
      default:
        // Unknown wire type: the rest of the buffer can no longer be walked safely.
        return undefined;
    }
  }

  return undefined;
}

// A tx's memo is the deposit memo when it has one, else the standard tx-body memo. Decoding is
// best-effort: a memo we cannot read must not cost us the transfers themselves.
function txMemo(txRaw: string): string | undefined {
  try {
    const decoded = decodeTxRaw(new Uint8Array(Buffer.from(txRaw, 'base64')));
    for (const message of decoded.body.messages) {
      if (message.typeUrl !== '/types.MsgDeposit') continue;
      const memo = readDepositMemo(message.value);
      if (memo) return memo;
    }
    return decoded.body.memo || undefined;
  } catch (e) {
    return undefined;
  }
}

export const THORChainTokenTransfers: SubTemplate = {
  match: (block) => (block?._network as string)?.toUpperCase() === 'THORCHAIN',

  transform(block) {
    const transfers: NetworkTransfer[] = [];

    const typedBlock = block as unknown as CosmosBlock;

    const blockNumber = Number(typedBlock.block.header.height);
    const blockTimestamp = new Date(typedBlock.block.header.time).toISOString();

    const txs = typedBlock.block.data.txs || [];
    const results = typedBlock.txs_results || [];

    for (const [txIndex, txRaw] of txs.entries()) {
      const result = results[txIndex];
      // A non-zero code means the tx reverted: its message events describe movements that were
      // rolled back. `code` is absent rather than 0 on success in some Tendermint responses.
      if (!result || (result.code ?? 0) !== 0) continue;

      const transactionHash = sha256(new Uint8Array(Buffer.from(txRaw, 'base64')))
        .slice(2)
        .toUpperCase();
      const memo = txMemo(txRaw);

      let transactionGasFee = BigInt(0);
      const txTransfers: NetworkTransfer[] = [];

      for (const [eventIndex, event] of (result.events || []).entries()) {
        if (event.type !== 'transfer') continue;

        const attributes = attributesOf(event);
        const coin = parseCoin(attributes.amount);
        const from = attributes.sender;
        const to = attributes.recipient;
        if (!coin || !from || !to) continue;

        if (attributes.msg_index === undefined && to === RESERVE_MODULE) {
          transactionGasFee += coin.amount;
          continue;
        }

        txTransfers.push({
          amount: coin.amount,
          blockNumber,
          from,
          index: String(eventIndex),
          ...(memo ? { memo } : {}),
          timestamp: blockTimestamp,
          to,
          token: coin.denom,
          tokenType: 'NATIVE',
          // Filled in below: the fee event can follow the message events it belongs to.
          transactionGasFee: BigInt(0),
          transactionHash,
        });
      }

      for (const transfer of txTransfers) {
        transfer.transactionGasFee = transactionGasFee;
        transfers.push(transfer);
      }
    }

    return transfers;
  },

  tests: [
    // A native RUNE MsgDeposit (the transfer + the flat fee to the reserve), a MsgDeposit that
    // moved a secured asset (fee only — no bank transfer to report), and a tx that reverted.
    {
      params: { network: 'THORCHAIN' },
      payload: {
        block: {
          header: {
            height: '27507641',
            time: '2026-08-20T16:00:46.111090137Z',
          },
          data: {
            txs: [
              'CsIBCr8BChEvdHlwZXMuTXNnRGVwb3NpdBKpAQogChIKBFRIT1ISBFJVTkUaBFJVTkUSCjc5MTY5NzU0NjkSbz06RVRIfkxJTkstMFg1MTQ5MTA3NzFBRjlDQTY1NkFGODQwREZGODNFODI2NEVDRjk4NkNBOnRob3IxNG1oMzd1YTR2a3l1cjBsNXJhMjk3YTRsYTZ0bWY5NW10OTZhNTU6MzI4OTA4OTM4LzEvMRoUru8fc7VlicG/9B9UX3a/7pe0lpsSXApTCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAt1AmrO0mT8CuDoRDZ+w2XEn0QUm+NSeSTgTwqq4cMbHEgQKAggBGIDY/QMSBRCF7usXGkC9McpwtWFHxTy5YV62iwl8VkHkrEmqYczPYUWLjljERDhoZolRP/rkN3mTRuE9EtiKF9zwR3gHlH46SkKeIGjG',
              'Cr4BCrsBChEvdHlwZXMuTXNnRGVwb3NpdBKlAQpFCjcKBFRST04SJ1VTRFQtVFI3TkhRSkVLUVhHVENJOFE4Wlk0UEw4T1RTWkdKTEo2VBoEVVNEVCgBEgo4NTM4NDEwNDM5EkY9OkFWQVh+QVZBWDp0aG9yMTRtaDM3dWE0dmt5dXIwbDVyYTI5N2E0bGE2dG1mOTVtdDk2YTU1OjEyMTAzOTc0NjgvMS8xGhSu7x9ztWWJwb/0H1Rfdr/ul7SWmxJcClMKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEC3UCas7SZPwK4OhENn7DZcSfRBSb41J5JOBPCqrhwxscSBAoCCAEY/tf9AxIFEK3p6xcaQLNDI676kO1rjNMv0PaQxMDQBWyCZcT7FI2PP+CLNfdnBeqP5hF8+o5sQoU6gtTsWcyOPvoQqvYjo3+h8/xc+zI=',
              'CuQDCuEDCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSuAMKK3Rob3IxbGozcTdkZmc0endybXRrbXFnNHU0NHZ5NGw0NHVjNjhneDg5MmcSP3Rob3IxZWZybXdrNmZ6aGF1Z3UwNTZtejNua3E0dmwwZmdwZmFjbTNncDZmaGdyZGttNHE4cnJtc2Q1YTZyNRq0Ansic3dhcCI6eyJtaW5fcmV0dXJuIjp7ImFtb3VudCI6IjQzMDk4OCIsImRlbm9tIjoiZXRoLWV0aCJ9LCJzdGFnZXMiOlt7ImFkZHJlc3MiOiJ0aG9yMXRuZDA2dXN3ajgwMzNkMGt6ZDVkN3pyZTczdTN1YzQ0cjJ2dmV6MjZ6NW00a3I2OHZ0dXNmMnNudmEiLCJkZW5vbSI6ImV0aC11c2RjLTB4YTBiODY5OTFjNjIxOGIzNmMxZDE5ZDRhMmU5ZWIwY2UzNjA2ZWI0OCJ9LHsiYWRkcmVzcyI6InRob3IxdG5kMDZ1c3dqODAzM2Qwa3pkNWQ3enJlNzN1M3VjNDRyMnZ2ZXoyNno1bTRrcjY4dnR1c2Yyc252YSIsImRlbm9tIjoiZXRoLWV0aCJ9XX19KhEKB2V0aC1ldGgSBjQzMDk4OBJaClEKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiECB2a3cCcQRsrZjUO2mf3Lpmrc9ee4HtKbOJdG6RXzumUSBAoCCH8Y1nMSBRDDwc8yGkBL2rlu1ZdeV5BdbQSkuXAI4JQjyx6fqntPacJx1HXKM2m++4RI0rZTaznV0XUGZywDXOFpDtcOMRue2F/GNylA',
            ],
          },
        },
        txs_results: [
          {
            code: 0,
            data: 'EhEKDy90eXBlcy5Nc2dFbXB0eQ==',
            log: '',
            info: '',
            gas_wanted: '-1',
            gas_used: '353585',
            events: [
              {
                type: 'coin_spent',
                attributes: [
                  {
                    key: 'spender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_received',
                attributes: [
                  {
                    key: 'receiver',
                    value: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  {
                    key: 'recipient',
                    value: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'acc_seq',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55/8350720',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'signature',
                    value: 'vTHKcLVhR8U8uWFetosJfFZB5KxJqmHMz2FFi45YxEQ4aGaJUT/65Dd5k0bhPRLYihfc8Ed4B5R+OkpCniBoxg==',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'action',
                    value: '/types.MsgDeposit',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'module',
                    value: 'MsgDeposit',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_spent',
                attributes: [
                  {
                    key: 'spender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '7916975469rune',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_received',
                attributes: [
                  {
                    key: 'receiver',
                    value: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '7916975469rune',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  {
                    key: 'recipient',
                    value: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '7916975469rune',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
            ],
            codespace: '',
          },
          {
            code: 0,
            data: 'EhEKDy90eXBlcy5Nc2dFbXB0eQ==',
            log: '',
            info: '',
            gas_wanted: '-1',
            gas_used: '330934',
            events: [
              {
                type: 'coin_spent',
                attributes: [
                  {
                    key: 'spender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_received',
                attributes: [
                  {
                    key: 'receiver',
                    value: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  {
                    key: 'recipient',
                    value: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'acc_seq',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55/8350718',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'signature',
                    value: 's0MjrvqQ7WuM0y/Q9pDEwNAFbIJlxPsUjY8/4Is192cF6o/mEXz6jmxChTqC1OxZzI4++hCq9iOjf6Hz/Fz7Mg==',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'action',
                    value: '/types.MsgDeposit',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
                    index: true,
                  },
                  {
                    key: 'module',
                    value: 'MsgDeposit',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
            ],
            codespace: '',
          },
          {
            code: 4,
            data: null,
            log: 'failed to execute message; message index: 0: wasm halted: unauthorized',
            info: '',
            gas_wanted: '-1',
            gas_used: '46259',
            events: [
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'fee',
                    value: '',
                    index: true,
                  },
                  {
                    key: 'fee_payer',
                    value: 'thor1lj3q7dfg4zwrmtkmqg4u44vy4l44uc68gx892g',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'acc_seq',
                    value: 'thor1lj3q7dfg4zwrmtkmqg4u44vy4l44uc68gx892g/14806',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'signature',
                    value: 'S9q5btWXXleQXW0EpLlwCOCUI8sen6p7T2nCcdR1yjNpvvuESNK2U2s51dF1BmcsA1zhaQ7XDjEbnthfxjcpQA==',
                    index: true,
                  },
                ],
              },
            ],
            codespace: 'sdk',
          },
        ],
        _network: 'THORCHAIN',
        _vm: 'COSMOS',
      },
      output: [
        {
          amount: 7916975469n,
          blockNumber: 27507641,
          from: 'thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55',
          index: '9',
          memo: '=:ETH~LINK-0X514910771AF9CA656AF840DFF83E8264ECF986CA:thor14mh37ua4vkyur0l5ra297a4la6tmf95mt96a55:328908938/1/1',
          timestamp: '2026-08-20T16:00:46.111Z',
          to: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
          token: 'rune',
          tokenType: 'NATIVE',
          transactionGasFee: 2000000n,
          transactionHash: '8F732212ABE0891F7E561BBFDD430D87D41E0022D75318C6F6178F1F64CD2E5A',
        },
      ],
    },
    // A plain `/types.MsgSend` — the shape a manual RUNE deposit to a plain address takes.
    {
      params: { network: 'THORCHAIN' },
      payload: {
        block: {
          header: {
            height: '27507614',
            time: '2026-08-20T15:57:58.565886063Z',
          },
          data: {
            txs: [
              'ClMKUQoOL3R5cGVzLk1zZ1NlbmQSPwoUvoVXR1iAUCQ/dlDm+7paytrATzcSFL6FV0dYgFAkP3ZQ5vu6WsrawE83GhEKBHJ1bmUSCTEwMDAwMDAwMBJZClAKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDlGOz2TxrQyKsSaYZhNye+DcTFhrXaPH6Sx0ppytRMskSBAoCCAEYEhIFEIDaxAkaQKj/HOJ0QQo6DphGRS6OHQPBOKi8pWTdlIFF/ApHuMBpULyhmkN4MfvBgZvzIZGGfiFG7VY3RIJ/CYu7u6Lwlxs=',
            ],
          },
        },
        txs_results: [
          {
            code: 0,
            data: 'EhEKDy90eXBlcy5Nc2dFbXB0eQ==',
            log: '',
            info: '',
            gas_wanted: '-1',
            gas_used: '75193',
            events: [
              {
                type: 'coin_spent',
                attributes: [
                  {
                    key: 'spender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_received',
                attributes: [
                  {
                    key: 'receiver',
                    value: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  {
                    key: 'recipient',
                    value: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '2000000rune',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'sender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'acc_seq',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5/18',
                    index: true,
                  },
                ],
              },
              {
                type: 'tx',
                attributes: [
                  {
                    key: 'signature',
                    value: 'qP8c4nRBCjoOmEZFLo4dA8E4qLylZN2UgUX8Cke4wGlQvKGaQ3gx+8GBm/MhkYZ+IUbtVjdEgn8Ji7u7ovCXGw==',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'action',
                    value: '/types.MsgSend',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'module',
                    value: 'MsgSend',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_spent',
                attributes: [
                  {
                    key: 'spender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '100000000rune',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'coin_received',
                attributes: [
                  {
                    key: 'receiver',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '100000000rune',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'transfer',
                attributes: [
                  {
                    key: 'recipient',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'sender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'amount',
                    value: '100000000rune',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
              {
                type: 'message',
                attributes: [
                  {
                    key: 'sender',
                    value: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
                    index: true,
                  },
                  {
                    key: 'msg_index',
                    value: '0',
                    index: true,
                  },
                ],
              },
            ],
            codespace: '',
          },
        ],
        _network: 'THORCHAIN',
        _vm: 'COSMOS',
      },
      output: [
        {
          amount: 100000000n,
          blockNumber: 27507614,
          from: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
          index: '9',
          timestamp: '2026-08-20T15:57:58.565Z',
          to: 'thor1h6z4w36cspgzg0mk2rn0hwj6etdvqnehnza9h5',
          token: 'rune',
          tokenType: 'NATIVE',
          transactionGasFee: 2000000n,
          transactionHash: '756FADAB43FC2773C541C4D3323E5C409ED1F89280EBC7961BF55551B7ACA2B1',
        },
      ],
    },
  ],
};

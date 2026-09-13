// Real transactions, each checked against api.relay.link (2026-09-13): depositor/recipient, token, amount, order id.
// Logs trimmed to Relay events; calldata trimmed to the order id it ends with.
import { TemplateTest } from '../../types';

export const EVM_RELAY_TESTS: TemplateTest[] = [
  // BASE 51256529: deposit funding a planted Robinhood Chain buy (depositor 0xc66e… per api.relay.link)
  {
    params: {},
    payload: {
      _network: 'BASE',
      number: 51256529,
      hash: '0xa1f9f90a8b5c74c8d3aa45dfd83e74bce9747d39daa84b10481a7fc3e32de359',
      timestamp: 1789302405,
      miner: '0x4200000000000000000000000000000000000011',
      transactions: [
        {
          hash: '0x7116de74b53738ccd5cdb84bdf40d86392f0c783548255294549162ab9e13e59',
          from: '0xc66E270E81dEc54063a74958776C93b48C90c033',
          to: '0x4cd00e387622c35bddB9B4c962C136462338Bc31',
          input:
            '0xe8017952000000000000000000000000c66e270e81dec54063a74958776c93b48c90c033000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000000000000000000000000000000000001dd0495013811abf6ee1c93181fc66206440faee0395a9da8959ad1642f9f1b4f050d802',
          value: '0',
          blockNumber: 51256529,
          transactionIndex: 94,
          receipt: {
            status: true,
            transactionHash: '0x7116de74b53738ccd5cdb84bdf40d86392f0c783548255294549162ab9e13e59',
            logs: [
              {
                address: '0x833589fCd6Edb6e08F4c7c32d4F71b54bda02913',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x000000000000000000000000c66e270e81dec54063a74958776c93b48c90c033',
                  '0x0000000000000000000000004cd00e387622c35bddb9b4c962c136462338bc31',
                ],
                data: '0x000000000000000000000000000000000000000000000000000000001dd04950',
                logIndex: 282,
              },
              {
                address: '0x4cd00e387622c35bddB9B4c962C136462338Bc31',
                topics: ['0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1'],
                data: '0x000000000000000000000000c66e270e81dec54063a74958776c93b48c90c033000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000000000000000000000000000000000001dd0495013811abf6ee1c93181fc66206440faee0395a9da8959ad1642f9f1b4f050d802',
                logIndex: 283,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        network: 'BASE',
        blockNumber: 51256529,
        timestamp: '2026-09-13T12:26:45.000Z',
        transactionHash: '0x7116de74b53738ccd5cdb84bdf40d86392f0c783548255294549162ab9e13e59',
        type: 'DEPOSIT',
        orderId: '0x13811abf6ee1c93181fc66206440faee0395a9da8959ad1642f9f1b4f050d802',
        address: '0xc66e270e81dec54063a74958776c93b48c90c033',
        token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        amount: 500189520n,
      },
    ],
  },
  // ROBINHOOD: fomo sell proceeds deposited to Relay (RelayErc20Deposit, USDG)
  {
    params: {},
    payload: {
      _network: 'ROBINHOOD',
      number: 61972069,
      hash: '0x62ab4d1b50e1ef8aa23b529640b17fdebe4fde7e574b30ff04c173a29d5d6f73',
      timestamp: 1789304032,
      miner: '0xa4B000000000000000000073657175656e636572',
      transactions: [
        {
          hash: '0x22ea72750f1e5bcdabd12f865c3f50ed73ba0545131c4c8597a14df4f349f09d',
          from: '0x43370525d26C72E0a096E19CD4f45367B4b29369',
          to: '0x4337084d9E255Ff0702461cf8895CE9E3B5fF108',
          value: '0',
          input:
            '0x4d4fe13c1f48512ed2c5677ee732edcfda4fa8da882c7ac4c189e32a2bf121191b00000000000000000000000000000000000000000000000000000000000000',
          blockNumber: 61972069,
          transactionIndex: 1,
          receipt: {
            status: true,
            transactionHash: '0x22ea72750f1e5bcdabd12f865c3f50ed73ba0545131c4c8597a14df4f349f09d',
            logs: [
              {
                address: '0xccC88A9d1b4Ed6B0eaBA998850414b24F1c315bE',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000bdce13a1cadea23a61013fbfb470c7eef4ba9520000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f00000000000000000000000015d36b6a28d8327abc7afabf0f106ae2c9af5c4d0000000000000000000000000000000000000000000015aa7d5fa8a5fed1d00000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000212df0a46b75f6377f22720a6870c64f14ec17798dcf7d8fb5364a3692040398710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 3,
              },
              {
                address: '0x4cd00e387622c35bddB9B4c962C136462338Bc31',
                topics: ['0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1'],
                data: '0x000000000000000000000000bdce13a1cadea23a61013fbfb470c7eef4ba95200000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168000000000000000000000000000000000000000000000000000000003aa635897f175830a3f366f6d357a20ac1a4024ce3f35f8fcbb213c2c57c9097793ca4b3',
                logIndex: 23,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        network: 'ROBINHOOD',
        blockNumber: 61972069,
        timestamp: '2026-09-13T12:53:52.000Z',
        transactionHash: '0x22ea72750f1e5bcdabd12f865c3f50ed73ba0545131c4c8597a14df4f349f09d',
        type: 'DEPOSIT',
        orderId: '0x7f175830a3f366f6d357a20ac1a4024ce3f35f8fcbb213c2c57c9097793ca4b3',
        address: '0xbdce13a1cadea23a61013fbfb470c7eef4ba9520',
        token: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
        amount: 983971209n,
      },
    ],
  },
  // ROBINHOOD: cross-chain buy paid out to the wallet (FundsMovement out of the router; order id from calldata)
  {
    params: {},
    payload: {
      _network: 'ROBINHOOD',
      number: 61982254,
      hash: '0x50f5beb438c6b647d48993324b654955b2f8ff0740fce60a0a902fc2a4de49d0',
      timestamp: 1789305066,
      miner: '0xa4B000000000000000000073657175656e636572',
      transactions: [
        {
          hash: '0xdb0e24c7368b4b950ab397d9318e10bced36925f491968aecbd2e18c7baf5054',
          from: '0xe209e0047731AA494289e1AF9a0d03dA19c5eF08',
          to: '0xccC88A9d1b4Ed6B0eaBA998850414b24F1c315bE',
          value: '0',
          input:
            '0x1b0000000000000000000000000000000000000000000000000000000000000065e446b0d78b05c94b0e808a723cd8dae66b3e7d4c1fb891c5c7f6778a17a43f',
          blockNumber: 61982254,
          transactionIndex: 20,
          receipt: {
            status: true,
            transactionHash: '0xdb0e24c7368b4b950ab397d9318e10bced36925f491968aecbd2e18c7baf5054',
            logs: [
              {
                address: '0xccC88A9d1b4Ed6B0eaBA998850414b24F1c315bE',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d16800000000000000000000000000000000000000000000000000000000054c11ea00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000021c56be62afad893e6d0eab51c1decaa14b2d97f23fd3ea9fa8b6bf216050398710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 90,
              },
              {
                address: '0xb92fE925Dc43a0ecDE6C8b1a2709c170EC4fff4f',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f000000000000000000000000d770b3db81dd31afb3d294496d66509302f3665e0000000000000000000000007fe995a80075df3dc8ae11a9b82c7fe4202cd87f00000000000000000000000000000000000000000000020fff9487510038e76e00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000021c56be62afad893e6d0eab51c1decaa14b2d97f23fd3ea9fa8b6bf216050398710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 103,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        network: 'ROBINHOOD',
        blockNumber: 61982254,
        timestamp: '2026-09-13T13:11:06.000Z',
        transactionHash: '0xdb0e24c7368b4b950ab397d9318e10bced36925f491968aecbd2e18c7baf5054',
        type: 'PAYOUT',
        orderId: '0x65e446b0d78b05c94b0e808a723cd8dae66b3e7d4c1fb891c5c7f6778a17a43f',
        address: '0xd770b3db81dd31afb3d294496d66509302f3665e',
        token: '0x7fe995a80075df3dc8ae11a9b82c7fe4202cd87f',
        amount: 9739850620403124332398n,
      },
    ],
  },
];

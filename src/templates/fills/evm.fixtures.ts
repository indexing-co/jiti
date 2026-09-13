// Real Robinhood Chain (4663) fomo.family trades, each cross-checked against rhtrenches.com's tape and Relay's records
// (2026-09-13). One transaction per case, trimmed to what a fill depends on: the wallet's Transfer logs, the ERC-4337
// and Relay events, and the calldata's last 32 bytes (the Relay order id).
// Payloads are normalized with utils.normalizeEVMBlock, the shape oscar caches and jiti templates receive.
import { TemplateTest } from '../../types';

export const EVM_FILL_TESTS: TemplateTest[] = [
  // Robinhood Chain 61982254: Relay cross-chain BUY: solver funds the route in USDG, router delivers to the wallet (RELAY_FILL + orderId from calldata)
  {
    params: {
      walletAddress: ['0xd770b3db81dd31afb3d294496d66509302f3665e'],
    },
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
          gasPrice: '81610000',
          receipt: {
            status: true,
            gasUsed: 518541,
            effectiveGasPrice: 81610000,
            transactionHash: '0xdb0e24c7368b4b950ab397d9318e10bced36925f491968aecbd2e18c7baf5054',
            logs: [
              {
                address: '0xccC88A9d1b4Ed6B0eaBA998850414b24F1c315bE',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d16800000000000000000000000000000000000000000000000000000000054c11ea00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000021c56be62afad893e6d0eab51c1decaa14b2d97f23fd3ea9fa8b6bf216050398710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 90,
              },
              {
                address: '0x7fE995a80075dF3DC8ae11a9B82c7fE4202cD87f',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f',
                  '0x000000000000000000000000d770b3db81dd31afb3d294496d66509302f3665e',
                ],
                data: '0x00000000000000000000000000000000000000000000020fff9487510038e76e',
                logIndex: 102,
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
        blockNumber: 61982254,
        timestamp: '2026-09-13T13:11:06.000Z',
        transactionHash: '0xdb0e24c7368b4b950ab397d9318e10bced36925f491968aecbd2e18c7baf5054',
        wallet: '0xd770b3db81dd31afb3d294496d66509302f3665e',
        side: 'BUY',
        token: '0x7fe995a80075df3dc8ae11a9b82c7fe4202cd87f',
        amount: 9739850620403124332398n,
        signedByWallet: false,
        relayOrderId: '0x65e446b0d78b05c94b0e808a723cd8dae66b3e7d4c1fb891c5c7f6778a17a43f',
        cashLeg: {
          token: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
          amount: 88871402n,
          source: 'RELAY_FILL',
        },
      },
    ],
  },
  // Robinhood Chain 61972069: Relay cross-chain SELL: wallet-signed UserOperation, proceeds deposited to Relay as USDG (RELAY_DEPOSIT)
  {
    params: {
      walletAddress: ['0xbdce13a1cadea23a61013fbfb470c7eef4ba9520'],
    },
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
          gasPrice: '122439000',
          receipt: {
            status: true,
            gasUsed: 747974,
            effectiveGasPrice: 82356000,
            transactionHash: '0x22ea72750f1e5bcdabd12f865c3f50ed73ba0545131c4c8597a14df4f349f09d',
            logs: [
              {
                address: '0x15d36b6A28d8327abC7afaBF0F106ae2C9aF5c4D',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x000000000000000000000000bdce13a1cadea23a61013fbfb470c7eef4ba9520',
                  '0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f',
                ],
                data: '0x0000000000000000000000000000000000000000000015aa7d5fa8a5fed1d000',
                logIndex: 2,
              },
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
              {
                address: '0x4337084d9E255Ff0702461cf8895CE9E3B5fF108',
                topics: [
                  '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f',
                  '0xa041f5bc09ba90cbeb39627bd96e73fad766f455bead4ec83ed44cfa0a201dbd',
                  '0x000000000000000000000000bdce13a1cadea23a61013fbfb470c7eef4ba9520',
                  '0x0000000000000000000000000000000000000000000000000000000000000000',
                ],
                data: '0x00000000000000000000000000000000000001a09ad4c9b600000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e9fc9',
                logIndex: 25,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        blockNumber: 61972069,
        timestamp: '2026-09-13T12:53:52.000Z',
        transactionHash: '0x22ea72750f1e5bcdabd12f865c3f50ed73ba0545131c4c8597a14df4f349f09d',
        wallet: '0xbdce13a1cadea23a61013fbfb470c7eef4ba9520',
        side: 'SELL',
        token: '0x15d36b6a28d8327abc7afabf0f106ae2c9af5c4d',
        amount: 102314676757601600000000n,
        signedByWallet: true,
        relayOrderId: '0x7f175830a3f366f6d357a20ac1a4024ce3f35f8fcbb213c2c57c9097793ca4b3',
        cashLeg: {
          token: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
          amount: 983971209n,
          source: 'RELAY_DEPOSIT',
        },
      },
    ],
  },
  // Robinhood Chain 62078987: Relay SELL routed through WETH: cash leg is the USDG deposit, not the intermediate WETH hop
  {
    params: {
      walletAddress: ['0x696d1265c8fc4f14797abebfae3c43ebfa9d8e28'],
    },
    payload: {
      _network: 'ROBINHOOD',
      number: 62078987,
      hash: '0x0bba45f2465cf6c658c02a1984e19fb7116c6a2e5be074dd145c669e57047842',
      timestamp: 1789314909,
      miner: '0xa4B000000000000000000073657175656e636572',
      transactions: [
        {
          hash: '0x99aa194688d683ab319d3599d519f1fdcd30041be48f18798ed470f0588122c1',
          from: '0x43375ce21E2c538a13BD3B46dD5c6001cA7c9B7c',
          to: '0x4337084d9E255Ff0702461cf8895CE9E3B5fF108',
          value: '0',
          input:
            '0x5b770e4543fecd2bef281dec32a6beeacfcca13ce634b05f77a79e7c4be1abd51b00000000000000000000000000000000000000000000000000000000000000',
          blockNumber: 62078987,
          transactionIndex: 11,
          gasPrice: '125559000',
          receipt: {
            status: true,
            gasUsed: 991517,
            effectiveGasPrice: 84374000,
            transactionHash: '0x99aa194688d683ab319d3599d519f1fdcd30041be48f18798ed470f0588122c1',
            logs: [
              {
                address: '0x4b455ee2689b7EE65cFF13011a33d406C27dcAA3',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x000000000000000000000000696d1265c8fc4f14797abebfae3c43ebfa9d8e28',
                  '0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f',
                ],
                data: '0x00000000000000000000000000000000000000000004b14a26623de7cae36d42',
                logIndex: 44,
              },
              {
                address: '0xccC88A9d1b4Ed6B0eaBA998850414b24F1c315bE',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000696d1265c8fc4f14797abebfae3c43ebfa9d8e28000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f0000000000000000000000004b455ee2689b7ee65cff13011a33d406c27dcaa300000000000000000000000000000000000000000004b14a26623de7cae36d4200000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000021d4fe2de0b49f3e36cdef104d5ba09bfbedd028f558c3a29070692d70941398710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 45,
              },
              {
                address: '0x4cd00e387622c35bddB9B4c962C136462338Bc31',
                topics: ['0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1'],
                data: '0x000000000000000000000000696d1265c8fc4f14797abebfae3c43ebfa9d8e280000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168000000000000000000000000000000000000000000000000000000016f63d8d0e445f75b078aca68c2dd07cfff7b453a65e8ce269949f66d046b3db323fdee78',
                logIndex: 69,
              },
              {
                address: '0x4337084d9E255Ff0702461cf8895CE9E3B5fF108',
                topics: [
                  '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f',
                  '0x767d8e942be3becdf036c4159ff665b24fb90ca6c8bba59343d0297ac11ccddf',
                  '0x000000000000000000000000696d1265c8fc4f14797abebfae3c43ebfa9d8e28',
                  '0x0000000000000000000000000000000000000000000000000000000000000000',
                ],
                data: '0x00000000000000000000000000000000000001a09b7ac2f000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001369cf',
                logIndex: 71,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        blockNumber: 62078987,
        timestamp: '2026-09-13T15:55:09.000Z',
        transactionHash: '0x99aa194688d683ab319d3599d519f1fdcd30041be48f18798ed470f0588122c1',
        wallet: '0x696d1265c8fc4f14797abebfae3c43ebfa9d8e28',
        side: 'SELL',
        token: '0x4b455ee2689b7ee65cff13011a33d406c27dcaa3',
        amount: 5672929970829085318016322n,
        signedByWallet: true,
        relayOrderId: '0xe445f75b078aca68c2dd07cfff7b453a65e8ce269949f66d046b3db323fdee78',
        cashLeg: {
          token: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
          amount: 6163781840n,
          source: 'RELAY_DEPOSIT',
        },
      },
    ],
  },
  // Robinhood Chain 61895371: Relay BUY funded in native ETH (a plant: identical on-chain to a real buy; only the origin payer differs)
  {
    params: {
      walletAddress: ['0x39b337121494b10cffe3e581ab3281b2d62c5b08'],
    },
    payload: {
      _network: 'ROBINHOOD',
      number: 61895371,
      hash: '0xae16621180c24c9ff4106bbe359a04491378132b47dc74e0555631e9306eeb95',
      timestamp: 1789296254,
      miner: '0xa4B000000000000000000073657175656e636572',
      transactions: [
        {
          hash: '0x1be4d4f8a9ef08f08f193307f1f041f5423e84d5b3398bc6a7e0e556e504a2f4',
          from: '0xada5Bb90d0de0bD1B6f3938708F49295a8D1F7CB',
          to: '0xb92fE925Dc43a0ecDE6C8b1a2709c170EC4fff4f',
          value: '4916036819317383',
          input:
            '0x000000000000000000000000000000000000000000000000000000000000000004b3aa3e914a03892282584036c3ed26c3ff0844b5fb7f5b02df925a13d896d7',
          blockNumber: 61895371,
          transactionIndex: 10,
          gasPrice: '83884000',
          receipt: {
            status: true,
            gasUsed: 378672,
            effectiveGasPrice: 83884000,
            transactionHash: '0x1be4d4f8a9ef08f08f193307f1f041f5423e84d5b3398bc6a7e0e556e504a2f4',
            logs: [
              {
                address: '0xb92fE925Dc43a0ecDE6C8b1a2709c170EC4fff4f',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000ada5bb90d0de0bd1b6f3938708f49295a8d1f7cb000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011771c0451728700000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000021f4bdb6aeb62478ce47fd6dcc49d7a599023754c39d94deb6ae208b74269298710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 80,
              },
              {
                address: '0xe1abE3EB67Bc5028E70B2b692521D523c008d30d',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f',
                  '0x00000000000000000000000039b337121494b10cffe3e581ab3281b2d62c5b08',
                ],
                data: '0x00000000000000000000000000000000000000000000aa9e34656c53c6d97b1b',
                logIndex: 92,
              },
              {
                address: '0xb92fE925Dc43a0ecDE6C8b1a2709c170EC4fff4f',
                topics: ['0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91'],
                data: '0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f00000000000000000000000039b337121494b10cffe3e581ab3281b2d62c5b08000000000000000000000000e1abe3eb67bc5028e70b2b692521d523c008d30d00000000000000000000000000000000000000000000aa9e34656c53c6d97b1b00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000021f4bdb6aeb62478ce47fd6dcc49d7a599023754c39d94deb6ae208b74269298710000000000000000000000000000000000000000000000000000000000000000',
                logIndex: 93,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        blockNumber: 61895371,
        timestamp: '2026-09-13T10:44:14.000Z',
        transactionHash: '0x1be4d4f8a9ef08f08f193307f1f041f5423e84d5b3398bc6a7e0e556e504a2f4',
        wallet: '0x39b337121494b10cffe3e581ab3281b2d62c5b08',
        side: 'BUY',
        token: '0xe1abe3eb67bc5028e70b2b692521d523c008d30d',
        amount: 805720663194455489739547n,
        signedByWallet: false,
        relayOrderId: '0x04b3aa3e914a03892282584036c3ed26c3ff0844b5fb7f5b02df925a13d896d7',
        cashLeg: {
          token: 'native',
          amount: 4916036819317383n,
          source: 'RELAY_FILL',
        },
      },
    ],
  },
  // Robinhood Chain 61961371: Airdrop: token arrives unsigned with no cash leg
  {
    params: {
      walletAddress: ['0x97d6fab2459f11ffef5986e098a674a6a5f10e66'],
    },
    payload: {
      _network: 'ROBINHOOD',
      number: 61961371,
      hash: '0xe57b1d6edb6f96dc96be2293d2fb4597d113396ddcd7e628e9ec1ac5d0a2c75d',
      timestamp: 1789302948,
      miner: '0xa4B000000000000000000073657175656e636572',
      transactions: [
        {
          hash: '0xd5340ce579f029232241f8d641d14bca60e2a6bbb723f43791e7e442667cefd9',
          from: '0x845d0D9865ABf1F822033b03332615806e20D775',
          to: '0xaf72F6237674830778082a4566167B4Ba4F1E04B',
          value: '0',
          input:
            '0x00000000000000000000000032b1595b9659bb4480af1cfce9430dc07daaf442000000000000000000000000369a64b7dd20e530a11e5bd48201b081664e45b1',
          blockNumber: 61961371,
          transactionIndex: 8,
          gasPrice: '500000000',
          receipt: {
            status: true,
            gasUsed: 283987,
            effectiveGasPrice: 81744000,
            transactionHash: '0xd5340ce579f029232241f8d641d14bca60e2a6bbb723f43791e7e442667cefd9',
            logs: [
              {
                address: '0xaf72F6237674830778082a4566167B4Ba4F1E04B',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x0000000000000000000000008f8612b326d82703127264da8d32237fb14c6956',
                  '0x00000000000000000000000097d6fab2459f11ffef5986e098a674a6a5f10e66',
                ],
                data: '0x000000000000000000000000000000000000000000000000002374737ea2fbac',
                logIndex: 120,
              },
            ],
          },
          type: null,
        },
      ],
    },
    output: [
      {
        blockNumber: 61961371,
        timestamp: '2026-09-13T12:35:48.000Z',
        transactionHash: '0xd5340ce579f029232241f8d641d14bca60e2a6bbb723f43791e7e442667cefd9',
        wallet: '0x97d6fab2459f11ffef5986e098a674a6a5f10e66',
        side: 'BUY',
        token: '0xaf72f6237674830778082a4566167b4ba4f1e04b',
        amount: 9979663579544492n,
        signedByWallet: false,
      },
    ],
  },
];

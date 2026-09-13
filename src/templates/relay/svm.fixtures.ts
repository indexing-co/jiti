// Real Solana transactions (getTransaction wrapped as a one-transaction block), checked against api.relay.link
// (2026-09-13). Log messages trimmed to invokes, program data and memos.
import { TemplateTest } from '../../types';

export const SVM_RELAY_TESTS: TemplateTest[] = [
  // SOLANA slot 446747036: USDC deposit by BMgs… funding a Robinhood Chain buy (depository Anchor event)
  {
    params: {},
    payload: {
      _network: 'SOLANA',
      blockTime: 1789316439,
      parentSlot: 446747035,
      transactions: [
        {
          transaction: {
            message: {
              accountKeys: [
                'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51',
                'BMgsHTvcasRVtuevHJh8t6Vf5dmcWkDLAx6gSAQ3dsYm',
                'CcpHixxuM4uJrLki9xP3eg8NCHBE11QaJDyEK1xeHd85',
                '4nvJ5zWdVspxJiNZzB127U6amPH98SFFkBx2JZrAduia',
                'ComputeBudget111111111111111111111111111111',
                '99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2',
                'Dodg2HifwU8rmaVVyMyUZDGTRbqAJTyVYxXPwcbNpBKc',
                '7uTT8Xi5RWXzy7h9XL244GRgEycDYDhLjr3ZyNdXi8pZ',
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                '11111111111111111111111111111111',
              ],
              addressTableLookups: [],
              header: {
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 8,
                numRequiredSignatures: 2,
              },
              instructions: [
                {
                  accounts: [],
                  data: 'FZKxSB',
                  programIdIndex: 4,
                  stackHeight: 1,
                },
                {
                  accounts: [],
                  data: '3QCwqmHZ4mdq',
                  programIdIndex: 4,
                  stackHeight: 1,
                },
                {
                  accounts: [6, 1, 1, 7, 8, 2, 3, 9, 10, 11],
                  data: 'Rhn86pnvWw6kDL7cQcc9YDPEYwzfcL3jDRKXXs2xuoH38MLUcFxq2mBN5FsVM7gMe',
                  programIdIndex: 5,
                  stackHeight: 1,
                },
              ],
              recentBlockhash: '6doruZoarWAdZmKLkZRvpkhhfi8kF3Rvf4hJhreLu1nz',
            },
            signatures: [
              '5afsWzrMyc7Yi3eAkqNGSypjnFd3GG7VagNcXAm7SkafmWfzm69NGMcdfu9obmp8jV1WX7w9RjN9RKLUfqL8eLFT',
              '5MnKtwtAKjp5G8wGHNbX2mSEmVgY7K4tyU2uPXimzW7QXGiJdYdbfJjd7a4K35mhEgA7Wzs9GH3ZiVMwrBx8nWU',
            ],
          },
          meta: {
            computeUnitsConsumed: 26874,
            costUnits: 29681,
            err: null,
            fee: 43593,
            innerInstructions: [
              {
                index: 2,
                instructions: [
                  {
                    accounts: [2, 8, 3, 1],
                    data: 'g7bkbKc7iQSNR',
                    programIdIndex: 9,
                    stackHeight: 2,
                  },
                ],
              },
            ],
            loadedAddresses: {
              readonly: [],
              writable: [],
            },
            logMessages: [
              'Program ComputeBudget111111111111111111111111111111 invoke [1]',
              'Program ComputeBudget111111111111111111111111111111 invoke [1]',
              'Program 99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2 invoke [1]',
              'Program log: Instruction: DepositToken',
              'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
              'Program data: ePg9Ux+Oa5CZ4ZArhImn2zzS3+T8/YP5mfFm0ddcRy4C1Ugc0OhtGgHG+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYQDh9QUAAAAA+4Z9TnDYzxZ2/YBm/64du++GIpQ+LKsrXNtKJe4wrlk=',
            ],
            postBalances: [
              2132656544549, 1828681062, 2130291, 2039280, 1, 144071564, 1628641, 171001451051, 534212274982, 200653906,
              3388612899, 1,
            ],
            postTokenBalances: [
              {
                accountIndex: 2,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'BMgsHTvcasRVtuevHJh8t6Vf5dmcWkDLAx6gSAQ3dsYm',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '2169408314',
                  decimals: 6,
                  uiAmount: 2169.408314,
                  uiAmountString: '2169.408314',
                },
              },
              {
                accountIndex: 3,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: '7uTT8Xi5RWXzy7h9XL244GRgEycDYDhLjr3ZyNdXi8pZ',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '425762533802',
                  decimals: 6,
                  uiAmount: 425762.533802,
                  uiAmountString: '425762.533802',
                },
              },
            ],
            preBalances: [
              2132656588142, 1828681062, 2130291, 2039280, 1, 144071564, 1628641, 171001451051, 534212274982, 200653906,
              3388612899, 1,
            ],
            preTokenBalances: [
              {
                accountIndex: 2,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'BMgsHTvcasRVtuevHJh8t6Vf5dmcWkDLAx6gSAQ3dsYm',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '2269408314',
                  decimals: 6,
                  uiAmount: 2269.408314,
                  uiAmountString: '2269.408314',
                },
              },
              {
                accountIndex: 3,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: '7uTT8Xi5RWXzy7h9XL244GRgEycDYDhLjr3ZyNdXi8pZ',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '425662533802',
                  decimals: 6,
                  uiAmount: 425662.533802,
                  uiAmountString: '425662.533802',
                },
              },
            ],
            status: {
              Ok: null,
            },
          },
          version: 0,
        },
      ],
    },
    output: [
      {
        network: 'SOLANA',
        blockNumber: 446747036,
        timestamp: '2026-09-13T16:20:39.000Z',
        transactionHash: '5afsWzrMyc7Yi3eAkqNGSypjnFd3GG7VagNcXAm7SkafmWfzm69NGMcdfu9obmp8jV1WX7w9RjN9RKLUfqL8eLFT',
        type: 'DEPOSIT',
        orderId: '0xfb867d4e70d8cf1676fd8066ffae1dbbef8622943e2cab2b5cdb4a25ee30ae59',
        address: 'BMgsHTvcasRVtuevHJh8t6Vf5dmcWkDLAx6gSAQ3dsYm',
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 100000000n,
      },
    ],
  },
  // SOLANA slot 446707775: payout of a Robinhood Chain sell to FXr1… (order-id memo and request-id memo)
  {
    params: {},
    payload: {
      _network: 'SOLANA',
      blockTime: 1789304032,
      parentSlot: 446707774,
      transactions: [
        {
          transaction: {
            message: {
              accountKeys: [
                'F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe',
                'Q4UmPB9hKMw3ERqksavS9oEpNo2eWG4ffkWg7wHa9j6',
                '5wjtUUM3qMRk4bxsKV9qJGWPGqgSq8guAV7DP697LdR5',
                'ComputeBudget111111111111111111111111111111',
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
              ],
              addressTableLookups: [],
              header: {
                numReadonlySignedAccounts: 0,
                numReadonlyUnsignedAccounts: 3,
                numRequiredSignatures: 1,
              },
              instructions: [
                {
                  accounts: [],
                  data: 'Hb6w7d',
                  programIdIndex: 3,
                  stackHeight: 1,
                },
                {
                  accounts: [],
                  data: '3QCwqmHZ4mdq',
                  programIdIndex: 3,
                  stackHeight: 1,
                },
                {
                  accounts: [1, 2, 0],
                  data: '3v7PxoDSAnKZ',
                  programIdIndex: 4,
                  stackHeight: 1,
                },
                {
                  accounts: [],
                  data: 'KsyUg9aFy1iymBnhLDPFcSTnhT13NLzre3YKFa8F4pPR1HaG3oUiLkc1PwFS2Z2SqacZmX67cab8Z6sL35ZURXDqTG',
                  programIdIndex: 5,
                  stackHeight: 1,
                },
                {
                  accounts: [],
                  data: 'KsyMWGKonRLabSx4WjKd8UP8usnY33rmZKPTQcCCK1iU5AcDVZq3svZRx4trCGS6WbEDDfdkfDPZA4zCjNg92xgFGm',
                  programIdIndex: 5,
                  stackHeight: 1,
                },
              ],
              recentBlockhash: 'FDBZV9vvCtFbDrL65cawyMq3cPSbWUXqERu5jyTLy5F6',
            },
            signatures: ['5k2HnumJCkwTj7anehTwTPSq9q5JMxkNJPGH4uFFtXQyc376zyVjVrMNyn2DjiJPiXY1AGEhHzVkWAdekeSHFN3M'],
          },
          meta: {
            computeUnitsConsumed: 50230,
            costUnits: 51936,
            err: null,
            fee: 67600,
            innerInstructions: [],
            loadedAddresses: {
              readonly: [],
              writable: [],
            },
            logMessages: [
              'Program ComputeBudget111111111111111111111111111111 invoke [1]',
              'Program ComputeBudget111111111111111111111111111111 invoke [1]',
              'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
              'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]',
              'Program log: Memo (len 66): "0x7f175830a3f366f6d357a20ac1a4024ce3f35f8fcbb213c2c57c9097793ca4b3"',
              'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr consumed 24927 of 62224 compute units',
              'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr success',
              'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]',
              'Program log: Memo (len 66): "0x178930402963a4635bf8d7fcd89771ce41f46c0786a02722f7736f57b64a0fd2"',
              'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr consumed 24927 of 37297 compute units',
              'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr success',
            ],
            postBalances: [5427918314510, 2039300, 2039280, 1, 200653906, 523015135],
            postTokenBalances: [
              {
                accountIndex: 1,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '4431162898515',
                  decimals: 6,
                  uiAmount: 4431162.898515,
                  uiAmountString: '4431162.898515',
                },
              },
              {
                accountIndex: 2,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'FXr1GVAQtLoQHP25HZztqEfw1PBcDbvP6uJgEo7cdwEf',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '5549736065',
                  decimals: 6,
                  uiAmount: 5549.736065,
                  uiAmountString: '5549.736065',
                },
              },
            ],
            preBalances: [5427918382110, 2039300, 2039280, 1, 200653906, 523015135],
            preTokenBalances: [
              {
                accountIndex: 1,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '4432141550662',
                  decimals: 6,
                  uiAmount: 4432141.550662,
                  uiAmountString: '4432141.550662',
                },
              },
              {
                accountIndex: 2,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'FXr1GVAQtLoQHP25HZztqEfw1PBcDbvP6uJgEo7cdwEf',
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                uiTokenAmount: {
                  amount: '4571083918',
                  decimals: 6,
                  uiAmount: 4571.083918,
                  uiAmountString: '4571.083918',
                },
              },
            ],
            status: {
              Ok: null,
            },
          },
          version: 0,
        },
      ],
    },
    output: [
      {
        network: 'SOLANA',
        blockNumber: 446707775,
        timestamp: '2026-09-13T12:53:52.000Z',
        transactionHash: '5k2HnumJCkwTj7anehTwTPSq9q5JMxkNJPGH4uFFtXQyc376zyVjVrMNyn2DjiJPiXY1AGEhHzVkWAdekeSHFN3M',
        type: 'PAYOUT',
        orderId: '0x7f175830a3f366f6d357a20ac1a4024ce3f35f8fcbb213c2c57c9097793ca4b3',
        address: 'FXr1GVAQtLoQHP25HZztqEfw1PBcDbvP6uJgEo7cdwEf',
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 978652147n,
      },
      {
        network: 'SOLANA',
        blockNumber: 446707775,
        timestamp: '2026-09-13T12:53:52.000Z',
        transactionHash: '5k2HnumJCkwTj7anehTwTPSq9q5JMxkNJPGH4uFFtXQyc376zyVjVrMNyn2DjiJPiXY1AGEhHzVkWAdekeSHFN3M',
        type: 'PAYOUT',
        orderId: '0x178930402963a4635bf8d7fcd89771ce41f46c0786a02722f7736f57b64a0fd2',
        address: 'FXr1GVAQtLoQHP25HZztqEfw1PBcDbvP6uJgEo7cdwEf',
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 978652147n,
      },
    ],
  },
];

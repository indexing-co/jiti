import bs58 from 'bs58';

import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const SVMTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'SVM',

  transform(block) {
    let transfers: NetworkTransfer[] = [];

    for (const tx of (block.transactions as unknown[]) || []) {
      const txTransfers: ((typeof transfers)[0] & { fromTokenAccount?: string; toTokenAccount?: string })[] = [];

      const svmTx = tx as {
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
          innerInstructions: {
            index: number;
            instructions: Record<string, unknown>[];
          }[];
          status?: { Err?: unknown };
        };
        transaction: {
          message: { accountKeys: (string | { pubkey: string })[]; instructions: Record<string, unknown>[] };
          signatures: string[];
        };
      };
      const txHash = svmTx.transaction.signatures[0];
      const timestamp = block.blockTime ? new Date((block.blockTime as number) * 1000).toISOString() : null;
      const allAccounts = svmTx.transaction.message.accountKeys
        .concat(svmTx.meta.loadedAddresses.writable)
        .concat(svmTx.meta.loadedAddresses.readonly)
        .map((a) => (typeof a === 'string' ? a : (a as { pubkey: string })?.pubkey));

      let txFee = BigInt(svmTx.meta.fee);
      if (txFee < BigInt(10)) {
        txFee = txFee * BigInt(Math.pow(10, 9));
      }

      const signerIdx = svmTx.transaction.signatures.length - 1;
      const signer = allAccounts[signerIdx];
      const feePayer = allAccounts[0];

      // handle tx fee
      txTransfers.push({
        amount: txFee,
        blockNumber: (block.parentSlot as number) + 1,
        from: feePayer,
        index: '0',
        timestamp,
        to: null,
        transactionGasFee: txFee,
        transactionHash: txHash,
        token: null,
        tokenType: 'NATIVE',
      });

      const allUntypedInstructions: Record<string, unknown>[] = [];
      for (let idx = 0; idx < svmTx.transaction.message.instructions.length; idx += 1) {
        allUntypedInstructions.push({ ...svmTx.transaction.message.instructions[idx], index: idx });
        allUntypedInstructions.push(
          ...svmTx.meta.innerInstructions
            .filter((ii) => ii.index === idx)
            .map((ii) => ii.instructions.map((i, subIdx) => ({ ...i, rootIndex: ii.index, index: subIdx })))
            .flat()
        );
      }
      const allInstructions = allUntypedInstructions as {
        accounts: number[];
        data: string;
        programIdIndex: number;
        index: number;
        rootIndex?: number;
      }[];

      const createdAccountsToOwner: Record<string, string> = {};
      const previousAccountsClose: Record<string, bigint> = {};

      for (let idx = 0; idx < allInstructions.length; idx += 1) {
        if (svmTx.meta.status?.Err) continue;
        const inst = allInstructions[idx];
        const index = `${inst.rootIndex ? `${inst.rootIndex + 1}-` : ''}${inst.index + 1}`;

        try {
          const programId = allAccounts[inst.programIdIndex];
          const instData = bs58.decode(inst.data);
          const instSig = Array.from(instData).join(',');
          const matchingAccounts = inst.accounts.map((a) => allAccounts[a]);

          // SPL Transfers
          if ([SPL_TOKEN_PROGRAM, SPL_TOKEN_2022_PROGRAM].includes(programId)) {
            // TRANSFER, TRANSFER CHECKED
            if (
              (instSig.startsWith('3,') && inst.accounts.length === 3) ||
              (instSig.startsWith('12,') && inst.accounts.length >= 4)
            ) {
              const amountData = Buffer.from(instData).slice(1, 9);
              if (amountData.length < 8) continue;
              const amount = BigInt(amountData.readBigUInt64LE(0).toString());

              const fromIdx = inst.accounts[0];
              const toIdx = inst.accounts.length === 5 ? inst.accounts[4] : inst.accounts[inst.accounts.length - 2];

              let from = createdAccountsToOwner[allAccounts[fromIdx]];
              let to = createdAccountsToOwner[allAccounts[toIdx]];
              let mint: string;
              for (const ptb of svmTx.meta.preTokenBalances.concat(svmTx.meta.postTokenBalances)) {
                if (ptb.accountIndex === fromIdx) {
                  from = ptb.owner;
                  if (!mint) mint = ptb.mint;
                }
                if (ptb.accountIndex === toIdx) {
                  to = ptb.owner;
                  if (!mint) mint = ptb.mint;
                }
                if (from && to && mint) break;
              }

              if (!from) from = allAccounts[fromIdx] || signer;
              if (!to) to = allAccounts[toIdx] || signer;

              txTransfers.push({
                amount,
                blockNumber: (block.parentSlot as number) + 1,
                from,
                fromTokenAccount: allAccounts[fromIdx],
                index,
                timestamp,
                to,
                toTokenAccount: allAccounts[toIdx],
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: mint,
                tokenType: 'TOKEN',
              });
            }

            // CloseAccount
            else if (instSig === '9') {
              let solAmount = BigInt(svmTx.meta.preBalances[inst.accounts[0]] || 0);
              let from = matchingAccounts[0];
              let wSolAmount = (previousAccountsClose[from] || BigInt(0)) * BigInt(-1);
              const to = matchingAccounts[2];

              for (const t of txTransfers) {
                if ((t.to === from && !t.token) || (t.toTokenAccount === from && t.token === WSOL_MINT)) {
                  solAmount += t.amount as bigint;
                  if (t.token === WSOL_MINT) {
                    wSolAmount -= t.amount as bigint;
                  }
                } else if ((t.from === from && !t.token) || (t.fromTokenAccount === from && t.token === WSOL_MINT)) {
                  solAmount -= t.amount as bigint;
                  if (t.token === WSOL_MINT) {
                    wSolAmount += t.amount as bigint;
                  }
                }
              }

              txTransfers.push({
                amount: solAmount,
                blockNumber: (block.parentSlot as number) + 1,
                from,
                index,
                timestamp,
                to,
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: null,
                tokenType: 'NATIVE',
              });

              // handle wrap/unwrap of wSOL
              if (!previousAccountsClose[from]) {
                previousAccountsClose[from] = BigInt(0);
              }
              if (wSolAmount > BigInt(0)) {
                txTransfers.push({
                  amount: wSolAmount,
                  blockNumber: (block.parentSlot as number) + 1,
                  from,
                  index: `${index}-1`,
                  timestamp,
                  to: WSOL_MINT,
                  transactionGasFee: txFee,
                  transactionHash: txHash,
                  token: null,
                  tokenType: 'NATIVE',
                });
                txTransfers.push({
                  amount: wSolAmount,
                  blockNumber: (block.parentSlot as number) + 1,
                  from: WSOL_MINT,
                  index: `${index}-2`,
                  timestamp,
                  to,
                  transactionGasFee: txFee,
                  transactionHash: txHash,
                  token: WSOL_MINT,
                  tokenType: 'TOKEN',
                });
                previousAccountsClose[from] += wSolAmount;
              } else if (wSolAmount < BigInt(0)) {
                txTransfers.push({
                  amount: wSolAmount * BigInt(-1),
                  blockNumber: (block.parentSlot as number) + 1,
                  from: WSOL_MINT,
                  index: `${index}-1`,
                  timestamp,
                  to: from,
                  transactionGasFee: txFee,
                  transactionHash: txHash,
                  token: null,
                  tokenType: 'NATIVE',
                });
                txTransfers.push({
                  amount: wSolAmount * BigInt(-1),
                  blockNumber: (block.parentSlot as number) + 1,
                  from: to,
                  index: `${index}-2`,
                  timestamp,
                  to: WSOL_MINT,
                  transactionGasFee: txFee,
                  transactionHash: txHash,
                  token: WSOL_MINT,
                  tokenType: 'TOKEN',
                });
                previousAccountsClose[from] += wSolAmount;
              }
            }
          }

          // SOL Transfers
          else if ([SYSTEM_PROGRAM].includes(programId)) {
            // TRANSFER
            if (instSig.startsWith('2,0,0,0,')) {
              const amountData = Buffer.from(instData).slice(4);
              if (amountData.length < 8) continue;
              const amount = BigInt(amountData.readBigUInt64LE(0).toString());
              txTransfers.push({
                amount,
                blockNumber: (block.parentSlot as number) + 1,
                from: matchingAccounts[0],
                index,
                timestamp,
                to: matchingAccounts[1],
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: null,
                tokenType: 'NATIVE',
              });
            }

            // CreateAccount
            else if (instSig.startsWith('0,0,0,0,')) {
              const amountData = Buffer.from(instData).slice(4, 12);
              const amount = BigInt(amountData.readBigUInt64LE(0).toString());
              txTransfers.push({
                amount,
                blockNumber: (block.parentSlot as number) + 1,
                from: matchingAccounts[0],
                index,
                timestamp,
                to: matchingAccounts[1],
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: null,
                tokenType: 'NATIVE',
              });

              createdAccountsToOwner[matchingAccounts[1]] = matchingAccounts[0];

              // try detecting an assignment of the new account
              const initInst = allInstructions[idx + 2];
              if (
                initInst &&
                [SPL_TOKEN_PROGRAM, SPL_TOKEN_2022_PROGRAM].includes(allAccounts[initInst.programIdIndex]) &&
                initInst.accounts.length === 2 &&
                initInst.accounts[0] === inst.accounts[1]
              ) {
                const newOwner = bs58.encode(Buffer.from(bs58.decode(initInst.data)).slice(1));
                createdAccountsToOwner[matchingAccounts[1]] = newOwner;
              }
            }

            // CreateAccountWithSeed
            else if (instSig.startsWith('3,0,0,0,')) {
              const amountData = Buffer.from(instData).slice(instData.length - 48, instData.length - 40);
              const amount = BigInt(amountData.readBigUInt64LE(0).toString());
              txTransfers.push({
                amount,
                blockNumber: (block.parentSlot as number) + 1,
                from: matchingAccounts[0],
                index,
                timestamp,
                to: matchingAccounts[1],
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: null,
                tokenType: 'NATIVE',
              });

              createdAccountsToOwner[matchingAccounts[1]] = matchingAccounts[0];
            }
          }
        } catch (e) {
          // we only want valid transfers
        }
      }

      // handle non-explicit SOL cases
      const solTransferDiffs: Record<string, bigint> = {};
      for (const t of txTransfers) {
        if (t.from === t.to || t.token) continue;
        if (!solTransferDiffs[t.from]) solTransferDiffs[t.from] = BigInt(0);
        if (!solTransferDiffs[t.to]) solTransferDiffs[t.to] = BigInt(0);
        solTransferDiffs[t.from] -= t.amount as bigint;
        solTransferDiffs[t.to] += t.amount as bigint;
      }
      const toReconcile: Record<string, bigint> = {};
      for (let i = 0; i < svmTx.meta.postBalances.length; i += 1) {
        const account = allAccounts[i];
        const diff = BigInt(svmTx.meta.postBalances[i]) - BigInt(svmTx.meta.preBalances[i] || 0);
        if (solTransferDiffs[account] !== diff) {
          toReconcile[account] = diff - (solTransferDiffs[account] || BigInt(0));
        }
      }

      if (Object.keys(toReconcile).length) {
        const wSolTxfers: typeof txTransfers = [];
        for (const t of txTransfers) {
          // handle [near] exact match
          if (
            toReconcile[t.from] &&
            toReconcile[t.to] &&
            toReconcile[t.from] > 0 &&
            toReconcile[t.from] <= toReconcile[t.to] * BigInt(-1)
          ) {
            txTransfers.push({
              amount: toReconcile[t.from],
              blockNumber: (block.parentSlot as number) + 1,
              from: t.to,
              index: t.index + '-1',
              timestamp,
              to: t.from,
              token: null,
              tokenType: 'NATIVE',
              transactionGasFee: txFee,
              transactionHash: txHash,
            });
            toReconcile[t.to] += toReconcile[t.from];
            delete toReconcile[t.from];
            if (toReconcile[t.to] === BigInt(0)) {
              delete toReconcile[t.to];
            }
          }

          // handle silent wrap/unwrap of SOL
          else if (t.token === WSOL_MINT) {
            wSolTxfers.push(t);
            if (toReconcile[t.fromTokenAccount]) {
              txTransfers.push({
                amount: t.amount,
                blockNumber: (block.parentSlot as number) + 1,
                from: t.fromTokenAccount,
                index: t.index + '-1',
                timestamp,
                to: WSOL_MINT,
                token: null,
                tokenType: 'NATIVE',
                transactionGasFee: txFee,
                transactionHash: txHash,
              });
              toReconcile[t.fromTokenAccount] += t.amount as bigint;
              if (toReconcile[t.fromTokenAccount] === BigInt(0)) {
                delete toReconcile[t.fromTokenAccount];
              }
            }
            if (toReconcile[t.toTokenAccount]) {
              txTransfers.push({
                amount: t.amount,
                blockNumber: (block.parentSlot as number) + 1,
                from: WSOL_MINT,
                index: t.index + '-2',
                timestamp,
                to: t.toTokenAccount,
                token: null,
                tokenType: 'NATIVE',
                transactionGasFee: txFee,
                transactionHash: txHash,
              });
              toReconcile[t.toTokenAccount] -= t.amount as bigint;
              if (toReconcile[t.toTokenAccount] === BigInt(0)) {
                delete toReconcile[t.toTokenAccount];
              }
            }
          }
        }

        for (const k in toReconcile) {
          if (toReconcile[k] === BigInt(0)) {
            delete toReconcile[k];
          }
          for (const j in toReconcile) {
            if (k !== j && toReconcile[k] === toReconcile[j] * BigInt(-1)) {
              txTransfers.push({
                amount: toReconcile[j] < BigInt(0) ? toReconcile[j] * BigInt(-1) : toReconcile[j],
                blockNumber: (block.parentSlot as number) + 1,
                from: toReconcile[j] < BigInt(0) ? j : k,
                // index,
                timestamp,
                to: toReconcile[j] > BigInt(0) ? j : k,
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: null,
                tokenType: 'NATIVE',
              });
              delete toReconcile[k];
              delete toReconcile[j];
            }
          }
        }

        // handle internal self transfers
        if (Object.values(toReconcile).reduce((a, b) => a + b, BigInt(0)) === BigInt(0)) {
          const toSend = Object.entries(toReconcile).filter(([k, a]) => a < BigInt(0));
          toSend.sort((a, b) => (a[1] < b[1] ? 1 : 0));
          const toReceive = Object.entries(toReconcile).filter(([k, a]) => a > BigInt(0));
          toReceive.sort((a, b) => (a[1] > b[1] ? 1 : 0));

          for (const toPair of toReceive) {
            let amountToSend = toPair[1];
            const to = toPair[0];
            while (amountToSend > BigInt(0)) {
              const fromPair = toSend[0];
              if (!fromPair) break;
              const from = fromPair[0];
              let amount = amountToSend;
              if (toReconcile[from] * BigInt(-1) < amount) {
                amount = toReconcile[from] * BigInt(-1);
              }

              txTransfers.push({
                amount,
                blockNumber: (block.parentSlot as number) + 1,
                from,
                // index,
                timestamp,
                to,
                transactionGasFee: txFee,
                transactionHash: txHash,
                token: null,
                tokenType: 'NATIVE',
              });
              toReconcile[from] += amount;
              if (toReconcile[from] === BigInt(0)) {
                delete toReconcile[from];
                toSend.shift();
              }
              amountToSend -= amount;
            }
            delete toReconcile[to];
          }
        }

        for (const k in toReconcile) {
          if (toReconcile[k] === BigInt(0)) {
            delete toReconcile[k];
          }
        }
        delete toReconcile[WSOL_MINT];
      }

      // clean up SOL unwraps & token mints
      const tokenTransferDiffs: Record<string, bigint> = {};
      for (const t of txTransfers) {
        if (t.from === t.to) continue;
        const key1 = `${t.from}-${t.token}`;
        const key2 = `${t.to}-${t.token}`;
        if (!tokenTransferDiffs[key1]) tokenTransferDiffs[key1] = BigInt(0);
        if (!tokenTransferDiffs[key2]) tokenTransferDiffs[key2] = BigInt(0);
        tokenTransferDiffs[key1] -= t.amount as bigint;
        tokenTransferDiffs[key2] += t.amount as bigint;
      }
      for (const post of svmTx.meta.postTokenBalances) {
        const account = post.owner;
        const pre = svmTx.meta.preTokenBalances.find(
          (p) => p.mint === post.mint && p.owner === account && p.accountIndex === post.accountIndex
        );
        const diff = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount || 0);
        const key = `${account}-${post.mint}`;
        if (tokenTransferDiffs[key] !== diff && account !== post.mint) {
          const amount = diff - (tokenTransferDiffs[key] || BigInt(0));

          // try attributing to unwrapping wSOL
          if (amount > BigInt(0) && post.mint === WSOL_MINT) {
            txTransfers.push({
              amount,
              blockNumber: (block.parentSlot as number) + 1,
              from: WSOL_MINT,
              // index,
              timestamp,
              to: account,
              transactionGasFee: txFee,
              transactionHash: txHash,
              token: WSOL_MINT,
              tokenType: 'TOKEN',
            });
          }
          // attribute mints
          else if (!pre && amount > BigInt(0)) {
            txTransfers.push({
              amount,
              blockNumber: (block.parentSlot as number) + 1,
              from: post.mint,
              // index,
              timestamp,
              to: account,
              transactionGasFee: txFee,
              transactionHash: txHash,
              token: post.mint,
              tokenType: 'TOKEN',
            });
          }
        }
      }

      transfers.push(
        ...txTransfers.map((t) => {
          delete t.fromTokenAccount;
          delete t.toTokenAccount;
          return t;
        })
      );
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'SOLANA',
        transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
      },
      payload: 'https://jiti.indexing.co/networks/solana/345871978',
      output: [
        {
          amount: 2506024n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '0',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: null,
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 2039280n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '3',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'CtFXczF6VRBE4KgJDebiwhB4Vheg87di5SgPcmMViu8j',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 16788125787n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-2',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'GWPLjamb5ZxrGbTsYNWW7V3p1pAMryZSfaPFTdaEsWgC',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 2485415086n,
          blockNumber: 345871978,
          from: 'GWPLjamb5ZxrGbTsYNWW7V3p1pAMryZSfaPFTdaEsWgC',
          index: '5-3',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 1246447n,
          blockNumber: 345871978,
          from: 'GWPLjamb5ZxrGbTsYNWW7V3p1pAMryZSfaPFTdaEsWgC',
          index: '5-4',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: '62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 1246447n,
          blockNumber: 345871978,
          from: 'GWPLjamb5ZxrGbTsYNWW7V3p1pAMryZSfaPFTdaEsWgC',
          index: '5-5',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: '4XFtPwmsuKo8bHZQWRLWt7Jh4QdhSg9X68g4CELDhpsH',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 10492578617n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-9',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: '3shatpFgdVVwy8Pr723iE9L1fozzaXNdGYKtgrSwHYeJ',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 1553440149n,
          blockNumber: 345871978,
          from: '3shatpFgdVVwy8Pr723iE9L1fozzaXNdGYKtgrSwHYeJ',
          index: '5-10',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 10492578617n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-13',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'ChkRerg6X89xHYqV4iBqcboBdU1WA8Uvs9fp2yZrqbg',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 1552556053n,
          blockNumber: 345871978,
          from: 'ChkRerg6X89xHYqV4iBqcboBdU1WA8Uvs9fp2yZrqbg',
          index: '5-14',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 4197031447n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-17',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'ANcfLC9JcbYbEWu71fE8973V8S6vD5hS98RNrz56hrT7',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 621470846n,
          blockNumber: 345871978,
          from: 'ANcfLC9JcbYbEWu71fE8973V8S6vD5hS98RNrz56hrT7',
          index: '5-18',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 6214921414n,
          blockNumber: 345871978,
          from: 'CtFXczF6VRBE4KgJDebiwhB4Vheg87di5SgPcmMViu8j',
          index: '5-19',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 6212882134n,
          blockNumber: 345871978,
          from: 'So11111111111111111111111111111111111111112',
          index: '5-19-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'CtFXczF6VRBE4KgJDebiwhB4Vheg87di5SgPcmMViu8j',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 6212882134n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-19-2',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 52809498n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-20',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: '9yj3zvLS3fDMqi1F8zhkaWfq8TZpZWHe6cz1Sgt7djXf',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 87500n,
          blockNumber: 345871978,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '6',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'CcTNKBhQKYu7nB4eRrRFQoXEvpd6H5QnGKh93pwniBtp',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 2485415086n,
          blockNumber: 345871978,
          from: 'AYFHMPRhwxiScs98wgYxpMLV4MFbvZRRZo2G5hdun9Fp',
          index: '5-3-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 1246447n,
          blockNumber: 345871978,
          from: 'AYFHMPRhwxiScs98wgYxpMLV4MFbvZRRZo2G5hdun9Fp',
          index: '5-4-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 1246447n,
          blockNumber: 345871978,
          from: 'So11111111111111111111111111111111111111112',
          index: '5-4-2',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: '94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 1246447n,
          blockNumber: 345871978,
          from: 'AYFHMPRhwxiScs98wgYxpMLV4MFbvZRRZo2G5hdun9Fp',
          index: '5-5-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 1246447n,
          blockNumber: 345871978,
          from: 'So11111111111111111111111111111111111111112',
          index: '5-5-2',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'F4qmtKg8FWBp85WsFGKzUKfyn6G6WiC5kerddYcuZq3c',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 1553440149n,
          blockNumber: 345871978,
          from: 'BT1NKpgNBBNbC9RRVuWPGBqFmqFznwsZKh3x2gDyykmq',
          index: '5-10-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 1552556053n,
          blockNumber: 345871978,
          from: 'DQwTf8dHkjtM6VuewpgET7MS7kX3EEXQDqvXkScC6tnB',
          index: '5-14-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
        {
          amount: 621470846n,
          blockNumber: 345871978,
          from: 'FLgakNeU6FWQ4d6qThc3YswxpHgupVusCbqqsaL5Ya3d',
          index: '5-18-1',
          timestamp: '2025-06-10T12:06:56.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 2506024n,
          transactionHash: '65sABMeYatoyzsp1mL6UjAXoBqUdw47HR33ouvR9BFNipTNydqvWTt8PMbVqZZfvnX3TzwB3XSdk55cy3N6u8okR',
        },
      ],
    },

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
          blockNumber: 326286476,
          from: 'D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf',
          index: '1',
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
        walletAddress: '5cuy7pMhTPhVZN9xuhgSbykRb986siGJb6vnEtkuBrSU',
        contractAddress: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
      },
      payload: 'https://jiti.indexing.co/networks/solana/325076237',
      output: [
        {
          amount: 14216129n,
          blockNumber: 325076237,
          from: '2MFoS3MPtvyQ4Wh4M9pdfPjz6UhVoNbFbGJAskCPCj3h',
          index: '6-9',
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
          amount: 80001n,
          blockNumber: 332450156,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '0',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: null,
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 2039280n,
          blockNumber: 332450156,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '3-3',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '5XggDBvoRA65ss8NJV9BZjf57JzC64VHqZTag4AQJZzQ',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 500000000n,
          blockNumber: 332450156,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '3-6',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '5XggDBvoRA65ss8NJV9BZjf57JzC64VHqZTag4AQJZzQ',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 97937250n,
          blockNumber: 332450156,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '4-2',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '4acL7mD2J6GYJy2g3iVTvfpmHCQSZ1rb8DBuupjcVzHJ',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 3914205773n,
          blockNumber: 332450156,
          from: '4acL7mD2J6GYJy2g3iVTvfpmHCQSZ1rb8DBuupjcVzHJ',
          index: '4-3',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 402062750n,
          blockNumber: 332450156,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '4-6',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 16051909872n,
          blockNumber: 332450156,
          from: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
          index: '4-7',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 2039280n,
          blockNumber: 332450156,
          from: '5XggDBvoRA65ss8NJV9BZjf57JzC64VHqZTag4AQJZzQ',
          index: '4-9',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
        },
        {
          amount: 500000000n,
          blockNumber: 332450156,
          from: 'So11111111111111111111111111111111111111112',
          index: '4-9-2',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
        },
        {
          amount: 169711982n,
          blockNumber: 332450156,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '4-10',
          timestamp: '2025-04-10T02:29:35.000Z',
          to: '8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf',
          transactionGasFee: 80001n,
          transactionHash: '32T7ANVqz1sHBoKhfk3omrRqwDCJFYMi6TfuAwyqHPCZPCihdWTU9t9i5D6tGwuytWRwRqnEXksMPMWbFbfBzVUk',
          token: 'CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump',
          tokenType: 'TOKEN',
        },
      ],
    },

    {
      params: {
        network: 'SOLANA',
        walletAddress: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
      payload: 'https://jiti.indexing.co/networks/solana/332822080',
      output: [
        {
          amount: 2500000n,
          blockNumber: 332822080,
          from: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
          index: '4-1',
          timestamp: '2025-04-11T19:36:39.000Z',
          to: '3LoAYHuSd7Gh8d7RTFnhvYtiTiefdZ5ByamU42vkzd76',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 350362n,
          transactionHash: 'xKTWvnhSRErcHCMozRMEue4MriNr1Any6LiaQzXrR7imZ1MpZxRqbyv9LLg4JQoDq4oJZpDqPmzxLCtMCkgj2hn',
        },
        {
          amount: 2497500000n,
          blockNumber: 332822080,
          from: 'J1dHwpKBs8Jo4n7jWEJWwMGNH2DJQnApBFPnnYXg74v7',
          index: '4-3',
          timestamp: '2025-04-11T19:36:39.000Z',
          to: '4xDsmeTWPNjgSVSS1VTfzFq3iHZhp77ffPkAmkZkdu71',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 350362n,
          transactionHash: 'xKTWvnhSRErcHCMozRMEue4MriNr1Any6LiaQzXrR7imZ1MpZxRqbyv9LLg4JQoDq4oJZpDqPmzxLCtMCkgj2hn',
        },
      ],
    },

    {
      params: {
        network: 'SOLANA',
        walletAddress: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
      },
      payload: 'https://jiti.indexing.co/networks/solana/344836070',
      output: [
        {
          amount: 118174n,
          blockNumber: 344836070,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '0',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: null,
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 2039280n,
          blockNumber: 344836070,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '3',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: 'AnvCq4bLUX7CBid2kALUG1iQ9po81bq5wzxsjnTaNLyn',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 21234547656n,
          blockNumber: 344836070,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-3',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: 'ChkRerg6X89xHYqV4iBqcboBdU1WA8Uvs9fp2yZrqbg',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: '6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 3300686091n,
          blockNumber: 344836070,
          from: 'ChkRerg6X89xHYqV4iBqcboBdU1WA8Uvs9fp2yZrqbg',
          index: '5-4',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 3302725371n,
          blockNumber: 344836070,
          from: 'AnvCq4bLUX7CBid2kALUG1iQ9po81bq5wzxsjnTaNLyn',
          index: '5-5',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 3300686091n,
          blockNumber: 344836070,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-5-2',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: 'So11111111111111111111111111111111111111112',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
        },
        {
          amount: 28055831n,
          blockNumber: 344836070,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '5-6',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: '9yj3zvLS3fDMqi1F8zhkaWfq8TZpZWHe6cz1Sgt7djXf',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 85000n,
          blockNumber: 344836070,
          from: 'DgC9bBDvJYeVyTqcp8nW5F5USNvxBiZ9NMoTUVy5UVPz',
          index: '6',
          timestamp: '2025-06-05T18:30:59.000Z',
          to: '6HRgJMRmjaj2svP9GpRbUU5TPzLAHnBW3sHgYVbirWYE',
          transactionGasFee: 118174n,
          transactionHash: '2wQdUtEnCf77jiros6eCbQ1BrWrn1uw4nisy87kmgHhZMGX2CqBugaLdne6bvQR8mAdxinVLivcbVVfJAdTry2rw',
          token: null,
          tokenType: 'NATIVE',
        },
      ],
    },

    {
      params: {
        network: 'SOLANA',
        walletAddress: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
      },
      payload: 'https://jiti.indexing.co/networks/solana/343762745',
      output: [
        {
          amount: 191568n,
          blockNumber: 343762745,
          from: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
          index: '0',
          timestamp: '2025-05-31T21:20:52.000Z',
          to: null,
          transactionGasFee: 191568n,
          transactionHash: '5usAzMSrENJQscoRdxi48n22aMcFmJ1U7f2yGmwUk8AHSFCzLfRtBP7gVnsZbe7Jy9SG2VoeVbVSoVvu43tsdvm1',
          token: null,
          tokenType: 'NATIVE',
        },
        {
          amount: 7504823498621n,
          blockNumber: 343762745,
          from: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
          index: '4-2',
          timestamp: '2025-05-31T21:20:52.000Z',
          to: 'BXYKJpQvoZngmTGGr9U2NYQ2ND9Cw6B79ULzTkufcSXB',
          transactionGasFee: 191568n,
          transactionHash: '5usAzMSrENJQscoRdxi48n22aMcFmJ1U7f2yGmwUk8AHSFCzLfRtBP7gVnsZbe7Jy9SG2VoeVbVSoVvu43tsdvm1',
          token: 'fnDj6iuSBBruq1GX5GQwxGa3MvAxiJbnPBSvHt4pump',
          tokenType: 'TOKEN',
        },
        {
          amount: 52507862455n,
          blockNumber: 343762745,
          from: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
          index: '4-9',
          timestamp: '2025-05-31T21:20:52.000Z',
          to: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
          transactionGasFee: 191568n,
          transactionHash: '5usAzMSrENJQscoRdxi48n22aMcFmJ1U7f2yGmwUk8AHSFCzLfRtBP7gVnsZbe7Jy9SG2VoeVbVSoVvu43tsdvm1',
          token: 'JB2wezZLdzWfnaCfHxLg193RS3Rh51ThiXxEDWQDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 2184670002n,
          blockNumber: 343762745,
          from: 'EHks3xWvbScHwygkB1QMsz38rEmht5tE1yyAreRUWELj',
          index: '4-13',
          timestamp: '2025-05-31T21:20:52.000Z',
          to: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
          transactionGasFee: 191568n,
          transactionHash: '5usAzMSrENJQscoRdxi48n22aMcFmJ1U7f2yGmwUk8AHSFCzLfRtBP7gVnsZbe7Jy9SG2VoeVbVSoVvu43tsdvm1',
          token: 'JB2wezZLdzWfnaCfHxLg193RS3Rh51ThiXxEDWQDpump',
          tokenType: 'TOKEN',
        },
        {
          amount: 54692532n,
          blockNumber: 343762745,
          from: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
          index: '4-14',
          timestamp: '2025-05-31T21:20:52.000Z',
          to: '3CgvbiM3op4vjrrjH2zcrQUwsqh5veNVRjFCB9N6sRoD',
          transactionGasFee: 191568n,
          transactionHash: '5usAzMSrENJQscoRdxi48n22aMcFmJ1U7f2yGmwUk8AHSFCzLfRtBP7gVnsZbe7Jy9SG2VoeVbVSoVvu43tsdvm1',
          token: 'JB2wezZLdzWfnaCfHxLg193RS3Rh51ThiXxEDWQDpump',
          tokenType: 'TOKEN',
        },
      ],
    },

    {
      params: {
        network: 'SOLANA',
        walletAddress: 'moAGAQftMo19RY6YqStNdiDhNpejJaeNWgv5oczbp8U',
      },
      payload: 'https://jiti.indexing.co/networks/solana/375557379',
      output: [
        {
          amount: 5000n,
          blockNumber: 375557379,
          from: 'moAGAQftMo19RY6YqStNdiDhNpejJaeNWgv5oczbp8U',
          index: '0',
          timestamp: '2025-10-24T20:23:09.000Z',
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '3UCamcERYHN9JrgwPqUshvabv2f7uHpbStwfG7bbPFsVSSjQrK21Q9joj7gNLD6Ab5XHehkaUKtYp7Vptv7Kswv3',
        },
        {
          amount: 9990000n,
          blockNumber: 375557379,
          from: 'moAGAQftMo19RY6YqStNdiDhNpejJaeNWgv5oczbp8U',
          index: '2',
          timestamp: '2025-10-24T20:23:09.000Z',
          to: '5uQC5CfgqGP8B8bG64RATmZXfUKiHf1XRbYHkVKPwwny',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '3UCamcERYHN9JrgwPqUshvabv2f7uHpbStwfG7bbPFsVSSjQrK21Q9joj7gNLD6Ab5XHehkaUKtYp7Vptv7Kswv3',
        },
        {
          amount: 9990000n,
          blockNumber: 375557379,
          from: 'So11111111111111111111111111111111111111112',
          timestamp: '2025-10-24T20:23:09.000Z',
          to: 'moAGAQftMo19RY6YqStNdiDhNpejJaeNWgv5oczbp8U',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '3UCamcERYHN9JrgwPqUshvabv2f7uHpbStwfG7bbPFsVSSjQrK21Q9joj7gNLD6Ab5XHehkaUKtYp7Vptv7Kswv3',
        },
      ],
    },

    {
      params: {
        network: 'SOLANA',
        transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
      },
      payload: 'https://jiti.indexing.co/networks/solana/377071751',
      output: [
        {
          amount: 5000n,
          blockNumber: 377071751,
          from: 'CDr3sjXFHVPZYp8k7AUNHVJDN1sfvppLfPHd4Pwk8Mha',
          index: '0',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 2500n,
          blockNumber: 377071751,
          from: 'CDr3sjXFHVPZYp8k7AUNHVJDN1sfvppLfPHd4Pwk8Mha',
          index: '1',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 2497500n,
          blockNumber: 377071751,
          from: 'CDr3sjXFHVPZYp8k7AUNHVJDN1sfvppLfPHd4Pwk8Mha',
          index: '2-1',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 2497500n,
          blockNumber: 377071751,
          from: '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx',
          index: '2-3',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'Enc6rB84ZwGxZU8aqAF41dRJxg3yesiJgD7uJFVhMraM',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 24n,
          blockNumber: 377071751,
          from: 'Enc6rB84ZwGxZU8aqAF41dRJxg3yesiJgD7uJFVhMraM',
          index: '2-4',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'ATowQwFzdJBJ9VFSfoNKmuB8GiSeo8foM5vRriwmKmFB',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 24n,
          blockNumber: 377071751,
          from: 'Enc6rB84ZwGxZU8aqAF41dRJxg3yesiJgD7uJFVhMraM',
          index: '2-5',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp',
          token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 13258805n,
          blockNumber: 377071751,
          from: 'Enc6rB84ZwGxZU8aqAF41dRJxg3yesiJgD7uJFVhMraM',
          index: '2-6',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 13258800n,
          blockNumber: 377071751,
          from: '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx',
          index: '2-9',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: '6nL4UZVRkn34Mxb7DGU91U86zhtF2PTX72Ncs64sUFx',
          token: 'So11111111111111111111111111111111111111112',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 1511170n,
          blockNumber: 377071751,
          from: '6nL4UZVRkn34Mxb7DGU91U86zhtF2PTX72Ncs64sUFx',
          index: '2-10',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx',
          token: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 1511170n,
          blockNumber: 377071751,
          from: '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx',
          index: '2-12',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'CDr3sjXFHVPZYp8k7AUNHVJDN1sfvppLfPHd4Pwk8Mha',
          token: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
          tokenType: 'TOKEN',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 13258805n,
          blockNumber: 377071751,
          from: 'HZ5JFB1ZoZs6NQLr7bb4MMEXDgty4Vs1ZghoyX35mNnV',
          index: '2-6-1',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 13258805n,
          blockNumber: 377071751,
          from: 'So11111111111111111111111111111111111111112',
          index: '2-6-2',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'BuqEDKUwyAotZuK37V4JYEykZVKY8qo1zKbpfU9gkJMo',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 13258800n,
          blockNumber: 377071751,
          from: 'BuqEDKUwyAotZuK37V4JYEykZVKY8qo1zKbpfU9gkJMo',
          index: '2-9-1',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'So11111111111111111111111111111111111111112',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
        {
          amount: 13258800n,
          blockNumber: 377071751,
          from: 'So11111111111111111111111111111111111111112',
          index: '2-9-2',
          timestamp: '2025-10-31T20:00:23.000Z',
          to: 'B6whMxirSzzNcSeJ1G4HDFTRKjPFcWovCL53uxG7LexB',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 5000n,
          transactionHash: '2asCG9FQdkcbRiX56dCoUMByE871biTZmctv6DBo5EYMkJWCrJ4hNVBkrFGwjQCK2T6XPPeLkd8hWkji9WqjUxF6',
        },
      ],
    },

    {
      params: {
        network: 'SOLANA',
        transactionHash: '4RA82Xf6otGz4PLaLYkLqMUQPnzgmQS3ZE5fN1zz2wMo1Vuew4CeCzAcStfCHSNGxE2P9StpUxiTe1kdn5B755WY',
      },
      payload: 'https://jiti.indexing.co/networks/solana/387132087',
      output: [
        {
          amount: 106500n,
          blockNumber: 387132087,
          from: '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm',
          index: '0',
          timestamp: '2025-12-16T17:55:26.000Z',
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 106500n,
          transactionHash: '4RA82Xf6otGz4PLaLYkLqMUQPnzgmQS3ZE5fN1zz2wMo1Vuew4CeCzAcStfCHSNGxE2P9StpUxiTe1kdn5B755WY',
        },
        {
          amount: 1000000n,
          blockNumber: 387132087,
          from: '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm',
          index: '1',
          timestamp: '2025-12-16T17:55:26.000Z',
          to: '6uZakWzCdFF8H2Tk8WVHQdkkaLVLR9wLCrU8ikCj8uE3',
          token: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
          tokenType: 'TOKEN',
          transactionGasFee: 106500n,
          transactionHash: '4RA82Xf6otGz4PLaLYkLqMUQPnzgmQS3ZE5fN1zz2wMo1Vuew4CeCzAcStfCHSNGxE2P9StpUxiTe1kdn5B755WY',
        },
      ],
    },
  ],
};

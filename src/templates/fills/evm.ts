import { SubTemplate } from '../../types';
import { evmDecodeLog } from '../../utils';
import { blockToVM } from '../../utils/block-to-vm';
import type { EvmBlock } from '../../types/beats/evm';
import tokenTransfers from '../token-transfers';
import { NetworkTransfer } from '../token-transfers/types';
import { Fill, FillCashLeg } from './types';
import { NATIVE_TOKEN, quoteTokensFor } from './quotes';
import { EVM_FILL_TESTS } from './evm.fixtures';

// A fill is a change in a wallet's balance of a non-quote token within one transaction. Reading balances rather
// than swap events is what makes routers, aggregators, ERC-4337 bundles and Relay's cross-chain fills visible
// without a decoder per venue: whatever the route, the tokens land in (or leave) the wallet.
//
// The cash leg is then read from the most direct evidence available in the same transaction:
//   1. the wallet's own quote-token movement (a direct swap),
//   2. Relay's FundsMovement pair (solver funds the route -> router delivers to the wallet), linked by metadata,
//   3. Relay's deposit of the wallet's proceeds (RelayErc20Deposit / RelayNativeDeposit with from = wallet).
const SIG = {
  USER_OPERATION:
    'UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  FUNDS_MOVEMENT: 'FundsMovement(address from, address to, address currency, uint256 amount, bytes metadata)',
  RELAY_ERC20_DEPOSIT: 'RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)',
  RELAY_NATIVE_DEPOSIT: 'RelayNativeDeposit(address from, uint256 amount, bytes32 id)',
};

const ZERO = '0x0000000000000000000000000000000000000000';
const lower = (v: unknown) => String(v).toLowerCase();
const abs = (v: bigint) => (v < 0n ? -v : v);

type RelayMovement = { from: string; to: string; currency: string; amount: bigint; metadata: string };
type RelayDeposit = { from: string; token: string; amount: bigint; id: string };

export const EVMFills: SubTemplate = {
  match: (block) => blockToVM(block) === 'EVM',

  transform(block, _ctx) {
    const typedBlock = block as unknown as EvmBlock;
    const timestamp = new Date(typedBlock.timestamp * 1000).toISOString();
    const params = _ctx?.params || {};
    const quotes = quoteTokensFor(block._network as string, (params.quoteTokens as string[]) || []);
    const tracked = new Set(([params.walletAddress].flat().filter(Boolean) as string[]).map(lower));

    const transfersByTx = new Map<string, NetworkTransfer[]>();
    for (const t of tokenTransfers.transform(block, {
      params: { tokenTypes: ['NATIVE', 'TOKEN'] },
    }) as NetworkTransfer[]) {
      const list = transfersByTx.get(t.transactionHash) || [];
      list.push(t);
      transfersByTx.set(t.transactionHash, list);
    }

    const fills: Fill[] = [];

    for (const tx of (typedBlock.transactions as any[]) || []) {
      if (!tx.receipt || tx.receipt.status === 0 || tx.receipt.status === false) continue;
      const transfers = transfersByTx.get(tx.hash);
      if (!transfers?.length) continue;

      const signers = new Set<string>([lower(tx.from)]);
      const movements: RelayMovement[] = [];
      const deposits: RelayDeposit[] = [];
      for (const log of tx.receipt.logs || []) {
        if (!log.topics?.length) continue;
        const op = evmDecodeLog(log, SIG.USER_OPERATION);
        if (op) {
          if (op.success) signers.add(lower(op.sender));
          continue;
        }
        const mv = evmDecodeLog(log, SIG.FUNDS_MOVEMENT);
        if (mv) {
          movements.push({
            from: lower(mv.from),
            to: lower(mv.to),
            currency: lower(mv.currency),
            amount: mv.amount as bigint,
            metadata: lower(mv.metadata),
          });
          continue;
        }
        const erc20 = evmDecodeLog(log, SIG.RELAY_ERC20_DEPOSIT);
        if (erc20) {
          deposits.push({
            from: lower(erc20.from),
            token: lower(erc20.token),
            amount: erc20.amount as bigint,
            id: lower(erc20.id),
          });
          continue;
        }
        const native = evmDecodeLog(log, SIG.RELAY_NATIVE_DEPOSIT);
        if (native) {
          deposits.push({
            from: lower(native.from),
            token: NATIVE_TOKEN,
            amount: native.amount as bigint,
            id: lower(native.id),
          });
        }
      }

      // Net balance change per wallet per token.
      const deltas = new Map<string, Map<string, bigint>>();
      const bump = (wallet: string, token: string, by: bigint) => {
        const w = deltas.get(wallet) || new Map<string, bigint>();
        w.set(token, (w.get(token) || 0n) + by);
        deltas.set(wallet, w);
      };
      for (const t of transfers) {
        const from = lower(t.from);
        const to = lower(t.to);
        if (from === to) continue;
        const token = t.tokenType === 'NATIVE' ? NATIVE_TOKEN : lower(t.token);
        const amount = BigInt(t.amount);
        bump(from, token, -amount);
        bump(to, token, amount);
      }

      // Who to report: the requested wallets, or else everyone who plausibly traded (signers and Relay counterparties).
      // Pools and routers also have balance changes; without a wallet list they are excluded this way.
      const wallets = tracked.size
        ? [...tracked]
        : [...new Set([...signers, ...movements.map((m) => m.to), ...deposits.map((d) => d.from)])];

      for (const wallet of wallets) {
        if (wallet === ZERO) continue;
        const walletDeltas = deltas.get(wallet);
        if (!walletDeltas) continue;

        const bases = [...walletDeltas].filter(([token, d]) => d !== 0n && !quotes.has(token));
        const quoteLegs = [...walletDeltas].filter(([token, d]) => d !== 0n && quotes.has(token));

        for (const [token, delta] of bases) {
          const side: Fill['side'] = delta > 0n ? 'BUY' : 'SELL';
          const fill: Fill = {
            blockNumber: typedBlock.number,
            timestamp,
            transactionHash: tx.hash,
            wallet,
            side,
            token,
            amount: abs(delta),
            signedByWallet: signers.has(wallet),
          };

          // 1. Direct swap: exactly one base moved, paid for (or paid out) in exactly one quote token.
          const opposite = quoteLegs.filter(([, d]) => (side === 'BUY' ? d < 0n : d > 0n));
          const sameSideBases = bases.filter(([, d]) => d > 0n === delta > 0n);
          let cashLeg: FillCashLeg | undefined;
          if (sameSideBases.length === 1 && opposite.length === 1) {
            cashLeg = { token: opposite[0][0], amount: abs(opposite[0][1]), source: 'WALLET' };
          }

          // 2. Relay fill: the router delivered this token to the wallet; the movement that funded that route
          //    carries the same metadata.
          if (!cashLeg && side === 'BUY') {
            const delivery = movements.find((m) => m.to === wallet && m.currency === token);
            const funding =
              delivery && movements.find((m) => m !== delivery && m.metadata === delivery.metadata && m.to !== wallet);
            if (funding) {
              cashLeg = {
                token: funding.currency === ZERO ? NATIVE_TOKEN : funding.currency,
                amount: funding.amount,
                source: 'RELAY_FILL',
              };
              // Relay appends the order id to the fill transaction's calldata.
              const input = String(tx.input || '');
              if (/^0x[0-9a-f]*$/i.test(input) && input.length >= 2 + 64)
                fill.relayOrderId = lower('0x' + input.slice(-64));
            }
          }

          // 3. Relay deposit: the wallet's proceeds left for another chain. Only unambiguous when this is the
          //    wallet's only sell in the transaction.
          if (!cashLeg && side === 'SELL' && sameSideBases.length === 1) {
            const mine = deposits.filter((d) => d.from === wallet);
            if (mine.length === 1) {
              cashLeg = { token: mine[0].token, amount: mine[0].amount, source: 'RELAY_DEPOSIT' };
              fill.relayOrderId = mine[0].id;
            }
          }

          if (cashLeg) fill.cashLeg = cashLeg;
          fills.push(fill);
        }
      }
    }

    return fills;
  },

  tests: EVM_FILL_TESTS,
};

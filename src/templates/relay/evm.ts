import { SubTemplate } from '../../types';
import { evmDecodeLog } from '../../utils';
import { blockToVM } from '../../utils/block-to-vm';
import type { EvmBlock } from '../../types/beats/evm';
import { RelayOrderEvent } from './types';
import { EVM_RELAY_TESTS } from './evm.fixtures';

// EVM side of Relay orders, by event signature (Relay deploys the same contracts at the same addresses across chains,
// but decoding by event keeps new deployments working).
//   DEPOSIT: RelayDepository's RelayErc20Deposit / RelayNativeDeposit, `id` = order id.
//   PAYOUT:  RelayRouter's FundsMovement sending funds out of the router to a recipient. The order id isn't in the
//            event; Relay appends it to the fill transaction's calldata (verified against api.relay.link).
const SIG = {
  ERC20_DEPOSIT: 'RelayErc20Deposit(address from, address token, uint256 amount, bytes32 id)',
  NATIVE_DEPOSIT: 'RelayNativeDeposit(address from, uint256 amount, bytes32 id)',
  FUNDS_MOVEMENT: 'FundsMovement(address from, address to, address currency, uint256 amount, bytes metadata)',
};

const ZERO = '0x0000000000000000000000000000000000000000';
const lower = (v: unknown) => String(v).toLowerCase();

export const EVMRelayOrders: SubTemplate = {
  match: (block) => blockToVM(block) === 'EVM',

  transform(block) {
    const typedBlock = block as unknown as EvmBlock;
    const network = String(block._network || '').toUpperCase();
    const timestamp = new Date(typedBlock.timestamp * 1000).toISOString();
    const events: RelayOrderEvent[] = [];

    for (const tx of (typedBlock.transactions as any[]) || []) {
      if (!tx.receipt || tx.receipt.status === 0 || tx.receipt.status === false) continue;
      const base = { network, blockNumber: typedBlock.number, timestamp, transactionHash: tx.hash };
      const input = String(tx.input || '');
      const calldataOrderId =
        /^0x[0-9a-fA-F]+$/.test(input) && input.length >= 2 + 64 ? lower('0x' + input.slice(-64)) : null;

      for (const log of tx.receipt.logs || []) {
        if (!log.topics?.length) continue;

        const erc20 = evmDecodeLog(log, SIG.ERC20_DEPOSIT);
        if (erc20) {
          events.push({
            ...base,
            type: 'DEPOSIT',
            orderId: lower(erc20.id),
            address: lower(erc20.from),
            token: lower(erc20.token),
            amount: erc20.amount as bigint,
          });
          continue;
        }
        const native = evmDecodeLog(log, SIG.NATIVE_DEPOSIT);
        if (native) {
          events.push({
            ...base,
            type: 'DEPOSIT',
            orderId: lower(native.id),
            address: lower(native.from),
            token: 'native',
            amount: native.amount as bigint,
          });
          continue;
        }
        const mv = evmDecodeLog(log, SIG.FUNDS_MOVEMENT);
        // Only movements the router makes out of itself are payouts; the approval proxy's funding movements
        // (solver -> router) are not.
        if (mv && calldataOrderId && lower(mv.from) === lower(log.address) && lower(mv.to) !== lower(log.address)) {
          events.push({
            ...base,
            type: 'PAYOUT',
            orderId: calldataOrderId,
            address: lower(mv.to),
            token: lower(mv.currency) === ZERO ? 'native' : lower(mv.currency),
            amount: mv.amount as bigint,
          });
        }
      }
    }
    return events;
  },

  tests: EVM_RELAY_TESTS,
};

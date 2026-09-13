import { Template } from '../../types';
import { EVMRelayOrders } from './evm';
import { SVMRelayOrders } from './svm';
import { RelayOrderEvent } from './types';

const SUB_TEMPLATES = [SVMRelayOrders, EVMRelayOrders];

const relayOrdersTemplate: Template = {
  key: 'relay_orders',
  name: 'Relay Orders',
  description:
    'Get Relay (relay.link) cross-chain order deposits and payouts in a block, keyed by the order id both chains share.',
  tags: ['EVM', 'SVM', 'RELAY', 'BRIDGE', 'CROSS_CHAIN'],
  disabled: false,
  params: [
    { key: 'network', name: 'Network', type: 'NETWORK', optional: false },
    { key: 'orderId', name: 'Order Id', type: 'STRING', optional: true },
    { key: 'address', name: 'Depositor or Recipient', type: 'ADDRESS', optional: true },
  ],

  transform: (block, _ctx = { params: {} }) => {
    let events: RelayOrderEvent[] = [];
    for (const sub of SUB_TEMPLATES) {
      if (sub.match(block)) {
        events = sub.transform(block, _ctx) as RelayOrderEvent[];
        break;
      }
    }
    const orderId = (_ctx?.params?.orderId as string | undefined)?.toLowerCase();
    const address = _ctx?.params?.address as string | undefined;
    return events.filter(
      (e) => (!orderId || e.orderId === orderId) && (!address || e.address.toLowerCase() === address.toLowerCase())
    );
  },

  tests: SUB_TEMPLATES.map((v) => v.tests).flat(),
};

export default relayOrdersTemplate;

const PARTIAL_VM_TO_NETWORK_MAP = {
  APTOS: ['APTOS', 'APTOS_TESTNET', 'MOVEMENT_BARDOCK'],
  CARDANO: ['CARDANO'],
  FILECOIN: ['FILECOIN'],
  RIPPLE: ['RIPPLE'],
  STARKNET: ['STARKNET'],
  STELLAR: ['STELLAR'],
  SUBSTRATE: ['ASTAR', 'BITTENSOR', 'ENJIN', 'KUSAMA', 'POLKADOT'],
  SUI: ['SUI'],
  SVM: ['ECLIPSE', 'SOLANA', 'SOLANA_DEVNET'],
  TON: ['TON'],
  UTXO: ['BTICOIN', 'BITCOIN_TESTNET', 'DOGECOIN', 'LITECOIN'],
};

const PARTIAL_NETWORK_TO_VM_MAP = Object.entries(PARTIAL_VM_TO_NETWORK_MAP)
  .map(([vm, networks]) => networks.map((n) => ({ [n]: vm })))
  .flat()
  .reduce((a, b) => ({ ...a, ...b }), {});

export default function blockToVM(block: Record<string, unknown>): string {
  if (!block) return null;

  if (PARTIAL_NETWORK_TO_VM_MAP[block._network as string]) {
    return PARTIAL_NETWORK_TO_VM_MAP[block._network as string];
  }

  if (!!block.block) {
    return 'COSMOS';
  }

  // "safe" default
  return 'EVM';
}

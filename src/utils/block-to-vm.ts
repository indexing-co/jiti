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
  UTXO: ['BITCOIN', 'BITCOIN_TESTNET', 'DOGECOIN', 'LITECOIN'],
};

const PARTIAL_NETWORK_TO_VM_MAP = Object.entries(PARTIAL_VM_TO_NETWORK_MAP)
  .map(([vm, networks]) => networks.map((n) => ({ [n]: vm })))
  .flat()
  .reduce((a, b) => ({ ...a, ...b }), {});

export function blockToVM(block: Record<string, unknown>): string {
  if (!block) return null;

  const network = (block._network as string).toUpperCase();
  if (PARTIAL_NETWORK_TO_VM_MAP[network]) {
    return PARTIAL_NETWORK_TO_VM_MAP[network];
  }

  if (!!block.block) {
    return 'COSMOS';
  }

  // "safe" default
  return 'EVM';
}

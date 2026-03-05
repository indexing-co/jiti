# JITI - Just In Time Indexing

Open source template library for extracting and transforming blockchain data across 15+ networks. Built by [Indexing Co](https://indexing.co).

## Installation

```bash
npm install @indexing/jiti
```

## Overview

JITI provides a unified interface for extracting structured data from raw blockchain blocks. It ships with built-in templates for common use cases and utility functions for working with multi-chain data.

### Supported Networks

| VM Type | Networks |
|---------|----------|
| **EVM** | Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, and [100+ more](src/utils/evm-chain-to-id.ts) |
| **SVM** | Solana, Eclipse |
| **UTXO** | Bitcoin, Litecoin, Dogecoin, Zcash |
| **Substrate** | Polkadot, Kusama, Astar, Bittensor, Enjin |
| **Cosmos** | Cosmos Hub and Tendermint-based chains |
| **Aptos** | Aptos, Movement |
| **Cardano** | Cardano |
| **Sui** | Sui |
| **Starknet** | Starknet |
| **Stellar** | Stellar |
| **Filecoin** | Filecoin |
| **Ripple** | XRP Ledger |
| **TON** | The Open Network |

## Usage

### Token Transfers

Extract token transfers from any supported block with a single interface:

```typescript
import { templates } from '@indexing/jiti';

const transfers = templates.tokenTransfers.transform(block, {
  params: {
    network: 'ETHEREUM',
    walletAddress: '0x...', // optional - filter by wallet
    contractAddress: '0x...', // optional - filter by token contract
    tokenTypes: ['NATIVE', 'TOKEN', 'NFT'], // optional - filter by type
  },
});
```

Each transfer follows the `NetworkTransfer` type:

```typescript
type NetworkTransfer = {
  amount: number | bigint;
  blockNumber: number;
  from: string;
  to: string;
  token?: string;
  tokenId?: string;
  tokenType: 'NATIVE' | 'TOKEN' | 'NFT';
  transactionHash: string;
  transactionGasFee: bigint;
  timestamp: string;
};
```

### Utilities

```typescript
import { utils } from '@indexing/jiti';

// Detect the VM type from a raw block
utils.blockToVM(block); // 'EVM' | 'SVM' | 'CARDANO' | ...

// Extract block number, timestamp, or tx hashes from any block
utils.blockToBeat(block);
utils.blockToTimestamp(block);
utils.blockToTransactionHashes(block);

// EVM-specific helpers
utils.evmChainToId('ETHEREUM'); // 1
utils.evmIdToChain(137); // 'POLYGON'
utils.evmAddressToChecksum('0xabc...');
utils.evmDecodeLog(log, abi);
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Lint & format
npm run lint
```

### Adding a New Network

Token transfer templates live in `src/templates/token-transfers/`. Each network implements the `SubTemplate` interface:

```typescript
import { SubTemplate } from '../../types';

export const MyChainTokenTransfers: SubTemplate = {
  match: (block) => /* return true if this block belongs to your chain */,
  transform(block) {
    // Parse the block and return NetworkTransfer[]
  },
  tests: [
    {
      params: { network: 'MY_CHAIN', walletAddress: '...' },
      payload: 'https://jiti.indexing.co/networks/my_chain/12345',
      output: [/* expected NetworkTransfer objects */],
    },
  ],
};
```

Then register it in `src/templates/token-transfers/index.ts`.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

[GPL-3.0-or-later](LICENSE.md) - Copyright 2024 The Indexing Company

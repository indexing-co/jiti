# CLAUDE.md

This file provides context for AI assistants working on this codebase.

## Project Overview

JITI (Just In Time Indexing) is a TypeScript library that extracts structured data from raw blockchain blocks. It provides a unified `NetworkTransfer` type across 15+ blockchain VMs.

Published as `@indexing/jiti` on npm.

## Build & Test

```bash
npm install        # install dependencies
npm test           # run tests (ts-node tests.ts) - requires API_KEY in .env
npm run build      # build with parcel (outputs to dist/)
npm run lint       # prettier + eslint
```

Tests fetch real block data from `https://jiti.indexing.co/networks/{network}/{block}` and compare output against expected values using `assert.deepStrictEqual`. An `API_KEY` environment variable is required.

## Project Structure

- `src/index.ts` - Main entry point, exports templates and utilities
- `src/types.ts` - Core types: `Template`, `SubTemplate`, `VMType`, `NetworkType`
- `src/templates/token-transfers/` - Per-chain token transfer extraction (one file per VM type)
- `src/templates/token-transfers/index.ts` - Orchestrator that routes blocks to the right chain handler
- `src/templates/token-transfers/types.ts` - `NetworkTransfer` type definition
- `src/templates/filter-values.ts` - Filter values template
- `src/templates/raw.ts` - Pass-through raw block template (disabled)
- `src/utils/` - Multi-chain utility functions (block parsing, EVM helpers)
- `tests.ts` - Test runner that validates all template outputs

## Key Patterns

### Adding/Modifying Chain Support

Each chain's token transfer logic is in `src/templates/token-transfers/{chain}.ts` and implements the `SubTemplate` interface with `match`, `transform`, and `tests`.

- `match(block)` uses `blockToVM(block)` from `src/utils/block-to-vm.ts` to detect the chain
- `transform(block)` returns `NetworkTransfer[]`
- `tests` include real block URLs and expected outputs - tests are inline, not in separate files

To register a new chain, add it to the `SUB_TEMPLATES` array in `src/templates/token-transfers/index.ts`. Universal templates (EVM, Cosmos) go in `UNIVERSAL_SUB_TEMPLATES`.

### VM Detection

`blockToVM()` in `src/utils/block-to-vm.ts` maps network names to VM types. EVM is the default fallback. Chain-specific VMs (CARDANO, UTXO, SVM, etc.) are explicitly mapped.

### Filtering

The main `tokenTransfers` template in `index.ts` applies post-processing filters:
- `walletAddress` - matches against `from` or `to`
- `contractAddress` - matches against `token`
- `transactionHash` - exact match
- Deduplication via composite key
- Zero-amount transfers are excluded

## CI/CD

- `.github/workflows/publish.yml` - On push to main: test, bump patch version, build, commit version back (via deploy key), publish to npm
- `.github/workflows/artifacts.yml` - On push: build and upload dist artifacts
- Version bumps use `[skip ci]` to avoid infinite loops

## Code Style

- Prettier: single quotes, 120 char width, es5 trailing commas
- ESLint with prettier plugin
- TypeScript targeting ES2020

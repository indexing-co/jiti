import type { EvmBlock } from './evm';

// A single TRC-10 (TransferAssetContract) transfer, recovered from Tron's native
// HTTP API (`wallet/getblockbynum`) by the oscar ingestion layer and attached to
// the eth-compat block as `_trc10`. TRC-10 is a native Tron token type with no EVM
// analog: the eth-compat JSON-RPC maps only its amount into `tx.value` and drops
// the asset id, so it cannot be recovered from the EVM block alone. `from`/`to` are
// EVM-form (0x + 20 bytes, lowercase) to match the eth-compat tx addresses.
export interface TronTrc10Transfer {
  // Tron transaction id, 0x-prefixed to match the eth-compat tx `hash` (and hence
  // the emitted `NetworkTransfer.transactionHash`).
  hash: string;
  // Decoded TRC-10 asset id (e.g. "1005168"). Becomes `NetworkTransfer.token`.
  token: string;
  amount: string;
  from: string;
  to: string;
}

// TRON reuses the eth-compat EVM block shape (it is ingested via the EVM pacemaker),
// plus the `_trc10` supplement the ingestion layer attaches for the asset types the
// eth-compat view can't represent.
export interface TronBlock extends EvmBlock {
  _trc10?: TronTrc10Transfer[];
}

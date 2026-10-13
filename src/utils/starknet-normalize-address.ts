/**
 * Canonical form of a Starknet address (or any felt): lowercase, `0x`, zero-padded to 64 hex digits.
 *
 * RPC nodes return felts with leading zeros stripped (`0x4718f5…`), while wallets, explorers and
 * starknet.js print the padded form (`0x04718f5…`). Both name the same address, so anything that
 * compares Starknet addresses as strings has to agree on one form first. Returns the input unchanged
 * if it is not a hex felt.
 */
export function starknetNormalizeAddress(value: string): string;
export function starknetNormalizeAddress(value: string | null | undefined): string | null | undefined;
export function starknetNormalizeAddress(value: string | null | undefined): string | null | undefined {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    return value;
  }
  return '0x' + value.slice(2).toLowerCase().padStart(64, '0');
}

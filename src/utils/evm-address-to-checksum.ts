import { keccak256 } from 'viem';

export function evmAddresstoChecksum(address: string) {
  if (!address || !/^(0x)?[0-9a-f]{40}$/i.test(address)) {
    throw new Error(`Invalid address: "${address}"`);
  }

  const stripAddress = address.slice(2).toLowerCase();
  const keccakHash = keccak256(stripAddress as `0x${string}`);
  let checksumAddress = '0x';

  for (let i = 0; i < stripAddress.length; i++) {
    checksumAddress += parseInt(keccakHash[i], 16) >= 8 ? stripAddress[i].toUpperCase() : stripAddress[i];
  }

  return checksumAddress;
}

import { keccak256 } from 'viem';

export function evmMethodSignatureToHex(sig: string): string {
  const [method, rest] = sig.split('(');
  const params = rest
    .split(')')[0]
    .split(',')
    .map((p) => p.trim());
  const topic0 = keccak256(
    `${method.split(' ').pop()}(${params.map((p) => p.split(' ')[0]).join(',')})` as `0x${string}`
  );
  return topic0;
}

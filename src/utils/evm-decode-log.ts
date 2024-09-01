import { decodeEventLog } from 'viem';

import { evmMethodSignatureToHex } from './evm-method-signature-to-hex';

type BasicLog = Record<string, unknown> & { address: string; topics: string[] };
type SignaturesToDecode = string | { addresses?: string[]; signature: string; topic0?: string };

export function evmDecodeLog(
  log: BasicLog,
  signatures: SignaturesToDecode | SignaturesToDecode[]
): Record<string, unknown> {
  if (Array.isArray(signatures)) {
    for (const sig of signatures) {
      const decoded = evmDecodeLog(log, sig);
      if (decoded) {
        return decoded;
      }
    }

    return null;
  }

  if (typeof signatures !== 'string' && Array.isArray(signatures.addresses) && signatures.addresses.length) {
    const addresses = signatures.addresses.map((a) => a?.toLowerCase());
    if (!addresses.includes(log.address.toLowerCase())) {
      return null;
    }
  }

  const sig = typeof signatures === 'string' ? signatures : signatures.signature;
  if ((sig.match(/ indexed /g)?.length || 0) === log.topics.length - 1) {
    const [, rest] = sig.split('(');
    const params = rest
      .split(')')[0]
      .split(',')
      .map((p) => p.trim());
    const topic0 =
      typeof signatures !== 'string' && signatures.topic0 ? signatures.topic0 : evmMethodSignatureToHex(sig);

    if (log.topics[0] === topic0) {
      const keys = [];

      const abi = params.map((p) => {
        const parts = p.split(' ');
        const type = parts[0];
        const name = parts[parts.length - 1];
        keys.push(name);
        const indexed = parts.includes('indexed');

        return {
          type,
          internalType: type,
          name,
          indexed,
        };
      });

      try {
        const decoded = decodeEventLog({ abi, data: log.data as `0x${string}`, topics: log.topics as [] });

        for (const key in decoded) {
          if (!keys.includes(key)) {
            delete decoded[key];
          }
        }
        return decoded;
      } catch (e) {
        // ignore this
      }
    }
  }

  return null;
}

export function evmDecodeLogWithMetadata(
  log: BasicLog,
  signatures: SignaturesToDecode | SignaturesToDecode[]
): { decoded: Record<string, unknown>; metadata: { name: string } } {
  for (const sig of [signatures].flat()) {
    const decoded = evmDecodeLog(log, sig);
    if (decoded) {
      return {
        decoded,
        metadata: {
          name: (typeof sig === 'string' ? sig : sig.signature).split('(')[0],
        },
      };
    }
  }

  return null;
}

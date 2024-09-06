import { decodeEventLog, parseAbi } from 'viem';

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

  let sig = (typeof signatures === 'string' ? signatures : signatures.signature).trim();
  if (!sig.startsWith('event ')) {
    sig = 'event ' + sig;
  }
  const topic0 = typeof signatures !== 'string' && signatures.topic0 ? signatures.topic0 : evmMethodSignatureToHex(sig);
  if ((sig.match(/ indexed /g)?.length || 0) === log.topics.length - 1) {
    if (log.topics[0] === topic0) {
      try {
        const result = decodeEventLog({
          abi: parseAbi([sig]),
          data: log.data as `0x${string}`,
          topics: log.topics as [],
        });
        return result.args as unknown as Record<string, unknown>;
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

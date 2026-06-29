import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { RippleLedger } from '../../types/beats/ripple';

// XRPL issued-currency codes are either a 3-char ISO-style code ("USD", "MAG") or a 160-bit
// (40 hex char) value. Standard hex codes encode the ASCII symbol in the leading bytes (e.g.
// "42495478…" -> "BITx"); non-standard codes (LP tokens, demurrage) aren't printable ASCII, so
// we keep the raw hex for those.
function decodeXrplCurrency(currency: string | undefined): string {
  if (!currency) return 'UNKNOWN';
  if (!/^[0-9A-Fa-f]{40}$/.test(currency)) {
    return currency;
  }
  let decoded = '';
  for (let i = 0; i < currency.length; i += 2) {
    const code = parseInt(currency.slice(i, i + 2), 16);
    if (code === 0) continue; // strip NUL padding
    decoded += String.fromCharCode(code);
  }
  // only use the decoded form if it's entirely printable ASCII; otherwise the hex is the identity
  return decoded && /^[\x20-\x7e]+$/.test(decoded) ? decoded : currency.toUpperCase();
}

// XRPL issued-currency amounts are arbitrary-precision decimal strings (up to 15 significant
// digits, wide exponent range) with no fixed on-chain integer unit. Parse them losslessly into a
// (mantissa, decimals) pair using string/BigInt math — NEVER parseFloat, which silently rounds
// (the old `round(value * 1e6)` reported 0.00026764546195073 BITX as "268"). Handles plain and
// scientific-notation values; trailing fractional zeros are trimmed so the scale is minimal.
function xrplIssuedValueToAmount(raw: string | undefined): { amount: bigint; decimals: number } {
  let s = (raw ?? '0').trim();
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  let exponent = 0;
  const eIndex = s.search(/[eE]/);
  if (eIndex !== -1) {
    exponent = parseInt(s.slice(eIndex + 1), 10) || 0;
    s = s.slice(0, eIndex);
  }

  const [intPart = '', fracPart = ''] = s.split('.');
  let digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
  let decimals = fracPart.length - exponent;

  if (decimals < 0) {
    // value scales up past the integer point — append zeros and clamp to 0 decimals
    digits += '0'.repeat(-decimals);
    decimals = 0;
  }

  let amount = BigInt(digits || '0');
  // trim trailing fractional zeros so e.g. "10.00" -> { amount: 10n, decimals: 0 }
  while (decimals > 0 && amount % 10n === 0n) {
    amount /= 10n;
    decimals -= 1;
  }

  return { amount: negative ? -amount : amount, decimals };
}

export const RippleTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'RIPPLE',

  transform(block) {
    let transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as RippleLedger;

    if (!Array.isArray(typedBlock.transactions)) {
      return [];
    }

    for (const typedTx of typedBlock.transactions || []) {
      if (typedTx.TransactionType !== 'Payment') {
        continue;
      }
      // Failed XRPL payments still burn Fee. Emit a fee-only transfer (to: null) so
      // callers account for the gas, and skip the payment amount that never landed.
      if (typedTx.metaData?.TransactionResult && typedTx.metaData.TransactionResult !== 'tesSUCCESS') {
        transfers.push({
          amount: BigInt(typedTx.Fee ?? '0'),
          blockNumber: parseInt(typedBlock.ledger_index, 10),
          from: typedTx.Account ?? 'UNKNOWN',
          memo: typedTx.DestinationTag,
          timestamp: typedBlock.close_time_iso || null,
          to: null,
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: BigInt(typedTx.Fee ?? '0'),
          transactionHash: typedTx.hash ?? '',
        });
        continue;
      }
      const deliveredOrAmount = (typedTx.metaData?.delivered_amount ?? typedTx.Amount ?? '0') as
        | string
        | { currency: string; issuer: string; value: string };
      let tokenSymbol = 'XRP';
      let tokenType: 'NATIVE' | 'TOKEN' | 'NFT' = 'NATIVE';
      // An issued currency is uniquely identified by (currency, issuer) — two "USD"
      // IOUs from different issuers are distinct tokens. Emit the token id as
      // `<currency>.<issuer>` so consumers can match by issuer; native XRP has no
      // issuer and keeps the bare "XRP" symbol.
      let issuer: string | undefined;

      let parsedAmount: bigint;
      // Only issued currencies carry an explicit scale; native XRP stays in integer drops.
      let decimals: number | undefined;

      if (typeof deliveredOrAmount === 'object') {
        tokenSymbol = decodeXrplCurrency(deliveredOrAmount.currency);
        issuer = deliveredOrAmount.issuer;
        tokenType = 'TOKEN';
        const scaled = xrplIssuedValueToAmount(deliveredOrAmount.value);
        parsedAmount = scaled.amount;
        decimals = scaled.decimals;
      } else {
        parsedAmount = BigInt(String(deliveredOrAmount));
      }
      transfers.push({
        amount: parsedAmount,
        ...(decimals !== undefined ? { decimals } : {}),
        blockNumber: parseInt(typedBlock.ledger_index, 10),
        from: typedTx.Account ?? 'UNKNOWN',
        memo: typedTx.DestinationTag,
        timestamp: typedBlock.close_time_iso || null,
        to: typedTx.Destination ?? 'UNKNOWN',
        token: issuer ? `${tokenSymbol}.${issuer}` : tokenSymbol,
        tokenType: tokenType,
        transactionGasFee: BigInt(typedTx.Fee ?? '0'),
        transactionHash: typedTx.hash ?? '',
      });
    }

    return transfers;
  },

  tests: [
    {
      params: {
        network: 'RIPPLE',
        walletAddress: 'rnDGxzUM2snx58Bvyn72xhJKqvkDxo2tQm',
        contractAddress: '',
      },
      payload: 'https://jiti.indexing.co/networks/ripple/88104659',
      output: [
        {
          amount: 43110000n,
          blockNumber: 88104659,
          from: 'rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G',
          memo: 30195674,
          timestamp: '2024-05-19T22:18:52Z',
          to: 'rnDGxzUM2snx58Bvyn72xhJKqvkDxo2tQm',
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 10000n,
          transactionHash: 'B32A6A5455777283212407FBD8CCA701505C654E5F4ADFFBE9D4D22F00889D87',
        },
      ],
    },
    // Failed XRPL payments emit ONLY a fee transfer (to: null) — the payment Amount
    // never reached the Destination, but the Fee was still burned.
    {
      params: { network: 'RIPPLE' },
      payload: {
        _network: 'RIPPLE',
        ledger_index: '100000000',
        close_time_iso: '2026-04-04T08:02:44Z',
        transactions: [
          {
            TransactionType: 'Payment',
            Account: 'rFAILFROMxxxxxxxxxxxxxxxxxxxxxxxxx',
            Destination: 'rFAILTOxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Amount: '1000000',
            Fee: '10',
            hash: 'FAILEDXRPLTXHASH',
            metaData: { TransactionResult: 'tecPATH_DRY' },
          },
        ],
      },
      output: [
        {
          amount: 10n,
          blockNumber: 100000000,
          from: 'rFAILFROMxxxxxxxxxxxxxxxxxxxxxxxxx',
          memo: undefined,
          timestamp: '2026-04-04T08:02:44Z',
          to: null,
          token: 'XRP',
          tokenType: 'NATIVE',
          transactionGasFee: 10n,
          transactionHash: 'FAILEDXRPLTXHASH',
        },
      ],
    },
    // Issued-currency (IOU) amount: arbitrary-precision decimal, NOT XRP drops. This is the
    // regression case — the old `round(value * 1e6)` reported 0.00026764546195073 BITX as "268".
    // Now it's the exact mantissa + decimals, and the 40-hex currency decodes to its ASCII symbol.
    {
      params: { network: 'RIPPLE' },
      payload: {
        _network: 'RIPPLE',
        ledger_index: '105011630',
        close_time_iso: '2026-01-01T00:00:00Z',
        transactions: [
          {
            TransactionType: 'Payment',
            Account: 'rBITXFROMxxxxxxxxxxxxxxxxxxxxxxxxx',
            Destination: 'rBITXTOxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Amount: {
              currency: '4249547800000000000000000000000000000000',
              issuer: 'rBitcoiNXev8VoVxV7pwoQx1sSfonVP9i3',
              value: '0.00026764546195073',
            },
            Fee: '12',
            hash: 'BITXSMALLHASH',
            metaData: { TransactionResult: 'tesSUCCESS' },
          },
        ],
      },
      output: [
        {
          amount: 26764546195073n,
          decimals: 17,
          blockNumber: 105011630,
          from: 'rBITXFROMxxxxxxxxxxxxxxxxxxxxxxxxx',
          memo: undefined,
          timestamp: '2026-01-01T00:00:00Z',
          to: 'rBITXTOxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          token: 'BITx.rBitcoiNXev8VoVxV7pwoQx1sSfonVP9i3',
          tokenType: 'TOKEN',
          transactionGasFee: 12n,
          transactionHash: 'BITXSMALLHASH',
        },
      ],
    },
    // Large whole IOU value (no fractional digits) and a plain 3-char currency code.
    {
      params: { network: 'RIPPLE' },
      payload: {
        _network: 'RIPPLE',
        ledger_index: '105011630',
        close_time_iso: '2026-01-01T00:00:00Z',
        transactions: [
          {
            TransactionType: 'Payment',
            Account: 'rUSDFROMxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Destination: 'rUSDTOxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Amount: { currency: 'USD', issuer: 'rIssuerxxxxxxxxxxxxxxxxxxxxxxxxxxx', value: '1000000000000000' },
            Fee: '15',
            hash: 'USDWHOLEHASH',
            metaData: { TransactionResult: 'tesSUCCESS' },
          },
        ],
      },
      output: [
        {
          amount: 1000000000000000n,
          decimals: 0,
          blockNumber: 105011630,
          from: 'rUSDFROMxxxxxxxxxxxxxxxxxxxxxxxxxx',
          memo: undefined,
          timestamp: '2026-01-01T00:00:00Z',
          to: 'rUSDTOxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          token: 'USD.rIssuerxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          tokenType: 'TOKEN',
          transactionGasFee: 15n,
          transactionHash: 'USDWHOLEHASH',
        },
      ],
    },
    // Scientific-notation IOU value parses exactly (1.5e-10 -> 15 * 10^-11).
    {
      params: { network: 'RIPPLE' },
      payload: {
        _network: 'RIPPLE',
        ledger_index: '105011630',
        close_time_iso: '2026-01-01T00:00:00Z',
        transactions: [
          {
            TransactionType: 'Payment',
            Account: 'rMAGFROMxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Destination: 'rMAGTOxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            Amount: { currency: 'MAG', issuer: 'rXmagwMmnFtVet3uL26Q2iwk287SRvVMJ', value: '1.5e-10' },
            Fee: '10',
            hash: 'MAGSCIHASH',
            metaData: { TransactionResult: 'tesSUCCESS' },
          },
        ],
      },
      output: [
        {
          amount: 15n,
          decimals: 11,
          blockNumber: 105011630,
          from: 'rMAGFROMxxxxxxxxxxxxxxxxxxxxxxxxxx',
          memo: undefined,
          timestamp: '2026-01-01T00:00:00Z',
          to: 'rMAGTOxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          token: 'MAG.rXmagwMmnFtVet3uL26Q2iwk287SRvVMJ',
          tokenType: 'TOKEN',
          transactionGasFee: 10n,
          transactionHash: 'MAGSCIHASH',
        },
      ],
    },
  ],
};

import { SubTemplate } from '../../types';
import { blockToVM } from '../../utils/block-to-vm';
import { NetworkTransfer } from './types';
import type { StellarLedger } from '../../types/beats/stellar';

type StellarEffect = {
  type: string;
  account?: string;
  contract?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  asset?: string;
};

// Stellar amounts are stringified decimals with 7 fractional digits ("12.3456789"),
// but jiti expresses everything in stroops (smallest unit). Stripping the dot is
// equivalent to multiplying by 10^7.
const toStroops = (s: string) => BigInt(s.replace('.', ''));

const effectAsset = (e: StellarEffect): { token: string | null; tokenType: 'NATIVE' | 'TOKEN' } => {
  if (e.asset_type === 'native') return { token: null, tokenType: 'NATIVE' };
  if (e.asset_issuer) return { token: e.asset_issuer, tokenType: 'TOKEN' };
  // contract_* effects expose `asset` as a single string ("CODE:ISSUER" or "native").
  if (e.asset && e.asset !== 'native') {
    const [, issuer] = e.asset.split(':');
    return { token: issuer ?? e.asset, tokenType: 'TOKEN' };
  }
  return { token: null, tokenType: 'NATIVE' };
};

const sameAsset = (a: StellarEffect, b: StellarEffect) =>
  a.asset_type === b.asset_type &&
  a.asset_code === b.asset_code &&
  a.asset_issuer === b.asset_issuer &&
  a.asset === b.asset;

// Pair account_debited/account_credited effects within a single op into transfers.
// Used for ops where amount/asset isn't reliably on the op body (offer fills,
// account_merge, claim_claimable_balance, liquidity_pool_*, invoke_host_function).
// Unpaired sides become one-sided transfers (e.g. claim_claimable_balance has no
// debit because the source is a protocol-managed escrow).
function effectsToTransfers(
  typedTx: StellarLedger['transactions'][number],
  op: StellarLedger['transactions'][number]['operations'][number] & { effects?: StellarEffect[] },
  typedBlock: StellarLedger
): NetworkTransfer[] {
  const transfers: NetworkTransfer[] = [];
  const effects = (op.effects || []).filter((e) => typeof e.amount === 'string');
  const debits = effects.filter((e) => e.type === 'account_debited' || e.type === 'contract_debited');
  const credits = effects.filter((e) => e.type === 'account_credited' || e.type === 'contract_credited');

  const baseFields = {
    blockNumber: typedBlock.sequence,
    memo: typedTx.memo,
    timestamp: typedTx.created_at,
    transactionGasFee: BigInt(typedTx.fee_charged),
    transactionHash: typedTx.hash,
  };

  const usedCredit = new Set<number>();
  for (const d of debits) {
    if (!d.amount) continue;
    const idx = credits.findIndex((c, i) => !usedCredit.has(i) && sameAsset(d, c) && c.amount === d.amount);
    const { token, tokenType } = effectAsset(d);
    if (idx !== -1) {
      const c = credits[idx];
      usedCredit.add(idx);
      transfers.push({
        ...baseFields,
        amount: toStroops(d.amount),
        from: d.account || d.contract || null,
        to: c.account || c.contract || null,
        token,
        tokenType,
      });
    } else {
      transfers.push({
        ...baseFields,
        amount: toStroops(d.amount),
        from: d.account || d.contract || null,
        to: null,
        token,
        tokenType,
      });
    }
  }

  for (let i = 0; i < credits.length; i++) {
    if (usedCredit.has(i)) continue;
    const c = credits[i];
    if (!c.amount) continue;
    const { token, tokenType } = effectAsset(c);
    transfers.push({
      ...baseFields,
      amount: toStroops(c.amount),
      from: null,
      to: c.account || c.contract || null,
      token,
      tokenType,
    });
  }

  return transfers;
}

export const StellarTokenTransfers: SubTemplate = {
  match: (block) => blockToVM(block) === 'STELLAR',

  transform(block) {
    const transfers: NetworkTransfer[] = [];
    const typedBlock = block as unknown as StellarLedger;

    for (const typedTx of typedBlock.transactions || []) {
      // Failed txs still burn fee_charged — emit a fee transfer (to: null) so callers
      // can account for the gas, but skip the ops that never actually moved funds.
      if (!typedTx.successful) {
        transfers.push({
          amount: BigInt(typedTx.fee_charged),
          blockNumber: typedBlock.sequence,
          from: typedTx.source_account,
          memo: typedTx.memo,
          timestamp: typedTx.created_at,
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: BigInt(typedTx.fee_charged),
          transactionHash: typedTx.hash,
        });
        continue;
      }

      for (const op of typedTx.operations) {
        const baseFields = {
          blockNumber: typedBlock.sequence,
          memo: typedTx.memo,
          timestamp: typedTx.created_at,
          transactionGasFee: BigInt(typedTx.fee_charged),
          transactionHash: typedTx.hash,
        };

        if (op.type === 'payment') {
          transfers.push({
            ...baseFields,
            amount: toStroops(op.amount),
            from: op.from,
            to: op.to,
            token: op.asset_type === 'native' ? null : op.asset_issuer,
            tokenType: op.asset_type === 'native' ? 'NATIVE' : 'TOKEN',
          });
        } else if (op.type === 'create_account') {
          // create_account funds a new account with native XLM via starting_balance —
          // economically a native payment from funder → account, but a different op
          // type because it also creates the destination ledger entry.
          transfers.push({
            ...baseFields,
            amount: toStroops(op.starting_balance),
            from: op.funder,
            to: op.account,
            token: null,
            tokenType: 'NATIVE',
          });
        } else if (op.type === 'path_payment_strict_send' || op.type === 'path_payment_strict_receive') {
          // Path payments swap source_asset → asset along a DEX path. Both legs are
          // emitted as separate transfers (different assets, different amounts) so the
          // sender debit and receiver credit are both visible from op fields alone.
          transfers.push({
            ...baseFields,
            amount: toStroops(op.source_amount),
            from: op.from,
            to: op.to,
            token: op.source_asset_type === 'native' ? null : op.source_asset_issuer,
            tokenType: op.source_asset_type === 'native' ? 'NATIVE' : 'TOKEN',
          });
          transfers.push({
            ...baseFields,
            amount: toStroops(op.amount),
            from: op.from,
            to: op.to,
            token: op.asset_type === 'native' ? null : op.asset_issuer,
            tokenType: op.asset_type === 'native' ? 'NATIVE' : 'TOKEN',
          });
        } else {
          // Everything else — manage_*_offer fills, account_merge, claim_claimable_balance,
          // liquidity_pool_*, invoke_host_function (Soroban) — surfaces fund movements
          // only via Horizon effects. Requires oscar to attach `op.effects` (#38).
          transfers.push(...effectsToTransfers(typedTx, op, typedBlock));
        }
      }
    }

    return transfers;
  },

  tests: [
    // Single-op token payment: source wallet → dest wallet, USDC asset.
    {
      params: {
        network: 'STELLAR',
        transactionHash: 'e08e8dd92bde178c554146475cafdf00cef8a8874541b1bb568760b5bd33c6e6',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/62312535',
      output: [
        {
          amount: 100000000n,
          blockNumber: 62312535,
          from: 'GAUA7XL5K54CC2DDGP77FJ2YBHRJLT36CPZDXWPM6MP7MANOGG77PNJU',
          memo: undefined,
          timestamp: '2026-04-27T16:14:30Z',
          to: 'GBTPFDSY7NFLFXAXXU725NUB2CXYM57RXG4ATYWBTK7RB57DFFNIU7RH',
          token: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          tokenType: 'TOKEN',
          transactionGasFee: 200n,
          transactionHash: 'e08e8dd92bde178c554146475cafdf00cef8a8874541b1bb568760b5bd33c6e6',
        },
      ],
    },
    // path_payment_strict_send swaps source_asset → asset along a DEX path. Both legs
    // are emitted as separate transfers so the sender debit and receiver credit are
    // visible. Self-swap here (source==dest) but logic handles distinct accounts the
    // same way.
    {
      params: {
        network: 'STELLAR',
        transactionHash: 'f036756ae1cbf61d8e43af39b24b991b59c3684fc030de42f5d8fc2c96a672eb',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/62312422',
      output: [
        {
          amount: 1000000n,
          blockNumber: 62312422,
          from: 'GCY7AY7OOO2XKZUCKLOZL3MJ62DW5UNL3ISFWDEDEEJM7JFGYZEUS55Z',
          memo: undefined,
          timestamp: '2026-04-27T16:03:47Z',
          to: 'GCY7AY7OOO2XKZUCKLOZL3MJ62DW5UNL3ISFWDEDEEJM7JFGYZEUS55Z',
          token: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
          tokenType: 'TOKEN',
          transactionGasFee: 200n,
          transactionHash: 'f036756ae1cbf61d8e43af39b24b991b59c3684fc030de42f5d8fc2c96a672eb',
        },
        {
          amount: 1000179n,
          blockNumber: 62312422,
          from: 'GCY7AY7OOO2XKZUCKLOZL3MJ62DW5UNL3ISFWDEDEEJM7JFGYZEUS55Z',
          memo: undefined,
          timestamp: '2026-04-27T16:03:47Z',
          to: 'GCY7AY7OOO2XKZUCKLOZL3MJ62DW5UNL3ISFWDEDEEJM7JFGYZEUS55Z',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 200n,
          transactionHash: 'f036756ae1cbf61d8e43af39b24b991b59c3684fc030de42f5d8fc2c96a672eb',
        },
      ],
    },
    // create_account funds a new account with native XLM — emit it as a NATIVE
    // transfer (funder → account) using starting_balance.
    {
      params: {
        network: 'STELLAR',
        transactionHash: 'a11add92603c4cab2396804f26acfe6fb9b0f938dc7dfa9f2ed017eb75ca039a',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/62080113',
      output: [
        {
          amount: 344880700n,
          blockNumber: 62080113,
          from: 'GDF4UGQSY6VHWN7T4XJEZ6WYJEREMZYLNYZ5CCKYVS3V3MNYIBMTB354',
          memo: undefined,
          timestamp: '2026-04-12T04:27:18Z',
          to: 'GBJO6JIIPD4JEKDTKY4CKOSQZU3ETIKVWAWU56A46W72G377BGG4PS44',
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 100n,
          transactionHash: 'a11add92603c4cab2396804f26acfe6fb9b0f938dc7dfa9f2ed017eb75ca039a',
        },
      ],
    },
    // Failed Stellar txs emit ONLY a fee transfer (to: null), never the failed payment
    // operations. Ledger 61961851 / tx 9024ba4b... is the Mesh incident — the source
    // tried to send 1_000_000_000 stroops to GAGLH6..., the tx reverted, and the only
    // on-chain effect was the 100-stroop fee being charged.
    {
      params: {
        network: 'STELLAR',
        transactionHash: '9024ba4b558b09042cb02afd1d46eea72597891691801375acee332273c5c26d',
      },
      payload: 'https://jiti.indexing.co/networks/stellar/61961851',
      output: [
        {
          amount: 100n,
          blockNumber: 61961851,
          from: 'GCP7I54JXTOZ4SJG4UARWJOMJ25JQXRHSHXQWDSV4TRVRJFDG67VUEXP',
          memo: undefined,
          timestamp: '2026-04-04T08:02:44Z',
          to: null,
          token: null,
          tokenType: 'NATIVE',
          transactionGasFee: 100n,
          transactionHash: '9024ba4b558b09042cb02afd1d46eea72597891691801375acee332273c5c26d',
        },
      ],
    },
  ],
};

/**
 * Generates TypeScript type definitions for each VM's beat (block) shape
 * by fetching real samples from the JITI API and inferring types from them.
 *
 * Usage: npx ts-node scripts/generate-block-types.ts
 * Requires: API_KEY in .env
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'https://jiti.indexing.co';
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('API_KEY is required in .env');
  process.exit(1);
}

const SAMPLES_DIR = path.resolve(__dirname, '../tmp/samples');
const OUTPUT_DIR = path.resolve(__dirname, '../src/types/beats');

// Networks to sample per VM
const VM_NETWORKS: Record<string, string[]> = {
  APTOS: ['aptos', 'movement-bardock'],
  CARDANO: ['cardano'],
  COSMOS: ['cosmos'],
  EVM: ['ethereum', 'base', 'polygon', 'arbitrum'],
  FILECOIN: ['filecoin'],
  RIPPLE: ['ripple'],
  STARKNET: ['starknet'],
  STELLAR: ['stellar'],
  SUBSTRATE: ['bittensor', 'polkadot'],
  SUI: ['sui'],
  SVM: ['solana', 'eclipse'],
  TON: ['ton'],
  UTXO: ['bitcoin', 'dogecoin', 'zcash'],
};

// Top-level type names per VM (conventional names)
const VM_TOP_TYPE: Record<string, string> = {
  APTOS: 'AptosBlock',
  CARDANO: 'CardanoBlock',
  COSMOS: 'CosmosBlock',
  EVM: 'EvmBlock',
  FILECOIN: 'FilecoinBlock',
  RIPPLE: 'RippleLedger',
  STARKNET: 'StarknetBlock',
  STELLAR: 'StellarLedger',
  SUBSTRATE: 'SubstrateBlock',
  SUI: 'SuiCheckpoint',
  SVM: 'SvmBlock',
  TON: 'TonBlock',
  UTXO: 'UtxoBlock',
};

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) {
    throw new Error(`${res.status} fetching ${url}`);
  }
  return res.json();
}

// Minimum number of block samples to fetch per network
const MIN_SAMPLES_PER_NETWORK = 3;
// How far back from latest to space samples (as a fraction of latest beat)
const SAMPLE_OFFSETS = [0, 100, 1000];

async function getLatestBeat(network: string): Promise<number> {
  const status = await fetchJSON(`${API_BASE}/status/${network}`);
  return status.lastBeat;
}

async function fetchBlock(network: string, beat: number): Promise<any> {
  return fetchJSON(`${API_BASE}/networks/${network}/${beat}`);
}

function getSampleBeats(latestBeat: number): number[] {
  const beats = SAMPLE_OFFSETS.map((offset) => Math.max(1, latestBeat - offset));
  // Deduplicate (in case latestBeat is very small)
  return [...new Set(beats)];
}

// ─── Type Inference Engine ───────────────────────────────────────────────

type InferredType =
  | { kind: 'primitive'; types: Set<string> }
  | { kind: 'array'; element: InferredType | null }
  | { kind: 'object'; fields: Map<string, { type: InferredType; count: number }> };

function classifyPrimitive(value: unknown): string {
  if (value === null) return 'null';
  return typeof value; // string, number, boolean
}

function inferType(value: unknown): InferredType {
  if (value === null || value === undefined) {
    return { kind: 'primitive', types: new Set(['null']) };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'array', element: null };
    }
    let merged: InferredType | null = null;
    for (const item of value) {
      const itemType = inferType(item);
      merged = merged ? mergeTypes(merged, itemType) : itemType;
    }
    return { kind: 'array', element: merged };
  }
  if (typeof value === 'object') {
    const fields = new Map<string, { type: InferredType; count: number }>();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields.set(k, { type: inferType(v), count: 1 });
    }
    return { kind: 'object', fields };
  }
  return { kind: 'primitive', types: new Set([classifyPrimitive(value)]) };
}

function mergeTypes(a: InferredType, b: InferredType): InferredType {
  if (a.kind === 'primitive' && b.kind === 'primitive') {
    return { kind: 'primitive', types: new Set([...a.types, ...b.types]) };
  }
  if (a.kind === 'array' && b.kind === 'array') {
    if (!a.element && !b.element) return { kind: 'array', element: null };
    if (!a.element) return { kind: 'array', element: b.element };
    if (!b.element) return { kind: 'array', element: a.element };
    return { kind: 'array', element: mergeTypes(a.element, b.element) };
  }
  if (a.kind === 'object' && b.kind === 'object') {
    const merged = new Map<string, { type: InferredType; count: number }>();
    for (const [key, val] of a.fields) {
      merged.set(key, { type: val.type, count: val.count });
    }
    for (const [key, val] of b.fields) {
      const existing = merged.get(key);
      if (existing) {
        merged.set(key, {
          type: mergeTypes(existing.type, val.type),
          count: existing.count + val.count,
        });
      } else {
        merged.set(key, { type: val.type, count: val.count });
      }
    }
    return { kind: 'object', fields: merged };
  }
  // Mixed kinds — collapse to union of primitives
  const primitives = new Set<string>();
  collectPrimitives(a, primitives);
  collectPrimitives(b, primitives);
  if (primitives.size === 0) primitives.add('unknown');
  return { kind: 'primitive', types: primitives };
}

function collectPrimitives(t: InferredType, out: Set<string>): void {
  if (t.kind === 'primitive') {
    for (const p of t.types) out.add(p);
  } else if (t.kind === 'array') {
    out.add('unknown[]');
  } else {
    out.add('Record<string, unknown>');
  }
}

function mergeSamples(samples: unknown[]): InferredType {
  let merged: InferredType | null = null;
  for (const sample of samples) {
    const t = inferType(sample);
    merged = merged ? mergeTypes(merged, t) : t;
  }
  // Update counts to reflect total samples
  if (merged?.kind === 'object') {
    updateCounts(merged, samples.length);
  }
  return merged || { kind: 'primitive', types: new Set(['unknown']) };
}

function updateCounts(obj: InferredType, totalSamples: number): void {
  // For the top-level object, we need to check which fields appear in all samples
  // The count was incremented per merge, so a field present in all samples has count === totalSamples
  // We leave counts as-is since they track appearances
}

// ─── Code Generation ─────────────────────────────────────────────────────

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s.\/]+/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('');
}

interface NamedInterface {
  name: string;
  fields: { key: string; type: string; optional: boolean }[];
}

function generateInterfaces(
  rootType: InferredType,
  rootName: string,
  totalSamples: number
): NamedInterface[] {
  const interfaces: NamedInterface[] = [];
  const seenNames = new Set<string>();

  function uniqueName(base: string): string {
    let name = base;
    let i = 2;
    while (seenNames.has(name)) {
      name = `${base}${i++}`;
    }
    seenNames.add(name);
    return name;
  }

  function typeToString(t: InferredType, parentName: string, fieldName: string, depth: number, fieldCount?: number): string {
    if (t.kind === 'primitive') {
      const types = Array.from(t.types).sort();
      return types.map((p) => (p === 'undefined' ? 'undefined' : p)).join(' | ') || 'unknown';
    }
    if (t.kind === 'array') {
      if (!t.element) return 'unknown[]';
      const elType = typeToString(t.element, parentName, fieldName, depth + 1);
      // Wrap union types in parens for array
      if (elType.includes(' | ')) return `(${elType})[]`;
      return `${elType}[]`;
    }
    if (t.kind === 'object') {
      // Extract as named interface if depth > 1
      if (depth > 1 || fieldName !== '') {
        const baseName = parentName + toPascalCase(fieldName);
        const name = uniqueName(baseName);
        emitInterface(t, name, depth, fieldCount);
        return name;
      }
      // Should not reach here for root — root is handled directly
      return 'Record<string, unknown>';
    }
    return 'unknown';
  }

  function emitInterface(t: InferredType, name: string, depth: number, parentFieldCount?: number): void {
    if (t.kind !== 'object') return;
    const fields: NamedInterface['fields'] = [];
    for (const [key, val] of t.fields) {
      const optional = parentFieldCount ? val.count < parentFieldCount : val.count < totalSamples;
      const tsType = typeToString(val.type, name, key, depth + 1, val.count);
      fields.push({ key, type: tsType, optional });
    }
    interfaces.push({ name, fields });
  }

  if (rootType.kind === 'object') {
    const name = uniqueName(rootName);
    emitInterface(rootType, name, 0);
  }

  return interfaces;
}

function renderInterfaces(interfaces: NamedInterface[]): string {
  const lines: string[] = [];
  // Reverse so that root is first, sub-interfaces follow
  for (const iface of interfaces) {
    lines.push(`export interface ${iface.name} {`);
    for (const field of iface.fields) {
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(field.key) ? field.key : `'${field.key}'`;
      lines.push(`  ${safeKey}${field.optional ? '?' : ''}: ${field.type};`);
    }
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const vmFiles: string[] = [];

  for (const [vm, networks] of Object.entries(VM_NETWORKS)) {
    console.log(`\n── ${vm} ──`);
    const samples: unknown[] = [];
    const sourceUrls: string[] = [];

    for (const network of networks) {
      try {
        console.log(`  Fetching latest beat for ${network}...`);
        const latestBeat = await getLatestBeat(network);
        const sampleBeats = getSampleBeats(latestBeat);

        for (const beat of sampleBeats) {
          try {
            console.log(`  Fetching block ${beat} from ${network}...`);
            const block = await fetchBlock(network, beat);

            // Save raw sample
            const samplePath = path.join(SAMPLES_DIR, `${vm.toLowerCase()}-${network}-${beat}.json`);
            fs.writeFileSync(samplePath, JSON.stringify(block, null, 2));

            samples.push(block);
            sourceUrls.push(`${API_BASE}/networks/${network}/${beat}`);
          } catch (err) {
            console.error(`  Error fetching ${network}/${beat}: ${(err as Error).message}`);
          }
        }
        console.log(`  ${network}: ${sampleBeats.length} samples fetched`);
      } catch (err) {
        console.error(`  Error fetching status for ${network}: ${(err as Error).message}`);
      }
    }

    if (samples.length === 0) {
      console.error(`  No samples fetched for ${vm}, skipping.`);
      continue;
    }

    // Merge and generate types
    const merged = mergeSamples(samples);
    const topTypeName = VM_TOP_TYPE[vm] || `${toPascalCase(vm)}Block`;
    const interfaces = generateInterfaces(merged, topTypeName, samples.length);
    const rendered = renderInterfaces(interfaces);

    const fileName = vm.toLowerCase() + '.ts';
    const header = [
      '// Auto-generated by scripts/generate-block-types.ts',
      `// Generated: ${new Date().toISOString().split('T')[0]}`,
      `// Sources:`,
      ...sourceUrls.map((u) => `//   ${u}`),
      `// Samples: ${samples.length}`,
      '',
    ].join('\n');

    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, header + rendered);
    console.log(`  Wrote ${filePath}`);
    vmFiles.push(vm.toLowerCase());
  }

  // Write barrel index
  const indexLines = [
    '// Auto-generated by scripts/generate-block-types.ts',
    '',
    ...vmFiles.map((f) => `export * from './${f}';`),
    '',
  ];
  const indexPath = path.join(OUTPUT_DIR, 'index.ts');
  fs.writeFileSync(indexPath, indexLines.join('\n'));
  console.log(`\nWrote barrel export: ${indexPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

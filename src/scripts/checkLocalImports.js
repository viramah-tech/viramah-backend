/*
 * Verify unresolved relative imports/requires in backend source and tests.
 * Usage: node src/scripts/checkLocalImports.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_DIRS = [path.join(ROOT, 'src'), path.join(ROOT, 'tests')];
const EXTS = ['.js', '.cjs', '.mjs', '.json'];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(js|cjs|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function parseSpecs(source) {
  const out = [];
  const re = /(?:import|export)\s+(?:[^'"`]*?from\s*)?['"`]([^'"`]+)['"`]|require\(\s*['"`]([^'"`]+)['"`]\s*\)|import\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const spec = match[1] || match[2] || match[3];
    if (spec) out.push(spec);
  }
  return out;
}

function hasExactCase(fullPath) {
  const normalized = path.resolve(fullPath);
  const parts = normalized.split(path.sep);

  let current = parts[0].endsWith(':') ? `${parts[0]}\\` : parts[0] || path.sep;
  const start = parts[0].endsWith(':') ? 1 : 1;

  for (let i = start; i < parts.length; i += 1) {
    const segment = parts[i];
    if (!segment) continue;
    const items = fs.existsSync(current) ? fs.readdirSync(current) : [];
    const exact = items.find((name) => name === segment);
    if (!exact) return false;
    current = path.join(current, exact);
  }

  return true;
}

function resolveRelative(spec, fromFile) {
  if (!spec.startsWith('.')) return { kind: 'external' };

  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];

  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    candidates.push(base);
  }

  for (const ext of EXTS) {
    candidates.push(base + ext);
  }

  for (const ext of EXTS) {
    candidates.push(path.join(base, `index${ext}`));
  }

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) return { kind: 'missing' };
  if (!hasExactCase(found)) return { kind: 'case-mismatch', resolved: found };
  return { kind: 'ok', resolved: found };
}

const files = [];
for (const dir of TARGET_DIRS) walk(dir, files);

const failures = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const specs = parseSpecs(source);

  for (const spec of specs) {
    const result = resolveRelative(spec, file);
    if (result.kind === 'ok' || result.kind === 'external') continue;

    failures.push({
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
      spec,
      reason: result.kind,
      resolved: result.resolved || null,
    });
  }
}

if (failures.length === 0) {
  console.log('OK: no unresolved or case-mismatched relative imports in backend src/tests.');
  process.exit(0);
}

console.error('Import integrity check failed:');
for (const failure of failures) {
  console.error(`- ${failure.file} -> ${failure.spec} (${failure.reason})`);
}
process.exit(1);

// Sync package.json "version" from the VERSION export in src/sluz.js.
// src/sluz.js is the single source of truth; this runs via the prebuild /
// prepublishOnly npm hooks. Flags: --check (exit 1 on mismatch, no write,
// for CI), --silent (suppress log output).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'src', 'sluz.js');
const pkgPath = path.join(root, 'package.json');

const checkOnly = process.argv.includes('--check');
const silent = process.argv.includes('--silent');

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const VERSION_RE = /export\s+const\s+VERSION\s*=\s*['"]([^'"]+)['"]/;

const src = fs.readFileSync(srcPath, 'utf8');
const m = src.match(VERSION_RE);
if (!m) {
  console.error(`sync-version: no VERSION export found in ${path.relative(root, srcPath)}`);
  process.exit(1);
}

const version = m[1];
if (!SEMVER_RE.test(version)) {
  console.error(`sync-version: "${version}" is not valid semver`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.version === version) {
  if (!silent) console.log(`sync-version: package.json in sync (${version})`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`sync-version: version mismatch — src/sluz.js ${version} != package.json ${pkg.version}`);
  process.exit(1);
}

const from = pkg.version;
pkg.version = version;
const tmp = pkgPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(pkg, null, 2) + '\n');
fs.renameSync(tmp, pkgPath);
if (!silent) console.log(`sync-version: package.json ${from} -> ${version}`);

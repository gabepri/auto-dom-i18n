#!/usr/bin/env node
/**
 * Bundle size budget.
 *
 * Every kilobyte here is download, parse and compile time on the low-end phones this
 * library is most likely to be janking.
 *
 * Measured on a MINIFIED copy of each bundle, not on the file as shipped. The published
 * ESM keeps its comments — they were ~8KB gzip, 38% of the old 22KB number — and every
 * consumer's bundler strips them before a browser sees a byte. Gating the shipped form
 * therefore priced documentation rather than code: it failed for paragraphs of rationale
 * this codebase wants written down, and the cheapest way to get green was to delete an
 * explanation. `dist` itself is untouched by this; only the measurement changed.
 *
 * `intl-messageformat` is deliberately external (see vite.config.ts), so it is NOT
 * counted here — consumers still pay for it separately. Making that dependency
 * pay-per-use is tracked work, not something this budget can see.
 *
 * When this fails, ship less code. Raise the limit only deliberately, with a reason.
 */
import { transformWithEsbuild } from 'vite';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Mirrors `build.target` in vite.config.ts — minifying to a different level would lie. */
const TARGET = 'es2020';

// A tripwire, not a target — no number here is derived from a device or a load-time goal,
// so what has to stay honest is the *gap*. Calibrated from this repo's own history:
//
//   an ordinary bug fix (dae491e + 4ac13de)   +93 bytes
//   a feature (externalTranslation)           +1.4KB
//   headroom at 13KB                          ~900 bytes
//
// Ten routine changes fit; one feature does not, and has to be argued for. Both failure
// modes are real: a gap that never fires is theatre, and one that fires on everything is
// what this had become — 57 bytes left, green only by deleting a comment.
//
// Lower it when the code shrinks. Record the actual below when you do, so drift shows up
// in the diff rather than only when CI goes red.
//
//   actual, 2026-07-31: 12,414 (ESM) / 12,463 (CJS) of 13,312 bytes
//
// NOT a tightening of the old 22KB ESM budget: that one counted comments and this one
// does not — the same code measures 21.9KB shipped, 12.1KB minified. The CJS number is
// unchanged (already compacted output), which is why both formats now sit at 13.
const BUDGETS = [
  { file: 'dist/auto-html-i18n.js', maxGzip: 13 * 1024 },
  { file: 'dist/auto-html-i18n.cjs', maxGzip: 13 * 1024 },
];

let failed = false;

for (const { file, maxGzip } of BUDGETS) {
  const path = resolve(pkgRoot, file);

  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    console.error(`✗ ${file}: not found — run \`npm run build\` first`);
    failed = true;
    continue;
  }

  const { code } = await transformWithEsbuild(contents, path, { minify: true, target: TARGET });
  const gzip = gzipSync(Buffer.from(code), { level: 9 }).length;
  const pct = Math.round((gzip / maxGzip) * 100);
  const detail = `${(gzip / 1024).toFixed(1)}KB gzip minified / ${(maxGzip / 1024).toFixed(0)}KB budget (${pct}%)`;

  if (gzip > maxGzip) {
    console.error(`✗ ${file}: ${detail}`);
    failed = true;
  } else {
    console.log(`✓ ${file}: ${detail}`);
  }
}

process.exit(failed ? 1 : 0);

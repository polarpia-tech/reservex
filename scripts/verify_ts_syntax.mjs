#!/usr/bin/env node
// Syntax-only verification across every .ts/.tsx file in apps/ and packages/.
//
// Honesty note (this matters, see the blueprint's "no fake functionality"
// rule): this sandbox has no network access to the npm registry, so we
// cannot `pnpm install` the real Expo/React Native/Next.js/Supabase/i18next
// packages here and run a full `tsc` type-check against their real types.
// What this script DOES verify, for real, using the TypeScript compiler
// that is actually installed in this environment: every file parses as
// valid TypeScript/TSX -- no unclosed JSX tags, no stray braces, no typos
// that would fail a build regardless of which dependency versions resolve.
// Full type-checking happens the first time `pnpm install && pnpm typecheck`
// runs in a normal, connected environment (see README).
//
// supabase/functions/** is included from Phase 04 onward too. Those files
// run on Deno, not Node, and import via `npm:@supabase/supabase-js@2`
// specifiers -- this script does NOT resolve or type-check against Deno's
// or that package's real types (there is no Deno runtime in this sandbox),
// it only confirms the TypeScript/JSX grammar itself is valid. Real
// verification of those functions requires `supabase functions serve` /
// `deno check` on a machine with the Supabase CLI and Deno installed --
// neither is available here, and this has not been run against a live
// Supabase project.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const targets = ['apps', 'packages', 'supabase/functions'];
const skipDirs = new Set(['node_modules', 'dist', '.next', '.expo', '.turbo']);

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

let files = [];
for (const t of targets) {
  const dir = path.join(root, t);
  try {
    statSync(dir);
  } catch {
    continue; // target doesn't exist yet in this phase -- skip rather than crash
  }
  files = files.concat(collectFiles(dir));
}

let failures = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
    reportDiagnostics: true,
    fileName: file,
  });

  const syntaxErrors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (syntaxErrors.length > 0) {
    failures++;
    console.error(`\n✗ ${path.relative(root, file)}`);
    for (const d of syntaxErrors) {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        console.error(`  ${line + 1}:${character + 1} ${message}`);
      } else {
        console.error(`  ${message}`);
      }
    }
  }
}

console.log(`\nChecked ${files.length} .ts/.tsx files across ${targets.join(', ')}.`);
if (failures === 0) {
  console.log('OK: zero syntax errors.');
  process.exit(0);
} else {
  console.error(`FAILED: ${failures} file(s) had syntax errors.`);
  process.exit(1);
}

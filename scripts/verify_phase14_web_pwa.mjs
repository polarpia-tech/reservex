#!/usr/bin/env node
// Phase 14 (Web / PWA): real execution checks, not just TypeScript syntax
// (verify_ts_syntax.mjs already covers that across the whole repo).
//
// Honesty note, same as every other verify_phaseNN script in this project:
// there is no network access in this sandbox to `pnpm install` the real
// `next` package and run an actual `next build`, so this cannot prove the
// app builds/serves for real. What it DOES prove, by really executing
// code and inspecting the real filesystem:
//   1. app/manifest.ts's default export, actually transpiled and run
//      (not just parsed), returns a well-formed Web App Manifest object
//      -- required fields present, icons array non-empty, each icon
//      entry's `sizes` matches the real dimensions of the real PNG file
//      on disk at `src` (parsed straight from the PNG's own IHDR chunk,
//      no image library needed).
//   2. Every URL public/sw.js's PRECACHE_URLS lists actually resolves to
//      a real file (public/icons/*.png) or a real Next.js route
//      (app/offline/page.tsx for '/offline') -- a typo here would mean
//      `cache.addAll()` throws at service-worker install time in a real
//      browser, silently breaking installability.
//   3. app/icon.png and app/apple-icon.png (the Next.js file-convention
//      favicon/apple-touch-icon) exist and are non-empty.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const webRoot = path.join(root, 'apps/web');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

// --- 1. Transpile + actually execute app/manifest.ts -----------------------
console.log('=== manifest.ts ===');
const manifestSrc = readFileSync(path.join(webRoot, 'app/manifest.ts'), 'utf8');
const { outputText } = ts.transpileModule(manifestSrc, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
});
const tmpFile = path.join(webRoot, 'app', `.manifest.verify.${Date.now()}.mjs`);
// import type { MetadataRoute } from 'next' erases to nothing under transpileModule
// (it's a type-only import), so this file has zero runtime dependency on `next`
// actually being installed -- safe to import directly in plain Node.
import('node:fs').then(({ writeFileSync, unlinkSync }) => {
  writeFileSync(tmpFile, outputText);
  import(tmpFile)
    .then((mod) => {
      const manifest = mod.default();
      check('name is set', typeof manifest.name === 'string' && manifest.name.length > 0);
      check('start_url is set', manifest.start_url === '/');
      check('display is "standalone"', manifest.display === 'standalone');
      check('icons is a non-empty array', Array.isArray(manifest.icons) && manifest.icons.length >= 2);

      for (const icon of manifest.icons ?? []) {
        const iconPath = path.join(webRoot, 'public', icon.src);
        const exists = existsSync(iconPath);
        check(`icon file exists on disk: ${icon.src}`, exists);
        if (exists) {
          const [w, h] = readPngDimensions(iconPath);
          const [declaredW, declaredH] = icon.sizes.split('x').map(Number);
          check(`${icon.src} real dimensions (${w}x${h}) match declared sizes (${icon.sizes})`, w === declaredW && h === declaredH);
        }
      }

      runRemainingChecks();
      unlinkSync(tmpFile);
      finish();
    })
    .catch((err) => {
      console.log(`  FAIL manifest.ts failed to execute: ${err.message}`);
      failures++;
      try {
        unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
      runRemainingChecks();
      finish();
    });
});

function readPngDimensions(filePath) {
  const buf = readFileSync(filePath);
  // PNG: 8-byte signature, then IHDR chunk: 4-byte length, 4-byte "IHDR",
  // then width (4 bytes BE) + height (4 bytes BE). No image library needed.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return [width, height];
}

function runRemainingChecks() {
  // --- 2. Service worker precache list resolves to real files/routes -------
  console.log('=== public/sw.js precache list ===');
  const swSrc = readFileSync(path.join(webRoot, 'public/sw.js'), 'utf8');
  const constMatches = [...swSrc.matchAll(/const\s+(\w+)\s*=\s*['"]([^'"]*)['"]/g)];
  const constants = Object.fromEntries(constMatches.map((m) => [m[1], m[2]]));

  const match = swSrc.match(/PRECACHE_URLS\s*=\s*\[([^\]]*)\]/);
  check('PRECACHE_URLS array found in sw.js', Boolean(match));
  if (match) {
    const urls = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .map((token) => constants[token] ?? token);
    check('PRECACHE_URLS is non-empty', urls.length > 0);
    for (const url of urls) {
      if (url === '/offline') {
        check(`'${url}' resolves to a real route (app/offline/page.tsx)`, existsSync(path.join(webRoot, 'app/offline/page.tsx')));
      } else {
        check(`'${url}' resolves to a real public file`, existsSync(path.join(webRoot, 'public', url)));
      }
    }
  }

  // --- 3. Favicon / apple-touch-icon convention files -----------------------
  console.log('=== app/icon.png + app/apple-icon.png ===');
  for (const file of ['app/icon.png', 'app/apple-icon.png']) {
    const p = path.join(webRoot, file);
    const exists = existsSync(p);
    check(`${file} exists`, exists);
    if (exists) check(`${file} is non-empty`, statSync(p).size > 0);
  }

  // --- 4. Widget route: real files present, no accidental route collision --
  console.log('=== app/widget/[locale]/[slug] ===');
  check('widget page exists', existsSync(path.join(webRoot, 'app/widget/[locale]/[slug]/page.tsx')));
  check('widget page does not sit under app/[locale] (no shared site chrome)', !existsSync(path.join(webRoot, 'app/[locale]/widget')));
  check('OpeningHoursList shared component exists', existsSync(path.join(webRoot, 'src/components/OpeningHoursList.tsx')));
  check('WidgetResizeReporter shared component exists', existsSync(path.join(webRoot, 'src/components/WidgetResizeReporter.tsx')));
}

function finish() {
  console.log('');
  if (failures > 0) {
    console.log(`FAILED: ${failures} check(s) did not pass.`);
    process.exit(1);
  }
  console.log('OK: all Phase 14 web/PWA checks passed.');
}

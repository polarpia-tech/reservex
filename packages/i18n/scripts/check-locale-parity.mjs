#!/usr/bin/env node
// Fails the build if any locale is missing a key another locale has, or has
// an extra one -- the cheapest possible guard against "we added a string in
// English and forgot the other three languages exist."
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'src', 'locales');

function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenKeys(value, fullKey);
    }
    return [fullKey];
  });
}

const files = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error('No locale files found in', localesDir);
  process.exit(1);
}

const keysByLocale = new Map();
for (const file of files) {
  const locale = file.replace('.json', '');
  const data = JSON.parse(readFileSync(path.join(localesDir, file), 'utf8'));
  keysByLocale.set(locale, new Set(flattenKeys(data)));
}

const [firstLocale, firstKeys] = [...keysByLocale.entries()][0];
let ok = true;

for (const [locale, keys] of keysByLocale) {
  if (locale === firstLocale) continue;
  const missing = [...firstKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !firstKeys.has(k));
  if (missing.length > 0) {
    ok = false;
    console.error(`[${locale}] missing ${missing.length} key(s) present in [${firstLocale}]:`, missing);
  }
  if (extra.length > 0) {
    ok = false;
    console.error(`[${locale}] has ${extra.length} extra key(s) not present in [${firstLocale}]:`, extra);
  }
}

if (ok) {
  console.log(`OK: all ${keysByLocale.size} locales (${[...keysByLocale.keys()].join(', ')}) have identical key sets (${firstKeys.size} keys each).`);
  process.exit(0);
} else {
  process.exit(1);
}

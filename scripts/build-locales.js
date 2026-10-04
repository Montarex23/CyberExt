#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'locales');
const TARGET_DIR = path.join(ROOT, 'src', '_locales');
const LANGUAGES = ['pl', 'en'];

function toChromeMessages(flat) {
  const out = {};
  for (const [key, text] of Object.entries(flat)) {
    const numbers = [...new Set([...text.matchAll(/\$(\d)/g)].map((m) => m[1]))].sort();
    const entry = { message: text.replace(/\$(\d)/g, (_, n) => `$P${n}$`) };
    if (numbers.length) {
      entry.placeholders = Object.fromEntries(numbers.map((n) => [`p${n}`, { content: `$${n}` }]));
    }
    out[key] = entry;
  }
  return out;
}

function placeholdersOf(text) {
  return [...new Set([...text.matchAll(/\$(\d)/g)].map((m) => m[1]))].sort().join(',');
}

const sources = Object.fromEntries(
  LANGUAGES.map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, `${lang}.json`), 'utf-8'))])
);

const reference = sources[LANGUAGES[0]];
const problems = [];
for (const lang of LANGUAGES.slice(1)) {
  for (const key of Object.keys(reference)) {
    if (!(key in sources[lang])) problems.push(`${lang}: missing "${key}"`);
    else if (placeholdersOf(reference[key]) !== placeholdersOf(sources[lang][key])) problems.push(`${lang}: parameters differ in "${key}"`);
  }
  for (const key of Object.keys(sources[lang])) {
    if (!(key in reference)) problems.push(`${lang}: extra key "${key}"`);
  }
}
if (problems.length) {
  console.error(`[build-locales] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

for (const lang of LANGUAGES) {
  const dir = path.join(TARGET_DIR, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'messages.json'), `${JSON.stringify(toChromeMessages(sources[lang]), null, 2)}\n`, 'utf-8');
  console.log(`[build-locales] ${lang}: ${Object.keys(sources[lang]).length} messages`);
}

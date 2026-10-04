#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');

const PSL_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const OUTPUT = path.resolve(__dirname, '..', 'src', 'shared', 'psl-data.js');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function ruleToAscii(rule) {
  let prefix = '';
  let body = rule;
  if (body.startsWith('!')) {
    prefix = '!';
    body = body.slice(1);
  }
  if (body.startsWith('*.')) {
    prefix += '*.';
    body = body.slice(2);
  }
  const ascii = url.domainToASCII(body);
  return ascii ? prefix + ascii : null;
}

function parsePsl(text) {
  const rules = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim().split(/\s/)[0];
    if (!line || line.startsWith('//')) continue;
    const ascii = ruleToAscii(line.toLowerCase());
    if (ascii) rules.add(ascii);
  }
  return [...rules].sort();
}

async function main() {
  const input = argValue('--input');
  const text = input
    ? fs.readFileSync(input, 'utf-8')
    : await (await fetch(PSL_URL)).text();

  const rules = parsePsl(text);
  if (rules.length < 5000) {
    throw new Error(`PSL looks truncated (${rules.length} rules) — refusing to write.`);
  }

  const out =
    `(function (root) {\n` +
    `  'use strict';\n` +
    `  const CG = (root.CyberGuard = root.CyberGuard || {});\n` +
    `  CG.pslRules = ${JSON.stringify(rules.join('\n'))};\n` +
    `  if (typeof module === 'object' && module.exports) module.exports = CG.pslRules;\n` +
    `})(typeof self !== 'undefined' ? self : globalThis);\n`;

  fs.writeFileSync(OUTPUT, out, 'utf-8');
  console.log(`[build-psl] Wrote ${rules.length} rules to ${path.relative(process.cwd(), OUTPUT)}`);
}

main().catch((err) => {
  console.error('[build-psl] Failed:', err.message);
  process.exit(1);
});

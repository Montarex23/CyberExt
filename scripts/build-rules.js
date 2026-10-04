#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

require('../src/shared/psl-data.js');
const domain = require('../src/shared/domain.js');
const filter = require('../src/shared/blocklist-filter.js');

const ROOT = path.resolve(__dirname, '..');
const WARNING_PATH = '/pages/warning/warning.html';
const ARCHIVE_CHUNK_SIZE = 1000;
const DEFAULT_MAX_PER_DOMAIN = 25000;

const SOURCES = [
  { id: 'openphish', url: 'https://openphish.com/feed.txt', file: 'openphish.txt', parse: parseUrlList },
  { id: 'cert_pl', url: 'https://hole.cert.pl/domains/v2/domains.json', file: 'cert_pl.json', parse: parseCertJson },
];

function parseArgs(argv) {
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
  };
  return {
    offline: argv.includes('--offline'),
    cacheDir: value('--cache-dir') ? path.resolve(value('--cache-dir')) : null,
    outDir: path.resolve(value('--out') || path.join(ROOT, 'src', 'rules')),
    maxPerDomain: Number(value('--max-per-domain')) || DEFAULT_MAX_PER_DOMAIN,
  };
}

function parseUrlList(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function parseCertJson(text) {
  const entries = JSON.parse(text);
  if (!Array.isArray(entries)) throw new Error('CERT PL feed: expected an array');
  return entries
    .filter((e) => e && e.DomainAddress && !e.DeleteDate)
    .sort((a, b) => String(b.InsertDate).localeCompare(String(a.InsertDate)))
    .map((e) => e.DomainAddress);
}

async function loadSource(source, opts) {
  const cached = opts.cacheDir ? path.join(opts.cacheDir, source.file) : null;
  if (cached && fs.existsSync(cached) && (opts.offline || isFresh(cached))) {
    console.log(`[build-rules] ${source.id}: using ${path.relative(process.cwd(), cached)}`);
    return fs.readFileSync(cached, 'utf-8');
  }
  if (opts.offline) throw new Error(`${source.id}: --offline but no cached file at ${cached}`);

  console.log(`[build-rules] ${source.id}: downloading ${source.url}`);
  const response = await fetch(source.url, { headers: { 'User-Agent': 'CyberGuard-rule-builder' } });
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
  const text = await response.text();
  if (cached) {
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, text, 'utf-8');
  }
  return text;
}

function isFresh(file) {
  return Date.now() - fs.statSync(file).mtimeMs < 6 * 60 * 60 * 1000;
}

function collect(rawBySource) {
  const seen = new Set();
  const entries = [];
  const skipped = { invalid: 0, 'public-suffix': [], 'first-party': [], platform: [] };
  const perSource = {};

  for (const { id, raw } of rawBySource) {
    let count = 0;
    for (const item of raw) {
      const host = filter.normalizeFeedHost(item);
      if (!host) {
        skipped.invalid++;
        continue;
      }
      const decision = filter.blockDecision(host);
      if (!decision.ok) {
        skipped[decision.reason].push(host);
        continue;
      }
      if (seen.has(host)) continue;
      seen.add(host);
      entries.push({ host, src: id });
      count++;
    }
    perSource[id] = count;
  }

  const kept = new Set(filter.collapseSubdomains(entries.map((e) => e.host)));
  return { entries: entries.filter((e) => kept.has(e.host)), skipped, perSource };
}

function buildRulesets(entries, maxPerDomain) {
  const perDomain = entries.slice(0, maxPerDomain);
  const archived = entries.slice(maxPerDomain);

  const main = perDomain.map((e, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: `${WARNING_PATH}?domain=${encodeURIComponent(e.host)}&src=${e.src}` },
    },
    condition: { requestDomains: [e.host], resourceTypes: ['main_frame'] },
  }));

  const archive = [];
  const bySource = new Map();
  for (const e of archived) {
    if (!bySource.has(e.src)) bySource.set(e.src, []);
    bySource.get(e.src).push(e.host);
  }
  for (const [src, hosts] of bySource) {
    for (let i = 0; i < hosts.length; i += ARCHIVE_CHUNK_SIZE) {
      archive.push({
        id: archive.length + 1,
        priority: 1,
        action: { type: 'redirect', redirect: { extensionPath: `${WARNING_PATH}?src=${src}` } },
        condition: { requestDomains: hosts.slice(i, i + ARCHIVE_CHUNK_SIZE), resourceTypes: ['main_frame'] },
      });
    }
  }
  return { main, archive };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), 'utf-8');
  return fs.statSync(file).size;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('='.repeat(64));
  console.log(' CyberGuard — rule builder');
  console.log('='.repeat(64));

  const rawBySource = [];
  for (const source of SOURCES) {
    const text = await loadSource(source, opts);
    rawBySource.push({ id: source.id, raw: source.parse(text) });
  }

  const { entries, skipped, perSource } = collect(rawBySource);
  if (entries.length === 0) throw new Error('No domains collected — refusing to write empty rules.');

  const { main: mainRules, archive } = buildRulesets(entries, opts.maxPerDomain);
  const archivedDomains = archive.reduce((n, r) => n + r.condition.requestDomains.length, 0);

  const mainSize = writeJson(path.join(opts.outDir, 'main.json'), mainRules);
  const archiveSize = writeJson(path.join(opts.outDir, 'archive.json'), archive);
  writeJson(path.join(opts.outDir, 'meta.json'), {
    generatedAt: new Date().toISOString(),
    totalDomains: entries.length,
    sources: perSource,
    perDomainRules: mainRules.length,
    archiveRules: archive.length,
    archivedDomains,
  });

  const kb = (n) => `${Math.round(n / 1024).toLocaleString('en')} KB`;
  console.log(`[build-rules] Sources:        ${Object.entries(perSource).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`[build-rules] Unique domains: ${entries.length}`);
  console.log(`[build-rules] main.json:      ${mainRules.length} rules (${kb(mainSize)})`);
  console.log(`[build-rules] archive.json:   ${archive.length} rules / ${archivedDomains} domains (${kb(archiveSize)})`);
  console.log(`[build-rules] Skipped:        invalid=${skipped.invalid}, public-suffix=${skipped['public-suffix'].length}, ` +
    `first-party=${skipped['first-party'].length}, platform=${skipped.platform.length}`);
  for (const reason of ['first-party', 'platform', 'public-suffix']) {
    const sample = [...new Set(skipped[reason])].slice(0, 8);
    if (sample.length) console.log(`[build-rules]   ${reason} e.g.: ${sample.join(', ')}`);
  }
  console.log(`[build-rules] Rules written to ${path.relative(process.cwd(), opts.outDir) || '.'}`);
  console.log('='.repeat(64));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[build-rules] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { parseUrlList, parseCertJson, collect, buildRulesets };

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const lookalike = require('../src/shared/lookalike.js');
const knownSites = require('../src/shared/known-sites.js');
const { LEGIT_SAMPLES } = require('../tests/unit/legit-domains.js');

const certFile = path.resolve(__dirname, '..', '.cache', 'cert_pl.json');
const cert = JSON.parse(fs.readFileSync(certFile, 'utf-8')).filter((e) => !e.DeleteDate).map((e) => e.DomainAddress.toLowerCase());

const words = knownSites.SITES.flatMap((s) => s.keywords.filter((k) => !k.startsWith('=')).map((k) => [k.replace(/^~/, ''), s.id]));
const mentioning = cert.filter((h) => words.some(([w]) => h.replace(/-/g, '').includes(w)));
const flagged = mentioning.filter((h) => lookalike.analyzeHost(h));
const missed = mentioning.filter((h) => !lookalike.analyzeHost(h));

console.log(`CERT domains mentioning a known brand: ${mentioning.length}`);
console.log(`  flagged: ${flagged.length} (${((flagged.length / mentioning.length) * 100).toFixed(1)}%)`);
console.log(`  missed examples: ${missed.slice(0, 15).join(', ')}`);

const allFlagged = cert.filter((h) => lookalike.analyzeHost(h)).length;
console.log(`All CERT domains flagged by lookalike alone: ${allFlagged} of ${cert.length}`);

const fps = LEGIT_SAMPLES.filter((h) => lookalike.analyzeHost(h));
console.log(`False positives on ${LEGIT_SAMPLES.length} legitimate domains: ${fps.length}${fps.length ? ` → ${fps.join(', ')}` : ''}`);

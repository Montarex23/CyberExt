#!/usr/bin/env node
/**
 * CyberGuard — Packs src/ into dist/cyberguard-<version>.zip for the
 * Chrome Web Store / Edge Add-ons upload. No external tools needed.
 *
 * Usage: node scripts/package.js   (run `npm run build` first)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const EXCLUDE = new Set(['_metadata', '.DS_Store', 'Thumbs.db', '.gitkeep']);

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDE.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

/** Minimal ZIP writer (deflate), enough for extension packages. */
function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf-8'));
for (const r of manifest.declarative_net_request.rule_resources) {
  if (!fs.existsSync(path.join(SRC, r.path))) {
    console.error(`[package] Missing ${r.path} — run "npm run build" first.`);
    process.exit(1);
  }
}

const files = listFiles(SRC).map((name) => ({ name, data: fs.readFileSync(path.join(SRC, name)) }));
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `cyberguard-${manifest.version}.zip`);
fs.writeFileSync(out, createZip(files));
console.log(`[package] ${files.length} files → ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);

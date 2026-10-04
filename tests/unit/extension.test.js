'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf-8'));
const locales = Object.fromEntries(
  ['pl', 'en'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(SRC, '_locales', l, 'messages.json'), 'utf-8'))])
);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

test('files referenced by the manifest exist', () => {
  const paths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const p of paths) assert.ok(fs.existsSync(path.join(SRC, p)), p);
});

test('icons are real PNG files with the declared size', () => {
  const declared = { ...manifest.icons, ...manifest.action.default_icon };
  for (const [size, file] of Object.entries(declared)) {
    const buf = fs.readFileSync(path.join(SRC, file));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is not a PNG`);
    assert.equal(buf.readUInt32BE(16), Number(size), `${file} width`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${file} height`);
  }
});

test('service worker importScripts paths exist', () => {
  const sw = fs.readFileSync(path.join(SRC, manifest.background.service_worker), 'utf-8');
  const block = sw.match(/importScripts\(([\s\S]*?)\);/)[1];
  const files = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(files.length > 5);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(SRC, path.dirname(manifest.background.service_worker), f)), f);
  }
});

test('permissions are minimal', () => {
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'declarativeNetRequest', 'scripting', 'storage']);
  assert.deepEqual(manifest.optional_permissions, ['browsingData']);
});

test('every translation key used in the code exists in pl and en', () => {
  const used = new Set();
  for (const file of walk(SRC).filter((f) => /\.(js|html|json)$/.test(f) && !f.includes(`${path.sep}rules${path.sep}`) && !f.includes('_locales'))) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/data-i18n(?:-aria|-title)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/\b(?:t|rich)\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  }
  assert.ok(used.size > 50, `found only ${used.size} keys`);
  for (const key of used) {
    assert.ok(locales.pl[key], `pl missing ${key}`);
    assert.ok(locales.en[key], `en missing ${key}`);
  }
});

test('every script is UTF-8 that Chrome accepts (no BOM, no noncharacters U+FFFE/U+FFFF)', () => {
  for (const file of walk(SRC).filter((f) => /\.(js|json|html|css)$/.test(f) && !f.includes(`${path.sep}rules${path.sep}`))) {
    const buf = fs.readFileSync(file);
    assert.notEqual(buf.subarray(0, 3).toString('hex'), 'efbbbf', `${file} has a BOM`);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(buf).length >= 0, true);
    assert.equal(/[￾￿]/.test(buf.toString('utf-8')), false, `${file} contains a noncharacter`);
  }
});

test('no innerHTML with dynamic data in content scripts', () => {
  for (const file of manifest.content_scripts.flatMap((c) => c.js)) {
    const text = fs.readFileSync(path.join(SRC, file), 'utf-8');
    const uses = [...text.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const rhs of uses) assert.equal(rhs, 'v', `${file}: innerHTML = ${rhs}`);
  }
});

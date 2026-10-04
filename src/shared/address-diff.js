(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (typeof require === 'function') {
    if (!CG.domain) require('./domain.js');
    if (!CG.punycode) require('./punycode.js');
    if (!CG.lookalike) require('./lookalike.js');
  }
  const api = (CG.addressDiff = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  const CYRILLIC = /[Ѐ-ӿ]/;
  const GREEK = /[Ͱ-Ͽ]/;

  function toParts(chars) {
    const parts = [];
    for (const c of chars) {
      const last = parts[parts.length - 1];
      if (last && last.m === c.m && !last.gap && !c.gap) last.t += c.t;
      else parts.push({ t: c.t, m: c.m, gap: !!c.gap });
    }
    return parts;
  }

  const plain = (text) => [...text].map((t) => ({ t, m: false }));
  const marked = (text) => [...text].map((t) => ({ t, m: true }));

  function editOps(fake, real) {
    const a = [...fake];
    const b = [...real];
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    const ops = [];
    let i = a.length;
    let j = b.length;
    while (i > 0 || j > 0) {
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && a[i - 1] !== b[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
        ops.push({ op: 'swap', fake: a[i - 2] + a[i - 1] });
        i -= 2;
        j -= 2;
      } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
        ops.push(a[i - 1] === b[j - 1] ? { op: 'keep', fake: a[i - 1] } : { op: 'sub', fake: a[i - 1], real: b[j - 1] });
        i--;
        j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        ops.push({ op: 'extra', fake: a[i - 1] });
        i--;
      } else {
        ops.push({ op: 'missing', real: b[j - 1] });
        j--;
      }
    }
    return ops.reverse();
  }

  function realSiteFor(look) {
    const domains = look.brand.domains || [look.brand.site];
    return domains.find((d) => CG.domain.registrableLabel(d) === look.keyword) || look.brand.site;
  }

  function hostPieces(host) {
    const suffix = CG.domain.getPublicSuffix(host);
    const site = CG.domain.getSiteKey(host);
    const label = site.slice(0, site.length - suffix.length - 1);
    const sub = host.slice(0, host.length - site.length);
    return { suffix, site, label, sub };
  }

  function homographDiff(host, look) {
    const unicode = CG.punycode.toUnicode(host);
    const chars = [...unicode].map((t) => ({ t, m: CYRILLIC.test(t) || GREEK.test(t) }));
    const first = chars.find((c) => c.m);
    return {
      parts: toParts(chars),
      note: first ? { key: 'diffHomograph', params: [first.t, CG.lookalike.skeleton(first.t)] } : null,
      realSite: realSiteFor(look),
    };
  }

  function typoDiff(host, look) {
    const { sub, label, suffix } = hostPieces(host);
    const ops = editOps(label, look.keyword);
    const chars = [...plain(sub)];
    for (const o of ops) {
      if (o.op === 'keep') chars.push({ t: o.fake, m: false });
      else if (o.op === 'missing') chars.push({ t: '_', m: true, gap: true });
      else chars.push(...marked(o.fake));
    }
    chars.push(...plain(`.${suffix}`));

    const changes = ops.filter((o) => o.op !== 'keep');
    let note = { key: 'diffSeveral', params: [] };
    if (changes.length === 1) {
      const c = changes[0];
      if (c.op === 'sub') note = { key: 'diffSub', params: [c.fake, c.real] };
      else if (c.op === 'extra') note = { key: 'diffExtra', params: [c.fake] };
      else if (c.op === 'missing') note = { key: 'diffMissing', params: [c.real] };
      else if (c.op === 'swap') note = { key: 'diffSwap', params: [c.fake] };
    }
    return { parts: toParts(chars), note, realSite: realSiteFor(look) };
  }

  function suffixDiff(host, look) {
    const { sub, label, suffix } = hostPieces(host);
    const realSite = realSiteFor(look);
    const realSuffix = CG.domain.getPublicSuffix(realSite);
    return {
      parts: toParts([...plain(`${sub}${label}.`), ...marked(suffix)]),
      note: { key: 'diffSuffix', params: [suffix, realSuffix] },
      realSite,
    };
  }

  function ownerDiff(host, look) {
    const { sub, site } = hostPieces(host);
    let chars;
    const at = site.indexOf(look.keyword);
    if (!look.inMain || at === -1) {
      chars = [...plain(sub), ...marked(site)];
    } else {
      chars = [
        ...plain(sub),
        ...marked(site.slice(0, at)),
        ...plain(look.keyword),
        ...marked(site.slice(at + look.keyword.length)),
      ];
    }
    return {
      parts: toParts(chars),
      note: { key: 'diffOwner', params: [site, look.brand.name] },
      realSite: realSiteFor(look),
    };
  }

  function describe(host, look) {
    const h = CG.domain.normalizeHost(host);
    const l = look === undefined ? CG.lookalike.analyzeHost(h) : look;
    if (!l || !l.brand) return null;

    let diff;
    if (l.kind === 'homograph') diff = homographDiff(h, l);
    else if (l.how === 'typo' || (l.disguised && l.how === 'exact')) diff = typoDiff(h, l);
    else if (l.how === 'exact') diff = suffixDiff(h, l);
    else diff = ownerDiff(h, l);

    return { brandName: l.brand.name, realSite: diff.realSite, parts: diff.parts, note: diff.note };
  }

  function plainHost(host) {
    return [{ t: String(host), m: false, gap: false }];
  }

  return { describe, editOps, plainHost };
});

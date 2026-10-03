/**
 * CyberGuard — Known (official) sites.
 *
 * Every password used on one of these sites is automatically treated as
 * "important": if the same password is later typed on a site that does NOT
 * belong to the same company, CyberGuard shows a blocking warning. The user
 * never has to configure anything.
 *
 * Fields:
 *   name      — shown to the user ("To hasło używasz na stronie mBank").
 *   domains   — official registrable domains (all treated as one owner).
 *   keywords  — words that phishing domains abuse ("mbank-logowanie.com").
 *               "word"  — whole token, part of a label, or a 1-letter typo ("alegro").
 *               "~word" — whole token or typo only (word is a prefix of common words,
 *                          e.g. "revolut" / "revolution").
 *               "=word" — whole token only AND only together with another suspicious
 *                          sign ("logowanie", "doplata", cheap TLD...). For short or
 *                          common words like "ing", "wp", "apple".
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (!CG.domain && typeof require === 'function') require('./domain.js');
  const api = (CG.knownSites = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  const GOOGLE_TLDS = ['com', 'pl', 'de', 'co.uk', 'fr', 'it', 'es', 'nl', 'cz', 'sk', 'ua', 'at', 'ch', 'be', 'se', 'no', 'dk', 'fi', 'ie', 'pt', 'gr', 'hu', 'ro', 'lt', 'lv', 'ee', 'ca', 'com.au', 'co.jp', 'co.in', 'com.br'];
  const AMAZON_TLDS = ['com', 'pl', 'de', 'co.uk', 'fr', 'it', 'es', 'nl', 'se', 'com.be', 'ca', 'com.au', 'co.jp', 'in', 'com.br', 'com.mx', 'com.tr', 'ae', 'sa', 'sg', 'eg'];
  const OLX_TLDS = ['pl', 'ua', 'bg', 'ro', 'pt', 'kz', 'uz', 'com'];
  const VINTED_TLDS = ['pl', 'com', 'fr', 'de', 'it', 'es', 'nl', 'be', 'lt', 'cz', 'sk', 'co.uk', 'at', 'hu', 'ro', 'se', 'fi', 'dk', 'pt', 'gr', 'hr', 'ie', 'lu'];
  const withTlds = (label, tlds) => tlds.map((t) => `${label}.${t}`);

  const SITES = [
    // --- Banki ---
    { id: 'pko', name: 'PKO Bank Polski', category: 'bank', domains: ['pkobp.pl', 'ipko.pl', 'pkobp.com'], keywords: ['pkobp', '~ipko', '=pko'] },
    { id: 'inteligo', name: 'Inteligo', category: 'bank', domains: ['inteligo.pl'], keywords: ['~inteligo'] },
    { id: 'pekao', name: 'Bank Pekao', category: 'bank', domains: ['pekao.com.pl', 'pekao24.pl', 'pekaobiznes24.pl', 'pekaobh.pl'], keywords: ['pekao'] },
    { id: 'santander', name: 'Santander Bank Polska', category: 'bank', domains: ['santander.pl', 'centrum24.pl', 'santanderconsumer.pl'], keywords: ['santander', 'centrum24'] },
    { id: 'mbank', name: 'mBank', category: 'bank', domains: ['mbank.pl', 'mbank.com.pl', 'mbank.com'], keywords: ['mbank'] },
    { id: 'ing', name: 'ING Bank Śląski', category: 'bank', domains: ['ing.pl', 'ingbank.pl', 'ing.com'], keywords: ['ingbank', '=ing'] },
    { id: 'millennium', name: 'Bank Millennium', category: 'bank', domains: ['bankmillennium.pl'], keywords: ['bankmillennium', '=millennium'] },
    { id: 'alior', name: 'Alior Bank', category: 'bank', domains: ['aliorbank.pl'], keywords: ['aliorbank', '~alior'] },
    { id: 'bnp', name: 'BNP Paribas', category: 'bank', domains: ['bnpparibas.pl', 'bnpparibas.com'], keywords: ['bnpparibas', '=bnp'] },
    { id: 'ca', name: 'Credit Agricole', category: 'bank', domains: ['credit-agricole.pl'], keywords: ['creditagricole', '~agricole'] },
    { id: 'citi', name: 'Citi Handlowy', category: 'bank', domains: ['citibank.pl', 'citibankonline.pl', 'citihandlowy.pl'], keywords: ['citibank', 'citihandlowy'] },
    { id: 'velo', name: 'VeloBank', category: 'bank', domains: ['velobank.pl'], keywords: ['velobank'] },
    { id: 'nest', name: 'Nest Bank', category: 'bank', domains: ['nestbank.pl'], keywords: ['nestbank'] },
    { id: 'pocztowy', name: 'Bank Pocztowy', category: 'bank', domains: ['pocztowy.pl', 'envelobank.pl'], keywords: ['bankpocztowy', 'envelobank'] },
    { id: 'bos', name: 'BOŚ Bank', category: 'bank', domains: ['bosbank.pl'], keywords: ['bosbank'] },
    { id: 'plusbank', name: 'Plus Bank', category: 'bank', domains: ['plusbank.pl'], keywords: ['plusbank'] },
    { id: 'toyotabank', name: 'Toyota Bank', category: 'bank', domains: ['toyotabank.pl'], keywords: ['toyotabank'] },
    { id: 'revolut', name: 'Revolut', category: 'bank', domains: ['revolut.com', 'revolut.me'], keywords: ['~revolut'] },
    { id: 'paypal', name: 'PayPal', category: 'payment', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com'], keywords: ['paypal'] },

    // --- Urzędy ---
    { id: 'govpl', name: 'gov.pl (mObywatel, ePUAP, Profil Zaufany)', category: 'gov', domains: ['www.gov.pl', 'login.gov.pl', 'pz.gov.pl', 'epuap.gov.pl', 'podatki.gov.pl', 'mobywatel.gov.pl', 'obywatel.gov.pl'], keywords: ['mobywatel', 'epuap', 'profilzaufany', 'govpl'] },
    { id: 'zus', name: 'ZUS', category: 'gov', domains: ['zus.pl'], keywords: ['=zus'] },

    // --- Poczta, konta ---
    { id: 'google', name: 'Google (Gmail, YouTube)', category: 'email', domains: [...withTlds('google', GOOGLE_TLDS), 'gmail.com', 'youtube.com', 'googlemail.com', 'gstatic.com', 'googleapis.com', 'withgoogle.com', 'android.com', 'blogger.com'], keywords: ['gmail', '=google'] },
    { id: 'microsoft', name: 'Microsoft (Outlook, Office)', category: 'email', domains: ['microsoft.com', 'live.com', 'outlook.com', 'hotmail.com', 'office.com', 'microsoftonline.com', 'microsoft365.com', 'office365.com', 'msn.com', 'onedrive.com', 'skype.com', 'xbox.com', 'bing.com', 'azure.com', 'windows.com', 'msftauth.net', 'live.net'], keywords: ['microsoft', 'hotmail', 'office365', '=outlook'] },
    { id: 'apple', name: 'Apple (iCloud)', category: 'email', domains: ['apple.com', 'icloud.com', 'me.com'], keywords: ['icloud', 'appleid', '=apple'] },
    { id: 'wp', name: 'Wirtualna Polska (Poczta WP, o2)', category: 'email', domains: ['wp.pl', 'o2.pl'], keywords: ['=wp'] },
    { id: 'onet', name: 'Onet (Poczta Onet)', category: 'email', domains: ['onet.pl', 'onet.eu', 'op.pl', 'vp.pl'], keywords: ['=onet'] },
    { id: 'interia', name: 'Interia (Poczta Interia)', category: 'email', domains: ['interia.pl', 'interia.eu', 'poczta.fm'], keywords: ['interia'] },
    { id: 'yahoo', name: 'Yahoo', category: 'email', domains: ['yahoo.com'], keywords: ['=yahoo'] },

    // --- Społecznościowe ---
    { id: 'meta', name: 'Facebook / Instagram / WhatsApp', category: 'social', domains: ['facebook.com', 'fb.com', 'messenger.com', 'instagram.com', 'whatsapp.com', 'meta.com', 'fbcdn.net'], keywords: ['facebook', 'instagram', 'whatsapp'] },

    // --- Zakupy, ogłoszenia ---
    { id: 'allegro', name: 'Allegro', category: 'shop', domains: ['allegro.pl', 'allegrolokalnie.pl', 'allegro.cz', 'allegro.sk', 'allegro.hu', 'allegro.eu', 'allegropay.pl'], keywords: ['allegro'] },
    { id: 'olx', name: 'OLX', category: 'shop', domains: withTlds('olx', OLX_TLDS), keywords: ['=olx'] },
    { id: 'vinted', name: 'Vinted', category: 'shop', domains: withTlds('vinted', VINTED_TLDS), keywords: ['vinted'] },
    { id: 'amazon', name: 'Amazon', category: 'shop', domains: withTlds('amazon', AMAZON_TLDS), keywords: ['=amazon'] },
    { id: 'netflix', name: 'Netflix', category: 'shop', domains: ['netflix.com'], keywords: ['netflix'] },

    // --- Przesyłki ---
    { id: 'inpost', name: 'InPost', category: 'courier', domains: ['inpost.pl', 'inpost.eu', 'inpost.co.uk', 'paczkomaty.pl'], keywords: ['inpost', 'paczkomat'] },
    { id: 'pocztapolska', name: 'Poczta Polska', category: 'courier', domains: ['poczta-polska.pl', 'pocztex.pl', 'envelo.pl'], keywords: ['pocztapolska', 'pocztex'] },
    { id: 'dhl', name: 'DHL', category: 'courier', domains: ['dhl.com', 'dhl.pl', 'dhlparcel.pl'], keywords: ['=dhl'] },
    { id: 'dpd', name: 'DPD', category: 'courier', domains: ['dpd.com.pl', 'dpd.com', 'dpd.pl'], keywords: ['=dpd'] },

    // --- Prąd, gaz, telefon ---
    { id: 'pge', name: 'PGE', category: 'utility', domains: ['pge.pl', 'gkpge.pl', 'pge-obrot.pl'], keywords: ['=pge'] },
    { id: 'tauron', name: 'Tauron', category: 'utility', domains: ['tauron.pl', 'tauron-dystrybucja.pl'], keywords: ['tauron'] },
    { id: 'enea', name: 'Enea', category: 'utility', domains: ['enea.pl'], keywords: ['=enea'] },
    { id: 'energa', name: 'Energa', category: 'utility', domains: ['energa.pl', 'energa-operator.pl'], keywords: ['~energa'] },
    { id: 'orange', name: 'Orange', category: 'telecom', domains: ['orange.pl'], keywords: [] },
    { id: 'play', name: 'Play', category: 'telecom', domains: ['play.pl'], keywords: [] },
    { id: 'plus', name: 'Plus', category: 'telecom', domains: ['plus.pl'], keywords: [] },
    { id: 'tmobile', name: 'T-Mobile', category: 'telecom', domains: ['t-mobile.pl'], keywords: ['tmobile'] },
  ];

  // Index: site key → brand.
  const bySite = new Map();
  for (const site of SITES) {
    for (const d of site.domains) bySite.set(CG.domain.siteKeyForTrust(d), site);
  }

  /** Brand owning a site key (from siteKeyForTrust), or null. */
  function brandForSite(siteKey) {
    return bySite.get(siteKey) || null;
  }

  /** Brand owning a hostname, or null. */
  function brandForHost(host) {
    return brandForSite(CG.domain.siteKeyForTrust(host));
  }

  /** True when both site keys are the same site or belong to the same company. */
  function sameOwnerSite(siteA, siteB) {
    if (!siteA || !siteB) return false;
    if (siteA === siteB) return true;
    const a = brandForSite(siteA);
    return !!a && a === brandForSite(siteB);
  }

  function sameOwnerHost(hostA, hostB) {
    return sameOwnerSite(CG.domain.siteKeyForTrust(hostA), CG.domain.siteKeyForTrust(hostB));
  }

  /** All official registrable domains (used by the rule builder's allowlist). */
  function allOfficialSites() {
    return [...bySite.keys()];
  }

  return { SITES, brandForSite, brandForHost, sameOwnerSite, sameOwnerHost, allOfficialSites };
});

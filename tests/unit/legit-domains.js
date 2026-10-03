'use strict';

/**
 * Real, legitimate domains that contain a known brand name. The lookalike
 * detector must stay quiet on all of them (see lookalike.test.js and
 * scripts/measure-lookalike.js). Add every false alarm reported by users here.
 */
const LEGIT_SAMPLES = [
  // Same brand, other country / technical domains
  'allegro.tech', 'allegroapi.io', 'allegrogroup.com', 'mbank.cz', 'mbank.sk', 'santander.com', 'santander.co.uk',
  'santander.de', 'paypal-community.com', 'paypal.de', 'paypal.pl', 'netflix.net', 'inpost.es', 'inpost.it',
  'inpost.fr', 'facebook.net', 'whatsapp.net', 'ing.de', 'ing.nl', 'olx.ua', 'vinted.lt', 'revolut.me',
  // Brand + ordinary word (subsidiaries, services)
  'santanderleasing.pl', 'santandertfi.pl', 'netflixtechblog.com', 'pekaotfi.pl', 'pekaoleasing.com.pl',
  'pekaofaktoring.pl', 'energa-obrot.pl', 'energa-operator.pl', 'pge-dystrybucja.pl', 'inpost-group.com',
  'icloud-content.com', 'microsoftstore.com', 'interiamail.pl', 'tauron-dystrybucja.pl', 'aliorleasing.pl',
  'ipkobiznes.pl', 'mbankbiznes.pl', 'allegrolokalnie.pl',
  // Ordinary sites that merely contain a short word
  'shopping.com', 'revolution-shop.pl', 'apple-pie.pl', 'google-ads-agency.pl', 'energetyka.pl', 'ing-art.pl',
  'wp.mojafirma.pl', 'przepisy-babci.pl', 'blog.mojafirma.pl',
];

/** Brand names on free hosting or scam endings — these SHOULD be flagged. */
const SUSPICIOUS_SAMPLES = ['olx-fan.blogspot.com', 'facebook-six-ivory.vercel.app', 'allegro.cam', 'paypalcointrade.com'];

module.exports = { LEGIT_SAMPLES, SUSPICIOUS_SAMPLES };

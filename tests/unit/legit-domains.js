'use strict';

const LEGIT_SAMPLES = [
  'allegro.tech', 'allegroapi.io', 'allegrogroup.com', 'mbank.cz', 'mbank.sk', 'santander.com', 'santander.co.uk',
  'santander.de', 'paypal-community.com', 'paypal.de', 'paypal.pl', 'netflix.net', 'inpost.es', 'inpost.it',
  'inpost.fr', 'facebook.net', 'whatsapp.net', 'ing.de', 'ing.nl', 'olx.ua', 'vinted.lt', 'revolut.me',
  'santanderleasing.pl', 'santandertfi.pl', 'netflixtechblog.com', 'pekaotfi.pl', 'pekaoleasing.com.pl',
  'pekaofaktoring.pl', 'energa-obrot.pl', 'energa-operator.pl', 'pge-dystrybucja.pl', 'inpost-group.com',
  'icloud-content.com', 'microsoftstore.com', 'interiamail.pl', 'tauron-dystrybucja.pl', 'aliorleasing.pl',
  'ipkobiznes.pl', 'mbankbiznes.pl', 'allegrolokalnie.pl',
  'shopping.com', 'revolution-shop.pl', 'apple-pie.pl', 'google-ads-agency.pl', 'energetyka.pl', 'ing-art.pl',
  'wp.mojafirma.pl', 'przepisy-babci.pl', 'blog.mojafirma.pl',
];

const SUSPICIOUS_SAMPLES = ['olx-fan.blogspot.com', 'facebook-six-ivory.vercel.app', 'allegro.cam', 'paypalcointrade.com'];

module.exports = { LEGIT_SAMPLES, SUSPICIOUS_SAMPLES };

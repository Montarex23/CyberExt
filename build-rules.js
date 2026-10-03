#!/usr/bin/env node

/**
 * ============================================================================
 * CyberGuard — Blocklist Builder (build-rules.js)
 * ============================================================================
 *
 * A standalone Node.js script designed to be run by a developer before packing
 * the extension. It:
 *
 *   1. Mocks fetching domain lists from sources like OpenPhish or URLhaus.
 *   2. Parses the domains from raw TXT/CSV-style data.
 *   3. Normalizes, deduplicates, and validates the domains.
 *   4. Generates the final  rules.json  file in the declarativeNetRequest
 *      format required by Manifest V3 (using the "redirect" action).
 *
 * Usage:
 *   node build-rules.js              → writes ./rules.json
 *   node build-rules.js --out dist/  → writes ./dist/rules.json
 *
 * To add real feeds, replace the mock functions with actual HTTP fetches.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Path to the warning page inside the extension. */
const WARNING_PAGE = '/warning.html';

/** Maximum rules allowed by Chrome's declarativeNetRequest static ruleset. */
const MAX_STATIC_RULES = 30000;

/** Output path — can be overridden with --out flag. */
let outputDir = __dirname;

// Parse CLI args.
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
if (outIdx !== -1 && args[outIdx + 1]) {
  outputDir = path.resolve(args[outIdx + 1]);
}

const OUTPUT_FILE = path.join(outputDir, 'rules.json');

// ---------------------------------------------------------------------------
// Mock Feed Sources
// ---------------------------------------------------------------------------
// In production, replace these with real HTTP requests (e.g., using node-fetch
// or the built-in `fetch` in Node 18+).
// ---------------------------------------------------------------------------

/**
 * Simulates fetching a TXT-format domain list (one domain per line).
 * Mimics the format used by OpenPhish.
 *
 * @returns {Promise<string>}  Raw text content.
 */
async function fetchOpenPhishMock() {
  console.log('[build-rules] Fetching mock OpenPhish feed...');
  return `
# OpenPhish Community Feed (mock)
# Last updated: 2025-01-15
http://evil-phishing-site.com/login
https://fake-bank-login.net/secure/auth
http://stealyourcreds.xyz/
https://phishy-paypal.com/signin
http://malware-download.org/update.exe
https://login-appleid-verify.com/
http://secure-amazon-check.net/account
https://microsoft-alert-center.com/verify
http://crypto-wallet-restore.xyz/seed
https://netflix-payment-update.org/billing
  `.trim();
}

/**
 * Simulates fetching a CSV-format domain list.
 * Mimics the format used by URLhaus.
 *
 * @returns {Promise<string>}  Raw CSV content.
 */
async function fetchURLhausMock() {
  console.log('[build-rules] Fetching mock URLhaus feed...');
  return `
# URLhaus Database Dump (mock)
# Columns: id,dateadded,url,url_status,threat,tags
1,"2025-01-10","http://banking-secure-login.com/phish","online","phishing","banker"
2,"2025-01-10","https://update-your-account.net/verify","online","phishing","generic"
3,"2025-01-11","http://docs-google-share.xyz/view","online","phishing","google"
4,"2025-01-11","https://free-gift-cards.org/claim","online","malware","scam"
5,"2025-01-12","http://helpdesk-microsoft.com/reset","online","phishing","microsoft"
6,"2025-01-12","http://evil-phishing-site.com/other-page","online","phishing","generic"
  `.trim();
}

// ---------------------------------------------------------------------------
// Parsing Utilities
// ---------------------------------------------------------------------------

/**
 * Extracts and normalizes a domain from a URL string or raw domain line.
 *
 * @param {string} raw  A URL or bare domain.
 * @returns {string|null}  The cleaned domain, or null if invalid.
 */
function extractDomain(raw) {
  let cleaned = raw.trim();

  // Skip comments and empty lines.
  if (!cleaned || cleaned.startsWith('#')) return null;

  // Try to parse as a URL to extract the hostname.
  try {
    // If it doesn't look like a URL, prepend a scheme so URL() can parse it.
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
      cleaned = 'http://' + cleaned;
    }
    const url = new URL(cleaned);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');

    // Basic domain validation: must have at least one dot.
    if (!domain.includes('.')) return null;
    // Reject IP addresses (simple heuristic).
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return null;

    return domain;
  } catch {
    return null;
  }
}

/**
 * Parses a TXT-format feed (one URL/domain per line).
 *
 * @param {string} rawText  The raw feed content.
 * @returns {string[]}  Array of cleaned domain strings.
 */
function parseTxtFeed(rawText) {
  return rawText
    .split('\n')
    .map(extractDomain)
    .filter(Boolean);
}

/**
 * Parses a CSV-format feed (URL in the 3rd column).
 *
 * @param {string} rawCsv  The raw CSV content.
 * @returns {string[]}  Array of cleaned domain strings.
 */
function parseCsvFeed(rawCsv) {
  return rawCsv
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      // Naive CSV split — good enough for this mock format.
      const columns = line.split(',').map((col) => col.replace(/"/g, '').trim());
      const urlCol = columns[2]; // 3rd column is the URL.
      return urlCol ? extractDomain(urlCol) : null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Rule Generation
// ---------------------------------------------------------------------------

/**
 * Converts an array of unique domains into declarativeNetRequest rule objects.
 *
 * @param {string[]} domains  Deduplicated domain list.
 * @returns {object[]}  Array of rule objects ready for rules.json.
 */
function generateRules(domains) {
  return domains.map((domain, index) => ({
    id: index + 1, // Rule IDs must be positive integers, starting at 1.
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: `${WARNING_PAGE}?domain=${encodeURIComponent(domain)}`,
      },
    },
    condition: {
      // The "||" prefix tells declarativeNetRequest to match the domain
      // at any position in the URL (subdomain-inclusive).
      urlFilter: `||${domain}`,
      resourceTypes: ['main_frame'],
    },
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log(' CyberGuard — Blocklist Builder');
  console.log('='.repeat(60));

  // 1. Fetch all feeds (in parallel).
  const [openPhishRaw, urlhausRaw] = await Promise.all([
    fetchOpenPhishMock(),
    fetchURLhausMock(),
  ]);

  // 2. Parse each feed.
  const openPhishDomains = parseTxtFeed(openPhishRaw);
  const urlhausDomains = parseCsvFeed(urlhausRaw);

  console.log(`[build-rules] OpenPhish domains parsed: ${openPhishDomains.length}`);
  console.log(`[build-rules] URLhaus  domains parsed:  ${urlhausDomains.length}`);

  // 3. Merge & deduplicate.
  const allDomains = [...openPhishDomains, ...urlhausDomains];
  const uniqueDomains = [...new Set(allDomains)].sort();

  console.log(`[build-rules] Total unique domains: ${uniqueDomains.length}`);

  // 4. Enforce Chrome's static rule limit.
  if (uniqueDomains.length > MAX_STATIC_RULES) {
    console.warn(
      `[build-rules] ⚠ Domain count (${uniqueDomains.length}) exceeds the ` +
      `static rule limit (${MAX_STATIC_RULES}). Truncating.`
    );
    uniqueDomains.length = MAX_STATIC_RULES;
  }

  // 5. Generate the rules.
  const rules = generateRules(uniqueDomains);

  // 6. Write rules.json.
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(rules, null, 2), 'utf-8');

  console.log(`[build-rules] ✔ Wrote ${rules.length} rules to: ${OUTPUT_FILE}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('[build-rules] Fatal error:', err);
  process.exit(1);
});

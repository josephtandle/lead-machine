#!/usr/bin/env node
/**
 * find-leads.mjs : zero-dependency lead finder
 *
 * Given a target-demographic description, finds N real businesses with a
 * public contact route (email, contact page, or booking link).
 *
 * Usage:
 *   node scripts/find-leads.mjs --who "wedding photographers in Austin Texas" --count 25
 *   node scripts/find-leads.mjs --who "..." --count 10 --exclude data/already-found.csv --out data/leads.csv --json
 *
 * Requirements: Node 18+. No npm dependencies. No required API keys.
 * Optional env: EXA_API_KEY, BRAVE_API_KEY (used automatically if present).
 */

import { writeFile, appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Setup / paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..'); // .../lead-machine
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const GLOBAL_BUDGET_MS = 4 * 60 * 1000; // ~4 minutes soft cap
const MAX_DOMAIN_FETCHES = 120;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const startedAt = Date.now();
function timeLeft() {
  return GLOBAL_BUDGET_MS - (Date.now() - startedAt);
}
function budgetExhausted() {
  return timeLeft() <= 0;
}

function log(...args) {
  console.error('[find-leads]', ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { count: 25, json: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--who') {
      args.who = argv[++i];
      if (!args.who) args.errors.push('--who needs a target description');
    } else if (a === '--count') {
      const value = argv[++i];
      if (!/^[1-9]\d*$/.test(value || '')) {
        args.errors.push('--count must be a whole number from 1 to 120');
      } else {
        args.count = Number(value);
      }
    } else if (a === '--exclude') {
      args.exclude = argv[++i];
      if (!args.exclude) args.errors.push('--exclude needs a CSV path');
    } else if (a === '--out') {
      args.out = argv[++i];
      if (!args.out) args.errors.push('--out needs a CSV path');
    }
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args.errors.push(`unknown argument: ${a}`);
  }
  if (args.count > MAX_DOMAIN_FETCHES) {
    args.errors.push(`--count cannot exceed ${MAX_DOMAIN_FETCHES}, the per-run fetch limit`);
  }
  return args;
}

function printHelp() {
  console.error(`
find-leads.mjs : find real businesses with a public contact route

Usage:
  node scripts/find-leads.mjs --who "<target demographic>" [--count 25] [--exclude data/already-found.csv] [--out data/leads-YYYY-MM-DD.csv] [--json]

Examples:
  node scripts/find-leads.mjs --who "wedding photographers in Austin Texas" --count 25
  node scripts/find-leads.mjs --who "independent bookkeepers in Manchester UK" --count 10 --json

Optional environment variables (auto-detected, never required):
  EXA_API_KEY    - use Exa /search with contents as an extra search source
  BRAVE_API_KEY  - use Brave Search API as an extra search source
`);
}

// ---------------------------------------------------------------------------
// Blocklist of directories / aggregators / social platforms
// ---------------------------------------------------------------------------

const BLOCKED_DOMAINS = [
  'yelp.com', 'thumbtack.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'yellowpages.com', 'bark.com', 'clutch.co', 'upwork.com', 'fiverr.com',
  'reddit.com', 'quora.com', 'wikipedia.org', 'amazon.com', 'google.com',
  'youtube.com', 'tripadvisor.com', 'indeed.com', 'glassdoor.com', 'zillow.com',
  'houzz.com', 'weddingwire.com', 'theknot.com', 'angi.com', 'bbb.org',
  'mapquest.com', 'crunchbase.com', 'pinterest.com', 'twitter.com', 'x.com',
  'tiktok.com', 'nextdoor.com', 'yell.com', 'foursquare.com', 'trustpilot.com',
  'manta.com', 'alignable.com', 'superpages.com', 'chamberofcommerce.com',
  'craigslist.org', 'gumtree.com', 'checkatrade.com', 'mybuilder.com',
  'freeindex.co.uk', 'thomsonlocal.com', 'apple.com', 'microsoft.com',
  'bing.com', 'duckduckgo.com', 'wix.com', 'squarespace.com', 'godaddy.com',
  'wordpress.com', 'blogspot.com', 'medium.com', 'eventbrite.com', 'meetup.com',
  'etsy.com', 'ebay.com', 'shopify.com', 'trustedbusinesses.com', 'expertise.com',
  'reviewsolicitors.co.uk',
];

const BLOCKED_BRANDS = new Set(
  BLOCKED_DOMAINS.map((b) => b.split('.')[0]).filter((root) => root.length >= 4)
);

function isBlockedDomain(domain) {
  const d = domain.toLowerCase();
  if (BLOCKED_DOMAINS.some((b) => d === b || d.endsWith('.' + b))) return true;
  // Country editions of the same directories (houzz.com.au, yelp.co.uk, ...).
  const labels = d.split('.');
  return labels.length >= 2 && BLOCKED_BRANDS.has(labels[0]);
}

function canonicalDomain(hostname) {
  // Keep every hostname label except a cosmetic www prefix. A partial public-suffix
  // list would collapse unrelated businesses such as a.co.jp and b.co.jp.
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

function buildQueries(who) {
  const base = who.trim();
  const variants = [
    `${base}`,
    `${base} contact`,
    `${base} website`,
    `${base} "get in touch"`,
    `${base} email`,
    `${base} "book now"`,
    `${base} near me`,
    `${base} official site`,
    `${base} small business`,
    `${base} local`,
  ];
  // Dedupe while preserving order.
  const seen = new Set();
  const out = [];
  for (const v of variants) {
    const key = v.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out.slice(0, 10);
}

const GENERIC_TARGET_TERMS = new Set([
  'business', 'company', 'companies', 'service', 'services', 'professional',
  'professionals', 'consultant', 'consultants', 'solicitor', 'solicitors',
  'lawyer', 'lawyers', 'attorney', 'attorneys', 'agency', 'agencies', 'local',
]);

function targetTerms(who) {
  const terms = who.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const specific = terms.filter((term) => !GENERIC_TARGET_TERMS.has(term));
  return [...new Set(specific.length > 0 ? specific : terms)];
}

// "wedding photographers in Austin Texas" -> niche "wedding photographers", place "austin texas".
function splitWho(who) {
  const m = who.match(/^(.*?)\s+(?:in|near|around|based in|from)\s+(.+)$/i);
  if (!m) return { niche: who, place: '' };
  return { niche: m[1], place: m[2] };
}

function placeTerms(place) {
  const raw = place.toLowerCase().match(/[a-z]{2,}/g) || [];
  return [...new Set(raw.filter((t) => !['the', 'and', 'area', 'region', 'greater'].includes(t)))];
}

function isRelevantToTarget(name, description, homepageHtml, who, domain = '') {
  const { niche, place } = splitWho(who);
  const terms = targetTerms(niche);
  const text = `${domain} ${name} ${description} ${visibleText(homepageHtml)}`.toLowerCase();
  if (terms.length > 0 && !terms.some((term) => text.includes(term))) return false;
  // When the person named a place, the business has to mention it somewhere on
  // its own site (or in its domain). Stops a Brisbane search returning Bucharest.
  const places = placeTerms(place);
  if (places.length > 0 && !places.some((t) => text.includes(t))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function readResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchTextWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const res = await fetch(currentUrl, {
        ...opts,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(opts.headers || {}),
        },
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) {
        return { status: res.status, text: await readResponseText(res) };
      }
      const location = res.headers.get('location');
      if (!location) return { status: res.status, text: '' };
      const nextUrl = new URL(location, currentUrl);
      if (!['http:', 'https:'].includes(nextUrl.protocol) || !isPublicHostname(nextUrl.hostname)) {
        throw new Error('redirected to a non-public address');
      }
      currentUrl = nextUrl.toString();
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextRetryOnce(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchTextWithTimeout(url, opts, timeoutMs);
      if (response.status === 200) {
        return response.text;
      }
      if (attempt === 0) {
        await sleep(jitter(500, 1000));
        continue;
      }
      return null;
    } catch (e) {
      if (attempt === 0) {
        await sleep(jitter(500, 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search sources
// ---------------------------------------------------------------------------

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function cleanUrlTail(url) {
  // Strip trailing junk that regex matches sometimes pick up from HTML/JS
  // blobs: escaped quotes, real quotes, commas, semicolons, backslashes,
  // closing parens with no matching open, and stray & fragments.
  let out = url;
  let prev;
  do {
    prev = out;
    out = out
      .replace(/(&quot;|&#34;|&#039;|&amp;quot;)+$/i, '')
      .replace(/["'`,;)\\]+$/g, '')
      .trim();
  } while (out !== prev && out.length > 0);
  return out;
}

function extractDdgResultUrls(html) {
  const urls = [];
  // DuckDuckGo HTML endpoint wraps result links like:
  // <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=<encoded>&...">
  const re = /<a\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attributes = m[1];
    if (!/\bclass=["'][^"']*\bresult__a\b/i.test(attributes)) continue;
    const hrefMatch = attributes.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    let href = decodeEntities(hrefMatch[1]);
    try {
      if (href.startsWith('//')) href = 'https:' + href;
      const u = new URL(href, 'https://duckduckgo.com');
      const uddg = u.searchParams.get('uddg');
      if (uddg) {
        urls.push(uddg);
      } else if (/^https?:\/\//.test(href)) {
        urls.push(href);
      }
    } catch {
      // ignore malformed URL
    }
  }
  return urls;
}

async function searchDuckDuckGo(query) {
  const url = 'https://html.duckduckgo.com/html/';
  const body = new URLSearchParams({ q: query }).toString();
  const html = await fetchTextRetryOnce(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://duckduckgo.com/',
      },
      body,
    },
    FETCH_TIMEOUT_MS
  );
  if (!html) return [];
  return extractDdgResultUrls(html);
}

async function searchExa(query) {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  try {
    const response = await fetchTextWithTimeout(
      'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({ query, numResults: 10, contents: { text: false } }),
      },
      FETCH_TIMEOUT_MS
    );
    if (response.status !== 200) return [];
    const data = JSON.parse(response.text);
    return (data.results || []).map((r) => r.url).filter(Boolean);
  } catch {
    return [];
  }
}

async function searchBrave(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  try {
    const response = await fetchTextWithTimeout(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': key } },
      FETCH_TIMEOUT_MS
    );
    if (response.status !== 200) return [];
    const data = JSON.parse(response.text);
    return (data.web?.results || []).map((r) => r.url).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Page fetch + extraction
// ---------------------------------------------------------------------------

const BAD_EMAIL_PATTERNS = [
  /example\.(com|org|net)$/i,
  /sentry\.io$/i,
  /wixpress\.com$/i,
  /noreply@/i,
  /no-reply@/i,
  /privacy@/i,
  /legal@/i,
  /\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /^(postmaster|abuse|dmarc|mailer-daemon)@/i,
  /@(email|domain|yourdomain|yourcompany|company|site|website)\.(com|org|net)$/i,
  /^(name|you|your|user|test|someone|firstname|lastname|first\.last)@/i,
  /\.(js|css|json|woff2?|ttf|eot)$/i,
  /@sentry\./i,
  /@2x\./i,
];

function isJunkEmail(email) {
  const lower = email.toLowerCase();
  if (BAD_EMAIL_PATTERNS.some((re) => re.test(lower))) return true;
  if (lower.includes('sentry') || lower.includes('wixpress')) return true;
  return false;
}

function extractEmailsFromMailto(html) {
  const emails = [];
  const re = /href=["']mailto:([^"'?]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const email = decodeEntities(m[1]).trim();
    if (email) emails.push(email);
  }
  return emails;
}

function extractContactContextEmails(text) {
  const emails = [];
  const re = /(?:contact|e-?mail|enquir(?:y|ies)|write to|reach us)\s*(?:us)?\s*(?:at|:|-)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let match;
  while ((match = re.exec(text)) !== null) emails.push(match[1]);
  return emails;
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ');
}

function decodeObfuscatedEmails(text) {
  // "name [at] domain [dot] com" / "name (at) domain (dot) com" / "name AT domain DOT com"
  const results = [];
  const re =
    /([a-zA-Z0-9._%+-]+)\s*[\[(]?\s*at\s*[\])]?\s*([a-zA-Z0-9.-]+)\s*[\[(]?\s*dot\s*[\])]?\s*([a-zA-Z]{2,})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push(`${m[1]}@${m[2]}.${m[3]}`);
  }
  return results;
}

const COMMON_TLDS = new Set([
  'com', 'org', 'net', 'io', 'co', 'uk', 'us', 'ca', 'au', 'de', 'fr', 'es',
  'it', 'nl', 'se', 'no', 'dk', 'fi', 'ie', 'nz', 'in', 'biz', 'info', 'me',
  'shop', 'store', 'online', 'app', 'dev', 'agency', 'studio', 'club',
  'life', 'live', 'today', 'blog', 'email', 'services', 'company', 'group',
]);

function isPlausibleEmail(email) {
  const m = email.match(/^([^@\s]+)@([^@\s]+)\.([a-zA-Z]+)$/);
  if (!m) return false;
  const [, local, domainBody, tld] = m;
  // Real-world domains are written lowercase; a stray uppercase letter in the
  // domain almost always means a regex false-positive on minified JS
  // (e.g. "specs.stores.FixNavig@ion.sPosition").
  if (/[A-Z]/.test(domainBody) || /[A-Z]/.test(tld)) return false;
  if (tld.length > 10 && !COMMON_TLDS.has(tld.toLowerCase())) return false;
  if (local.length > 64 || domainBody.length > 63) return false;
  // Reject domains that are just a single short token with no dot-separated
  // structure resembling a real hostname (already required by the regex),
  // and reject obvious code fragments with camelCase-like local parts.
  if (/^[a-z]+\.[a-z]+\.[A-Za-z]/.test(local)) return false;
  return true;
}

function pickBestEmail(candidates) {
  const cleaned = candidates
    .map((e) => e.trim().replace(/^mailto:/i, ''))
    .map((e) => e.split('?')[0])
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(e))
    .filter((e) => isPlausibleEmail(e))
    .filter((e) => !isJunkEmail(e));
  if (cleaned.length === 0) return null;
  // Prefer shorter, non-generic-looking addresses but generic (info@, hello@) is fine for outreach.
  cleaned.sort((a, b) => a.length - b.length);
  return cleaned[0];
}

function extractMeta(html, name) {
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`,
    'i'
  );
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : null;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return null;
  let title = decodeEntities(m[1]).trim();
  // Clean common suffixes like " | Home" or " - Site Name"
  title = title.split(/\s*[|\-–]\s*/)[0].trim();
  return title || null;
}

function trimTo(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len - 1).trim() + '…';
}

function findBookingLink(html, baseUrl) {
  const patterns = [
    /https?:\/\/[^\s"'<>\\]*calendly\.com[^\s"'<>\\]*/i,
    /https?:\/\/[^\s"'<>\\]*tidycal\.com[^\s"'<>\\]*/i,
    /https?:\/\/[^\s"'<>\\]*acuityscheduling\.com[^\s"'<>\\]*/i,
    /https?:\/\/[^\s"'<>\\]*cal\.com[^\s"'<>\\]*/i,
    /https?:\/\/[^\s"'<>\\]*squareup\.com\/appointments[^\s"'<>\\]*/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const cleaned = cleanUrlTail(decodeEntities(m[0]));
      try {
        return new URL(cleaned).toString();
      } catch {
        continue;
      }
    }
  }
  // "book" link fallback : scan all anchors containing "book" and return the
  // first one that is an actual navigable link (not mailto/tel/js/anchor).
  const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*book[^<]*)<\/a>/gi;
  let am;
  while ((am = anchorRe.exec(html)) !== null) {
    const href = cleanUrlTail(decodeEntities(am[1]));
    if (!isNavigableHref(href)) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function isNavigableHref(href) {
  if (!href) return false;
  const h = href.trim().toLowerCase();
  if (h === '' || h === '#') return false;
  if (
    h.startsWith('javascript:') ||
    h.startsWith('mailto:') ||
    h.startsWith('tel:') ||
    h.startsWith('#')
  ) {
    return false;
  }
  try {
    const url = new URL(href, 'https://example.invalid');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    return !(
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return host !== '::1' && !host.startsWith('fe80:') && !host.startsWith('fc') && !host.startsWith('fd');
}

function findContactPageLink(html, baseUrl) {
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = decodeEntities(m[2]).toLowerCase();
    const href = cleanUrlTail(decodeEntities(m[1]));
    if (/contact|get in touch|reach us|enquir/i.test(text) && isNavigableHref(href)) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function fetchPageSafe(url) {
  try {
    const html = await fetchTextRetryOnce(url, {}, FETCH_TIMEOUT_MS);
    return html;
  } catch {
    return null;
  }
}

const CONTACT_PATHS = ['/contact', '/contact-us', '/about', '/about-us'];

async function extractLeadFromDomain(domain, sourceQuery, who = sourceQuery) {
  if (!isPublicHostname(domain)) return null;
  const homepageUrl = `https://${domain}/`;
  let homepageHtml = await fetchPageSafe(homepageUrl);
  let baseUrl = homepageUrl;
  if (!homepageHtml) {
    // try without https in case of cert issues -> try http
    homepageHtml = await fetchPageSafe(`http://${domain}/`);
    baseUrl = `http://${domain}/`;
  }
  if (!homepageHtml) return null;

  const name =
    extractMeta(homepageHtml, 'og:site_name') || extractTitle(homepageHtml) || domain;
  const description =
    extractMeta(homepageHtml, 'og:description') ||
    extractMeta(homepageHtml, 'description') ||
    '';
  if (!isRelevantToTarget(name, description, homepageHtml, who, domain)) return null;

  let emailCandidates = extractEmailsFromMailto(homepageHtml);
  let bookingLink = findBookingLink(homepageHtml, baseUrl);
  let contactPageUrl = findContactPageLink(homepageHtml, baseUrl);

  // Try known contact/about paths if we don't yet have an email.
  let pagesChecked = [homepageHtml];
  if (pickBestEmail(emailCandidates) === null) {
    for (const p of CONTACT_PATHS) {
      if (budgetExhausted()) break;
      let pageUrl;
      try {
        pageUrl = new URL(p, baseUrl).toString();
      } catch {
        continue;
      }
      const html = await fetchPageSafe(pageUrl);
      if (!html) continue;
      pagesChecked.push(html);
      emailCandidates = emailCandidates.concat(extractEmailsFromMailto(html));
      if (!bookingLink) bookingLink = findBookingLink(html, pageUrl);
      if (!contactPageUrl && /contact/i.test(p)) contactPageUrl = pageUrl;
      if (pickBestEmail(emailCandidates) !== null) break;
    }
  }

  let bestEmail = pickBestEmail(emailCandidates);

  // Fall back to rendered emails labelled as a contact route, then obfuscation decode.
  // This avoids treating an email in a testimonial, example, or embedded vendor widget
  // as the business's public contact address.
  if (!bestEmail) {
    for (const html of pagesChecked) {
      const regexEmails = extractContactContextEmails(visibleText(html));
      bestEmail = pickBestEmail(regexEmails);
      if (bestEmail) break;
    }
  }
  if (!bestEmail) {
    for (const html of pagesChecked) {
      const obfuscated = decodeObfuscatedEmails(visibleText(html));
      bestEmail = pickBestEmail(obfuscated);
      if (bestEmail) break;
    }
  }

  const qualifies = Boolean(bestEmail) || Boolean(contactPageUrl) || Boolean(bookingLink);
  if (!qualifies) return null;

  return {
    name: trimTo(name, 80),
    what_they_do: trimTo(description, 140),
    website: baseUrl,
    email: bestEmail || '',
    contact_page: contactPageUrl || '',
    booking_link: bookingLink || '',
    source_query: sourceQuery,
    domain,
  };
}

function whyFit(lead, who) {
  const terms = targetTerms(who).slice(0, 6);
  const desc = (lead.what_they_do || '').toLowerCase();
  const matched = terms.filter((t) => desc.includes(t));
  if (matched.length > 0) {
    return `Matches "${matched.join(', ')}" in their own description`;
  }
  return `Found via search for "${lead.source_query}"`;
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function runPool(items, worker, concurrency) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const myIdx = idx++;
      if (budgetExhausted()) return;
      const item = items[myIdx];
      try {
        const r = await worker(item, myIdx);
        results.push(r);
      } catch {
        results.push(null);
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

async function loadExcludeSet(excludePath) {
  const domains = new Set();
  const emails = new Set();
  if (!excludePath) return { domains, emails };
  const resolved = path.isAbsolute(excludePath)
    ? excludePath
    : path.resolve(process.cwd(), excludePath);
  if (!existsSync(resolved)) return { domains, emails };
  const content = await readFile(resolved, 'utf8');
  const rows = parseCsv(content);
  if (rows.length === 0) return { domains, emails };
  const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/^\uFEFF/, ''));
  const domainIndex = headers.indexOf('domain');
  const websiteIndex = headers.indexOf('website');
  const emailIndex = headers.indexOf('email');
  for (const row of rows.slice(1)) {
    let domain = domainIndex >= 0 ? row[domainIndex] : '';
    if (!domain && websiteIndex >= 0 && row[websiteIndex]) {
      try {
        domain = canonicalDomain(new URL(row[websiteIndex]).hostname);
      } catch {
        domain = '';
      }
    }
    const email = emailIndex >= 0 ? row[emailIndex] : '';
    if (domain) domains.add(domain.trim().toLowerCase().replace(/^www\./, ''));
    if (email) emails.add(email.trim().toLowerCase());
  }
  return { domains, emails };
}

async function appendAlreadyFound(rows) {
  const filePath = path.join(DATA_DIR, 'already-found.csv');
  await mkdir(DATA_DIR, { recursive: true });
  const needsHeader = !existsSync(filePath);
  const lines = [];
  if (needsHeader) lines.push('domain,email,found_at');
  const now = new Date().toISOString();
  for (const r of rows) {
    lines.push(`${csvEscape(r.domain)},${csvEscape(r.email)},${csvEscape(now)}`);
  }
  await appendFile(filePath, lines.join('\n') + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.who || args.errors.length > 0) {
    for (const error of args.errors) console.error(`[find-leads] ${error}`);
    if (!args.who) console.error('[find-leads] --who needs a target description');
    printHelp();
    return 2;
  }

  const targetCount = args.count;
  log(`target: "${args.who}" | count: ${targetCount}`);

  const excludePath = args.exclude || path.join(DATA_DIR, 'already-found.csv');
  const { domains: excludedDomains, emails: excludedEmails } = await loadExcludeSet(excludePath);
  if (excludedDomains.size > 0) {
    log(`loaded ${excludedDomains.size} excluded domains from ${excludePath}`);
  }

  const queries = buildQueries(args.who);
  log(`generated ${queries.length} query variants`);

  const seenDomains = new Set(excludedDomains);
  const candidateQueue = []; // { domain, sourceQuery }
  const qualifiedLeads = [];
  let domainFetchCount = 0;

  for (const query of queries) {
    if (qualifiedLeads.length >= targetCount) break;
    if (budgetExhausted()) {
      log('global time budget reached during search phase');
      break;
    }

    log(`searching: ${query}`);
    let urls = [];
    try {
      urls = await searchDuckDuckGo(query);
    } catch (e) {
      log(`ddg search failed for "${query}": ${e.message}`);
    }

    // Optional extra sources, auto-detected.
    const [exaUrls, braveUrls] = await Promise.all([
      searchExa(query).catch(() => []),
      searchBrave(query).catch(() => []),
    ]);
    urls = urls.concat(exaUrls, braveUrls);

    log(`  -> ${urls.length} raw results`);

    for (const rawUrl of urls) {
      let hostname;
      try {
        hostname = new URL(rawUrl).hostname;
      } catch {
        continue;
      }
      const domain = canonicalDomain(hostname);
      if (!domain || isBlockedDomain(domain)) continue;
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      candidateQueue.push({ domain, sourceQuery: query });
    }

    // Polite delay between search requests.
    await sleep(jitter(600, 1200));

    // Process candidates found so far in batches so we can stop as soon as
    // we have enough qualified leads, without over-fetching.
    while (
      candidateQueue.length > 0 &&
      qualifiedLeads.length < targetCount &&
      domainFetchCount < MAX_DOMAIN_FETCHES &&
      !budgetExhausted()
    ) {
      const batchSize = Math.min(
        CONCURRENCY,
        candidateQueue.length,
        targetCount - qualifiedLeads.length + 2,
        MAX_DOMAIN_FETCHES - domainFetchCount
      );
      const batch = candidateQueue.splice(0, batchSize);
      domainFetchCount += batch.length;
      log(`  fetching ${batch.length} domain(s) (total fetched: ${domainFetchCount})`);

      const results = await runPool(
        batch,
        async ({ domain, sourceQuery }) => {
          const lead = await extractLeadFromDomain(domain, sourceQuery, args.who);
          return lead;
        },
        CONCURRENCY
      );

      for (const lead of results) {
        if (!lead) continue;
        if (lead.email && excludedEmails.has(lead.email.toLowerCase())) continue;
        lead.why_fit = whyFit(lead, args.who);
        qualifiedLeads.push(lead);
        log(`  qualified: ${lead.domain} (${lead.email || lead.contact_page || lead.booking_link})`);
        if (qualifiedLeads.length >= targetCount) break;
      }
    }

    if (domainFetchCount >= MAX_DOMAIN_FETCHES) {
      log('reached max domain fetch limit');
      break;
    }
  }

  const hitBudget = budgetExhausted();
  const runtimeMs = Date.now() - startedAt;

  if (qualifiedLeads.length === 0) {
    console.error(
      `[find-leads] No qualified leads found for "${args.who}". Try a more specific --who (add a city, niche, or narrower service term).`
    );
    return 2;
  }

  const finalLeads = qualifiedLeads.slice(0, targetCount).map((lead, i) => ({
    n: i + 1,
    name: lead.name,
    what_they_do: lead.what_they_do,
    website: lead.website,
    email: lead.email,
    contact_page: lead.contact_page,
    booking_link: lead.booking_link,
    why_fit: lead.why_fit,
    source_query: lead.source_query,
  }));

  // Determine output path.
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = args.out
    ? path.isAbsolute(args.out)
      ? args.out
      : path.resolve(process.cwd(), args.out)
    : path.join(DATA_DIR, `leads-${dateStr}.csv`);

  await mkdir(path.dirname(outPath), { recursive: true });
  const headers = [
    'n',
    'name',
    'what_they_do',
    'website',
    'email',
    'contact_page',
    'booking_link',
    'why_fit',
    'source_query',
  ];
  await writeFile(outPath, toCsv(finalLeads, headers), 'utf8');

  await appendAlreadyFound(qualifiedLeads.map((l) => ({ domain: l.domain, email: l.email })));

  log(
    `done: ${finalLeads.length}/${targetCount} leads | ${domainFetchCount} domains fetched | ${(
      runtimeMs / 1000
    ).toFixed(1)}s${hitBudget ? ' | HIT TIME BUDGET, partial results' : ''}`
  );
  log(`wrote ${outPath}`);

  if (args.json) {
    console.log(JSON.stringify(finalLeads, null, 2));
  } else {
    console.log(`\nFound ${finalLeads.length} leads for "${args.who}":\n`);
    for (const lead of finalLeads) {
      console.log(`${lead.n}. ${lead.name}`);
      console.log(`   ${lead.what_they_do}`);
      console.log(`   Website: ${lead.website}`);
      if (lead.email) console.log(`   Email: ${lead.email}`);
      if (lead.contact_page) console.log(`   Contact: ${lead.contact_page}`);
      if (lead.booking_link) console.log(`   Booking: ${lead.booking_link}`);
      console.log(`   Why: ${lead.why_fit}`);
      console.log('');
    }
    console.log(`Saved to: ${outPath}`);
  }

  if (hitBudget || finalLeads.length < targetCount) {
    console.error(
      `[find-leads] Note: returned ${finalLeads.length}/${targetCount} (${
        hitBudget ? 'time budget reached' : 'sources exhausted'
      }). Re-run with --exclude ${path.join('data', 'already-found.csv')} to continue without duplicates.`
    );
  }

  return hitBudget || finalLeads.length < targetCount ? 1 : 0;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((err) => {
    console.error('[find-leads] fatal error:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  });

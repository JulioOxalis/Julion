'use strict';

// ─── Site-wide SEO config ─────────────────────────────────────────────────────
const SITE = {
  name:        'Julion',
  tagline:     'Snapshot, Store & Restore Your Projects',
  description: 'Julion is a developer-native snapshot platform. Seal your projects into portable .on containers, store them on Google Drive, and restore them anywhere with one command.',
  keywords:    'Julion, project snapshots, developer tools, Google Drive backup, code snapshot, restore projects, CLI tools, portable code containers, .on format, seal restore deploy',
  author:      'Julion',
  themeColor:  '#6b7bff',
  twitterSite: '@julion',
  ogImage:     '/images/julion-og.png',
  logo:        '/images/julion-logo.png',
};

// ─── HTML-escape for attribute values ────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── JSON-LD schemas ──────────────────────────────────────────────────────────
function orgSchema(baseUrl) {
  return {
    '@context': 'https://schema.org',
    '@type':    'Organization',
    name:       SITE.name,
    url:        baseUrl,
    logo: {
      '@type': 'ImageObject',
      url:     `${baseUrl}${SITE.logo}`,
      width:   512,
      height:  512
    },
    sameAs: []
  };
}

function websiteSchema(baseUrl) {
  return {
    '@context': 'https://schema.org',
    '@type':    'WebSite',
    name:       SITE.name,
    url:        baseUrl,
    description: SITE.description,
    potentialAction: {
      '@type':      'SearchAction',
      target:       `${baseUrl}/repositories?q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  };
}

function softwareSchema(baseUrl) {
  return {
    '@context':           'https://schema.org',
    '@type':              'SoftwareApplication',
    name:                 SITE.name,
    applicationCategory:  'DeveloperApplication',
    operatingSystem:      'Web, Linux, macOS, Windows',
    url:                  baseUrl,
    description:          SITE.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  };
}

// ─── Core head builder ────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string}   opts.baseUrl       — absolute site root, no trailing slash
 * @param {string}  [opts.title]        — page title (without " · Julion" suffix)
 * @param {string}  [opts.description]  — page description
 * @param {string}  [opts.path]         — URL path, e.g. '/repositories'
 * @param {string}  [opts.robots]       — robots directive
 * @param {string}  [opts.keywords]     — comma-separated keywords
 * @param {string}  [opts.ogType]       — open graph type
 * @param {string}  [opts.ogImage]      — override OG image absolute URL
 * @param {object[]}[opts.extraSchemas] — additional JSON-LD objects
 * @returns {string} raw HTML to place inside <head>
 */
function buildHead({
  baseUrl,
  title,
  description,
  path       = '/',
  robots     = 'index, follow, max-image-preview:large',
  keywords,
  ogType     = 'website',
  ogImage,
  extraSchemas = []
}) {
  const fullTitle  = title ? `${esc(title)} · Julion` : `Julion — ${esc(SITE.tagline)}`;
  const desc       = esc(description || SITE.description);
  const kw         = esc(keywords    || SITE.keywords);
  const canonical  = path === '/' ? baseUrl : `${baseUrl}${path}`;
  const ogImageUrl = ogImage || `${baseUrl}${SITE.ogImage}`;

  const schemas = [
    orgSchema(baseUrl),
    websiteSchema(baseUrl),
    softwareSchema(baseUrl),
    ...extraSchemas
  ];
  const ldScripts = schemas
    .map(s => `  <script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join('\n');

  return `  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${fullTitle}</title>
  <meta name="description" content="${desc}"/>
  <meta name="keywords"    content="${kw}"/>
  <meta name="author"      content="${esc(SITE.author)}"/>
  <meta name="robots"      content="${esc(robots)}"/>
  <meta name="theme-color" content="${SITE.themeColor}"/>
  <meta name="generator"   content="Julion"/>

  <!-- Canonical -->
  <link rel="canonical" href="${esc(canonical)}"/>

  <!-- Open Graph -->
  <meta property="og:type"        content="${esc(ogType)}"/>
  <meta property="og:site_name"   content="${esc(SITE.name)}"/>
  <meta property="og:title"       content="${fullTitle}"/>
  <meta property="og:description" content="${desc}"/>
  <meta property="og:image"        content="${esc(ogImageUrl)}"/>
  <meta property="og:image:type"   content="image/png"/>
  <meta property="og:image:width"  content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:image:alt"    content="${esc(SITE.name)} — ${esc(SITE.tagline)}"/>
  <meta property="og:url"         content="${esc(canonical)}"/>
  <meta property="og:locale"      content="en_US"/>

  <!-- Twitter / X -->
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:site"        content="${esc(SITE.twitterSite)}"/>
  <meta name="twitter:creator"     content="${esc(SITE.twitterSite)}"/>
  <meta name="twitter:title"       content="${fullTitle}"/>
  <meta name="twitter:description" content="${desc}"/>
  <meta name="twitter:image"       content="${esc(ogImageUrl)}"/>
  <meta name="twitter:image:alt"   content="${esc(SITE.name)} — ${esc(SITE.tagline)}"/>

  <!-- Favicons -->
  <link rel="icon"             type="image/x-icon" href="/images/favicon.ico"/>
  <link rel="icon"             type="image/png" sizes="32x32"   href="/images/favicon-32x32.png"/>
  <link rel="icon"             type="image/png" sizes="16x16"   href="/images/favicon-16x16.png"/>
  <link rel="icon"             type="image/png" sizes="192x192" href="/images/android-chrome-192x192.png"/>
  <link rel="icon"             type="image/png" sizes="512x512" href="/images/android-chrome-512x512.png"/>
  <link rel="apple-touch-icon" sizes="180x180"                  href="/images/apple-touch-icon.png"/>
  <link rel="manifest"         href="/manifest.json"/>
  <meta name="msapplication-TileColor"  content="${SITE.themeColor}"/>
  <meta name="msapplication-TileImage" content="/images/ms-icon-144x144.png"/>
  <meta name="msapplication-config"    content="/browserconfig.xml"/>

  <!-- Performance hints -->
  <link rel="preconnect"  href="https://fonts.googleapis.com"/>
  <link rel="preconnect"  href="https://fonts.gstatic.com" crossorigin=""/>
  <link rel="dns-prefetch" href="https://cdn.jsdelivr.net"/>

  <!-- Stylesheet -->
  <link rel="stylesheet" href="/styles.css"/>

${ldScripts}`;
}

// ─── Sitemap entry builder ────────────────────────────────────────────────────
function sitemapUrl(baseUrl, loc, { priority = '0.8', changefreq = 'weekly', lastmod } = {}) {
  const full = loc === '/' ? baseUrl : `${baseUrl}${loc}`;
  const lm   = lastmod || new Date().toISOString().slice(0, 10);
  return `  <url>\n    <loc>${full}</loc>\n    <lastmod>${lm}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function buildSitemap(baseUrl) {
  const entries = [
    sitemapUrl(baseUrl, '/', { priority: '1.0', changefreq: 'weekly' })
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`;
}

// ─── robots.txt builder ───────────────────────────────────────────────────────
function buildRobots(baseUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# Authenticated / private sections',
    'Disallow: /dashboard',
    'Disallow: /repositories',
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /logout',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join('\n');
}

module.exports = { buildHead, buildSitemap, buildRobots, SITE, esc };

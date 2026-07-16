// api/news.js — Vercel Edge Function
// Sports news aggregator: pulls Google News RSS per league/sport, parses via regex
// (no XML lib — same battle-tested approach as ny-sports-daily & nfl-boxscore)

export const config = { runtime: 'edge' };

// ── Known stable Google News Topic IDs ──────────────────────────────────────
// Topic feeds are curated by Google and tend to be cleaner than raw search,
// but IDs can go stale. Confirmed empty for now — everything falls back to
// the search-query pattern proven working on ny-sports-daily/nfl-boxscore.
// Add IDs back here only after confirming with ?debug=1 that they return 200.
const TOPICS = {};

// ── Source list: one entry per sortable category ────────────────────────────
// query: exact-phrase style search used as fallback when no topic ID exists
const SPORTS = [
  // US pro leagues
  { id: 'nfl',  label: 'NFL',  domain: 'sport', region: 'us',     query: '"NFL"' },
  { id: 'nba',  label: 'NBA',  domain: 'sport', region: 'us',     query: '"NBA"' },
  { id: 'mlb',  label: 'MLB',  domain: 'sport', region: 'us',     query: '"MLB" baseball' },
  { id: 'nhl',  label: 'NHL',  domain: 'sport', region: 'us',     query: '"NHL"' },
  { id: 'mls',  label: 'MLS',  domain: 'sport', region: 'us',     query: '"MLS" soccer' },
  { id: 'wnba', label: 'WNBA', domain: 'sport', region: 'us',     query: '"WNBA"' },
  // Global
  { id: 'soccer',  label: 'Soccer',    domain: 'sport', region: 'global', query: '"Premier League" OR "Champions League" OR "La Liga"' },
  { id: 'f1',       label: 'Formula 1', domain: 'sport', region: 'global', query: '"Formula 1" OR F1 racing' },
  { id: 'tennis',   label: 'Tennis',    domain: 'sport', region: 'global', query: 'tennis ATP OR WTA' },
  { id: 'golf',     label: 'Golf',      domain: 'sport', region: 'global', query: '"PGA Tour" golf' },
  { id: 'cricket',  label: 'Cricket',   domain: 'sport', region: 'global', query: 'cricket' },
  { id: 'mma',      label: 'MMA/UFC',   domain: 'sport', region: 'global', query: 'UFC MMA' },
  { id: 'boxing',   label: 'Boxing',    domain: 'sport', region: 'global', query: 'boxing' },
  { id: 'olympics', label: 'Olympics',  domain: 'sport', region: 'global', query: 'Olympics' },
];

// Entertainment/Arts — mirrors the sports list, same Google News pattern
const ARTS = [
  { id: 'movies',   label: 'Movies',   domain: 'entertainment', region: 'us', query: '"box office" OR "movie review" film' },
  { id: 'tv',        label: 'TV',       domain: 'entertainment', region: 'us', query: '"TV series" OR "television show"' },
  { id: 'books',     label: 'Books',    domain: 'entertainment', region: 'us', query: '"new book" OR "bestseller" publishing' },
  { id: 'music',     label: 'Music',    domain: 'entertainment', region: 'us', query: '"new album" OR "music release"' },
  { id: 'broadway',  label: 'Broadway', domain: 'entertainment', region: 'us', query: 'Broadway theater OR musical' },
];

// Combined list — filterable by ?domain= (sport|entertainment) or ?category=<id>
const CATEGORIES = [...SPORTS, ...ARTS];

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#038;/g, '&').replace(/&#8216;/g, "'").replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&#8212;/g, '—').replace(/&#8211;/g, '–').replace(/&#\d+;/g, '');
}
const stripHTML = s => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const clean = s => stripHTML(decodeEntities(s || '')).trim();

async function fetchFeed(url) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function parseGoogleNews(xml, category) {
  const out = [];
  if (!xml) return out;
  const start = xml.indexOf('<item');
  if (start < 0) return out;
  const items = xml.slice(start).match(/<item[\s\S]*?<\/item>/g) || [];
  items.slice(0, 20).forEach(item => {
    const rawTitle =
      item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ||
      item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '';
    // Strip Google's trailing " - Source Name" suffix
    const title = clean(rawTitle).replace(/\s*[-–]\s*[^-–]{1,50}$/, '').trim();
    if (!title) return;

    const link = item.match(/<link>\s*(https?:\/\/[^\s<]+)/i)?.[1]?.trim() || '';
    if (!link.startsWith('http')) return;

    const pub = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    const src = clean(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
    const image =
      item.match(/<media:content[^>]+url="([^"]+)"/i)?.[1] ||
      item.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1] || null;

    out.push({
      title,
      link,
      source: src || 'Google News',
      pub: pub || new Date().toISOString(),
      category,
      image,
    });
  });
  return out;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const categoryFilter = url.searchParams.get('category'); // optional: ?category=nfl
  const domainFilter = url.searchParams.get('domain');     // optional: ?domain=sport | ?domain=entertainment
  const debug = url.searchParams.get('debug') === '1';

  let list = CATEGORIES;
  if (categoryFilter) list = list.filter(c => c.id === categoryFilter);
  if (domainFilter) list = list.filter(c => c.domain === domainFilter);

  if (debug) {
    // Debug mode: fetch just the first matching category and report raw status
    const cat = list[0];
    if (!cat) {
      return new Response(JSON.stringify({ error: 'No matching category' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const rssUrl = TOPICS[cat.id]
      ? `https://news.google.com/rss/topics/${TOPICS[cat.id]}?hl=en-US&gl=US&ceid=US:en`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(cat.query)}&hl=en-US&gl=US&ceid=US:en`;

    let status = null, statusText = null, bodyLength = 0, bodySample = '', fetchError = null;
    try {
      const r = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      status = r.status;
      statusText = r.statusText;
      const text = await r.text();
      bodyLength = text.length;
      bodySample = text.slice(0, 500);
    } catch (e) {
      fetchError = String(e);
    }

    return new Response(
      JSON.stringify({ category: cat.id, rssUrl, status, statusText, bodyLength, bodySample, fetchError }, null, 2),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  const results = await Promise.all(
    list.map(async cat => {
      const rssUrl = TOPICS[cat.id]
        ? `https://news.google.com/rss/topics/${TOPICS[cat.id]}?hl=en-US&gl=US&ceid=US:en`
        : `https://news.google.com/rss/search?q=${encodeURIComponent(cat.query)}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await fetchFeed(rssUrl);
      return parseGoogleNews(xml, cat.id).map(a => ({ ...a, domain: cat.domain }));
    })
  );

  // Flatten, dedupe by title, sort newest first
  const seen = new Set();
  const articles = results.flat().filter(a => {
    if (seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  }).sort((a, b) => new Date(b.pub || 0) - new Date(a.pub || 0));

  return new Response(
    JSON.stringify({ articles, count: articles.length, timestamp: new Date().toISOString() }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    }
  );
}

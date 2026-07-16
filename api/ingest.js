// api/ingest.js — Vercel Node Function (not edge — needs @supabase/supabase-js
// and may run longer than edge's limits for 19 sequential-ish fetches)
//
// Pulls every category from Google News RSS and writes results into
// news_hub.articles using the service_role key (bypasses RLS by design —
// this is the one piece allowed to write; the front end is read-only).
//
// Trigger this either via:
//   - Vercel Cron (vercel.json, once/day on the free Hobby plan), or
//   - A free external scheduler (e.g. cron-job.org) hitting this URL hourly
//     for more frequent updates without needing a paid Vercel plan.
//
// If CRON_SECRET is set as an env var, requests must include it as
// ?secret=... or an "Authorization: Bearer <secret>" header — keeps random
// visitors from triggering writes. Optional: leave CRON_SECRET unset to skip.

import { createClient } from '@supabase/supabase-js';

const TOPICS = {};

const SPORTS = [
  { id: 'nfl',  label: 'NFL',  domain: 'sport', region: 'us',     query: '"NFL"' },
  { id: 'nba',  label: 'NBA',  domain: 'sport', region: 'us',     query: '"NBA"' },
  { id: 'mlb',  label: 'MLB',  domain: 'sport', region: 'us',     query: '"MLB" baseball' },
  { id: 'nhl',  label: 'NHL',  domain: 'sport', region: 'us',     query: '"NHL"' },
  { id: 'mls',  label: 'MLS',  domain: 'sport', region: 'us',     query: '"MLS" soccer' },
  { id: 'wnba', label: 'WNBA', domain: 'sport', region: 'us',     query: '"WNBA"' },
  { id: 'soccer',  label: 'Soccer',    domain: 'sport', region: 'global', query: '"Premier League" OR "Champions League" OR "La Liga"' },
  { id: 'f1',       label: 'Formula 1', domain: 'sport', region: 'global', query: '"Formula 1" OR F1 racing' },
  { id: 'tennis',   label: 'Tennis',    domain: 'sport', region: 'global', query: 'tennis ATP OR WTA' },
  { id: 'golf',     label: 'Golf',      domain: 'sport', region: 'global', query: '"PGA Tour" golf' },
  { id: 'cricket',  label: 'Cricket',   domain: 'sport', region: 'global', query: 'cricket' },
  { id: 'mma',      label: 'MMA/UFC',   domain: 'sport', region: 'global', query: 'UFC MMA' },
  { id: 'boxing',   label: 'Boxing',    domain: 'sport', region: 'global', query: 'boxing' },
  { id: 'olympics', label: 'Olympics',  domain: 'sport', region: 'global', query: 'Olympics' },
];

const ARTS = [
  { id: 'movies',   label: 'Movies',   domain: 'entertainment', region: 'us', query: '"box office" OR "movie review" film' },
  { id: 'tv',        label: 'TV',       domain: 'entertainment', region: 'us', query: '"TV series" OR "television show"' },
  { id: 'books',     label: 'Books',    domain: 'entertainment', region: 'us', query: '"new book" OR "bestseller" publishing' },
  { id: 'music',     label: 'Music',    domain: 'entertainment', region: 'us', query: '"new album" OR "music release"' },
  { id: 'broadway',  label: 'Broadway', domain: 'entertainment', region: 'us', query: 'Broadway theater OR musical' },
];

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
    const title = clean(rawTitle).replace(/\s*[-–]\s*[^-–]{1,50}$/, '').trim();
    if (!title) return;

    const link = item.match(/<link>\s*(https?:\/\/[^\s<]+)/i)?.[1]?.trim() || '';
    if (!link.startsWith('http')) return;

    const pub = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    const src = clean(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
    const image =
      item.match(/<media:content[^>]+url="([^"]+)"/i)?.[1] ||
      item.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1] || null;

    out.push({ title, link, source: src || 'Google News', pub, category, image });
  });
  return out;
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided =
      req.query?.secret ||
      (req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars on the server' });
  }
  const supabase = createClient(supabaseUrl, serviceKey, { db: { schema: 'news_hub' } });

  const perCategory = [];
  let totalFetched = 0;
  let totalUpserted = 0;
  const errors = [];

  for (const cat of CATEGORIES) {
    const rssUrl = TOPICS[cat.id]
      ? `https://news.google.com/rss/topics/${TOPICS[cat.id]}?hl=en-US&gl=US&ceid=US:en`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(cat.query)}&hl=en-US&gl=US&ceid=US:en`;

    const xml = await fetchFeed(rssUrl);
    const items = parseGoogleNews(xml, cat.id);
    totalFetched += items.length;

    if (items.length === 0) {
      perCategory.push({ category: cat.id, fetched: 0, upserted: 0 });
      continue;
    }

    const rows = items.map(a => ({
      title: a.title,
      link: a.link,
      source: a.source,
      category: a.category,
      domain: cat.domain,
      region: cat.region,
      image: a.image,
      published_at: a.pub ? new Date(a.pub).toISOString() : null,
    }));

    const { data, error } = await supabase
      .from('articles')
      .upsert(rows, { onConflict: 'title,category', ignoreDuplicates: true })
      .select('id');

    if (error) {
      errors.push({ category: cat.id, error: error.message });
      perCategory.push({ category: cat.id, fetched: items.length, upserted: 0, error: error.message });
    } else {
      const upserted = data?.length || 0;
      totalUpserted += upserted;
      perCategory.push({ category: cat.id, fetched: items.length, upserted });
    }
  }

  // Prune anything older than 14 days so the table doesn't grow forever
  await supabase.rpc('prune_old_articles').catch(() => {});

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    totalFetched,
    totalUpserted,
    perCategory,
    errors,
  });
}

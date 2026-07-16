# Sports & Arts Daily

Sports and arts/entertainment news dashboard. Pulls headlines via Google News RSS
(`api/news.js`), stores them in Supabase (`news_hub.articles`), and the front end
reads from Supabase — it does not hit Google directly on page load.

## What's already done
- ✅ Vite + React scaffold, `@supabase/supabase-js` installed
- ✅ `api/news.js` — Vercel Edge Function, pulls 19 categories (14 sports + 5 arts)
      from Google News RSS. Supports `?domain=sport|entertainment` and `?category=nfl`.
- ✅ `supabase/schema.sql` — already run against the shared `fnxoucliekhotvartyfu`
      project. `news_hub.articles` table exists with RLS (public read only).
- ✅ `.env.local` — pre-filled with the Supabase URL + anon key (gitignored, safe).
- ✅ Front end (`src/App.jsx`, `src/index.css`) — Sports/Arts toggle, category
      pills, headline list, reads live from `news_hub.articles`.

## What's left to do

### 1. Push to GitHub
```bash
cd sports-arts-daily
git init
git remote add origin https://github.com/mphtrilogy/sports-arts-daily.git
git add .
git commit -m "initial scaffold: news API, schema, dashboard shell"
git branch -M main
git push -u origin main
```
(Create the empty repo on GitHub first if you haven't.)

### 2. Create the Vercel project
- vercel.com → New Project → import `sports-arts-daily`
- Add environment variables (Project Settings → Environment Variables):
  - `VITE_SUPABASE_URL` = `https://fnxoucliekhotvartyfu.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = (same anon key as `.env.local`)
  - `SUPABASE_SERVICE_ROLE_KEY` = (the service_role key — needed for the cron job, not yet built)
- Deploy

### 3. Confirm the RSS endpoint works live
Visit `https://<your-deploy>.vercel.app/api/news?category=nfl` — should return JSON
with real articles pulled from Google News.

### 4. Not built yet — next session
- A cron job (Vercel Cron or scheduled function) that calls `api/news.js` on a
  schedule and writes results into `news_hub.articles` using the service_role key.
  Right now the dashboard will show "No stories yet" until that job exists and
  runs at least once.
- Entertainment RSS queries are intentionally broad (e.g. "new album") — worth
  tightening once we see what kind of noise comes through in practice.

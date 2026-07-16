-- Sports & Arts Daily — Supabase schema
-- Run this against the shared project (fnxoucliekhotvartyfu), keeps its own
-- schema so it doesn't collide with Now Spinning / The Shelf / other apps.

create schema if not exists news_hub;

create table if not exists news_hub.articles (
  id           bigint generated always as identity primary key,
  title        text not null,
  link         text not null,
  source       text,
  category     text not null,          -- e.g. 'nfl', 'movies', 'broadway'
  domain       text not null check (domain in ('sport', 'entertainment')),
  region       text,                   -- 'us' | 'global', optional
  image        text,
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  unique (title, category)             -- dedupe within a category
);

-- Fast lookups for the dashboard filters
create index if not exists idx_articles_domain    on news_hub.articles (domain);
create index if not exists idx_articles_category  on news_hub.articles (category);
create index if not exists idx_articles_published on news_hub.articles (published_at desc);

-- Row Level Security — public read, writes only via service role (cron job)
alter table news_hub.articles enable row level security;

drop policy if exists "Public read access" on news_hub.articles;
create policy "Public read access"
  on news_hub.articles for select
  using (true);

-- No insert/update/delete policy for anon/authenticated —
-- the ingestion cron job uses the service_role key, which bypasses RLS.

-- Optional: auto-clean articles older than 14 days to keep the table lean
-- (call this from a scheduled Supabase Edge Function or Vercel cron if desired)
create or replace function news_hub.prune_old_articles()
returns void as $$
  delete from news_hub.articles
  where fetched_at < now() - interval '14 days';
$$ language sql;

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Reads go through a public-schema view (news_articles) that mirrors
// news_hub.articles — sidesteps needing news_hub itself exposed via the
// Data API "exposed schemas" setting, which requires a service restart
// to propagate and wasn't taking effect reliably.
export const supabase = createClient(url, anonKey);

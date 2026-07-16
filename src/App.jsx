import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';

const CATEGORIES = [
  // Sports
  { id: 'nfl', label: 'NFL', domain: 'sport' },
  { id: 'nba', label: 'NBA', domain: 'sport' },
  { id: 'mlb', label: 'MLB', domain: 'sport' },
  { id: 'nhl', label: 'NHL', domain: 'sport' },
  { id: 'mls', label: 'MLS', domain: 'sport' },
  { id: 'wnba', label: 'WNBA', domain: 'sport' },
  { id: 'soccer', label: 'Soccer', domain: 'sport' },
  { id: 'f1', label: 'Formula 1', domain: 'sport' },
  { id: 'tennis', label: 'Tennis', domain: 'sport' },
  { id: 'golf', label: 'Golf', domain: 'sport' },
  { id: 'cricket', label: 'Cricket', domain: 'sport' },
  { id: 'mma', label: 'MMA/UFC', domain: 'sport' },
  { id: 'boxing', label: 'Boxing', domain: 'sport' },
  { id: 'olympics', label: 'Olympics', domain: 'sport' },
  // Arts
  { id: 'movies', label: 'Movies', domain: 'entertainment' },
  { id: 'tv', label: 'TV', domain: 'entertainment' },
  { id: 'books', label: 'Books', domain: 'entertainment' },
  { id: 'music', label: 'Music', domain: 'entertainment' },
  { id: 'broadway', label: 'Broadway', domain: 'entertainment' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function App() {
  const [domain, setDomain] = useState('sport');
  const [category, setCategory] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const visibleCategories = useMemo(
    () => CATEGORIES.filter(c => c.domain === domain),
    [domain]
  );

  useEffect(() => {
    setCategory(null);
  }, [domain]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      let query = supabase
        .from('articles')
        .select('*')
        .eq('domain', domain)
        .order('published_at', { ascending: false })
        .limit(100);

      if (category) query = query.eq('category', category);

      const { data, error } = await query;
      if (cancelled) return;

      if (error) setError(error.message);
      else setArticles(data || []);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [domain, category]);

  return (
    <div className="app">
      <header className="masthead">
        <h1>Sports <span className="amp">&amp;</span> Arts Daily</h1>
        <div className="dateline">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
        <nav className="fold-toggle">
          <button
            className={`sports ${domain === 'sport' ? 'active' : ''}`}
            onClick={() => setDomain('sport')}
          >
            Sports
          </button>
          <button
            className={`arts ${domain === 'entertainment' ? 'active' : ''}`}
            onClick={() => setDomain('entertainment')}
          >
            Arts &amp; Entertainment
          </button>
        </nav>
      </header>

      <div
        className="pills"
        style={{ '--accent': domain === 'sport' ? 'var(--sports)' : 'var(--arts)' }}
      >
        <button
          className={`pill ${category === null ? 'active' : ''}`}
          onClick={() => setCategory(null)}
        >
          All
        </button>
        {visibleCategories.map(c => (
          <button
            key={c.id}
            className={`pill ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <main className="river" style={{ '--accent': domain === 'sport' ? 'var(--sports)' : 'var(--arts)' }}>
        {loading && <p className="state-msg">Pulling the latest dispatches&hellip;</p>}

        {!loading && error && (
          <p className="state-msg">Couldn't load the wire right now. {error}</p>
        )}

        {!loading && !error && articles.length === 0 && (
          <p className="state-msg">
            No stories yet in this section. The ingestion job hasn't run, or nothing new has come across the wire.
          </p>
        )}

        {!loading && !error && articles.map(a => (
          <a key={a.id} className="dispatch" href={a.link} target="_blank" rel="noreferrer">
            <div className="dispatch-meta">
              <span className="tag">{a.category}</span>
              <span>{a.source}</span>
              <span>&middot;</span>
              <span>{timeAgo(a.published_at)}</span>
            </div>
            <h2>{a.title}</h2>
          </a>
        ))}
      </main>
    </div>
  );
}

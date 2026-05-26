import { useEffect, useMemo, useState } from 'react';

const parseYouTubeId = (url) => {
  if (!url) return '';
  const clean = url.trim();
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /v=([\w-]{11})/,
    /embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) return match[1];
  }
  return '';
};

function App() {
  const [tracks, setTracks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('playlist');

  const sections = [
    { id: 'playlist', label: 'Playlist' },
    { id: 'add', label: 'Aggiungi canzone' },
    { id: 'search', label: 'Ricerca accordi' },
    { id: 'video', label: 'Video embed' }
  ];

  useEffect(() => {
    fetch('/api/tracks')
      .then((res) => res.json())
      .then((data) => {
        setTracks(data);
        setSelectedId(data[0]?.id ?? null);
      })
      .catch(() => setError('Impossibile caricare le canzoni.'))
      .finally(() => setLoading(false));
  }, []);

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === selectedId) || tracks[0] || null,
    [tracks, selectedId]
  );

  const embedUrl = selectedTrack ? `https://www.youtube.com/embed/${parseYouTubeId(selectedTrack.youtube_url)}` : '';

  const refreshTracks = async () => {
    const res = await fetch('/api/tracks');
    if (!res.ok) throw new Error('Errore');
    const data = await res.json();
    setTracks(data);
    setSelectedId(data[0]?.id ?? null);
  };

  const handleAdd = async () => {
    setError('');
    if (!title.trim() || !youtubeUrl.trim()) {
      setError('Inserisci titolo e link YouTube.');
      return;
    }
    try {
      const res = await fetch('/api/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), youtube_url: youtubeUrl.trim() })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Errore aggiunta.');
      }
      await refreshTracks();
      setTitle('');
      setYoutubeUrl('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpdate = async (id, updatedTitle, updatedUrl) => {
    setError('');
    try {
      const res = await fetch(`/api/tracks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: updatedTitle, youtube_url: updatedUrl })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Errore aggiornamento.');
      }
      await refreshTracks();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    setError('');
    await fetch(`/api/tracks/${id}`, { method: 'DELETE' });
    await refreshTracks();
  };

  const moveTrack = async (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= tracks.length) return;
    const reordered = [...tracks];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);

    const order = reordered.map((track) => track.id);
    const res = await fetch('/api/tracks/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order })
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error || 'Impossibile riordinare.');
      return;
    }
    const data = await res.json();
    setTracks(data);
  };

  const ultimateGuitarLink = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(searchText)}`;

  const handleSectionSelect = (sectionId) => {
    setActiveSection(sectionId);
    setMenuOpen(false);
  };

  return (
    <div className="app-shell">
      <header>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} title="Menu sezioni">
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div>
          <h1>Song Study App</h1>
          <p>Gestisci link YouTube, modifica l'ordine delle canzoni e cerca accordi su Ultimate Guitar.</p>
        </div>
      </header>

      {menuOpen && (
        <nav className="menu-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
            {sections.map((section) => (
              <button
                key={section.id}
                className={`menu-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => handleSectionSelect(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {activeSection === 'add' && (
        <section className="panel">
          <h2>Aggiungi canzone</h2>
          <label>
            Titolo
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo canzone" />
          </label>
          <label>
            Link YouTube
            <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/..." />
          </label>
          <button onClick={handleAdd}>Aggiungi alla playlist</button>
          {error && <div className="notice error">{error}</div>}
        </section>
      )}

      {activeSection === 'search' && (
        <section className="panel">
          <h2>Ricerca accordi</h2>
          <label>
            Titolo o artista
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Esempio: Hallelujah" />
          </label>
          <a className="primary-link" href={ultimateGuitarLink} target="_blank" rel="noreferrer">
            Cerca su Ultimate Guitar
          </a>
          <p>Apri il sito con il termine di ricerca per trovare testi e accordi.</p>
        </section>
      )}

      {activeSection === 'playlist' && (
        <section className="panel">
          <h2>Playlist</h2>
          {loading ? (
            <p>Caricamento...</p>
          ) : tracks.length === 0 ? (
            <p>Nessuna canzone salvata.</p>
          ) : (
            <div className="track-list">
              {tracks.map((track, index) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={index}
                  selected={track.id === selectedTrack?.id}
                  onSelect={() => setSelectedId(track.id)}
                  onSave={handleUpdate}
                  onDelete={() => handleDelete(track.id)}
                  onMove={(dir) => moveTrack(index, dir)}
                  canMoveUp={index > 0}
                  canMoveDown={index < tracks.length - 1}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {activeSection === 'video' && (
        <h2>Video embed</h2>
        {selectedTrack ? (
          <>
            <div className="video-header">
              <h3>{selectedTrack.title}</h3>
              <a href={selectedTrack.youtube_url} target="_blank" rel="noreferrer">
                Apri su YouTube
              </a>
            </div>
            {embedUrl ? (
              <div className="iframe-wrapper">
                <iframe
                  title="Video YouTube"
                  src={embedUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="notice error">Link YouTube non valido.</div>
            )}
          </>
        ) : (
          <p>Seleziona una canzone per vedere il video embed.</p>
        )}
      </section>
    </div>
  );
}

function TrackRow({ track, index, selected, onSelect, onSave, onDelete, onMove, canMoveUp, canMoveDown }) {
  const [editMode, setEditMode] = useState(false);
  const [title, setTitle] = useState(track.title);
  const [youtubeUrl, setYoutubeUrl] = useState(track.youtube_url);

  useEffect(() => {
    setTitle(track.title);
    setYoutubeUrl(track.youtube_url);
  }, [track.title, track.youtube_url]);

  return (
    <div className={`track-row ${selected ? 'selected' : ''}`}>
      <div className="track-main" onClick={onSelect}>
        {editMode ? (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
            <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} />
          </>
        ) : (
          <>
            <strong>{track.title}</strong>
            <span>{track.youtube_url}</span>
          </>
        )}
      </div>
      <div className="track-actions">
        <button type="button" onClick={() => onSelect()}>{selected ? 'Selezionata' : 'Apri'}</button>
        {editMode ? (
          <button type="button" onClick={() => { setEditMode(false); onSave(track.id, title.trim(), youtubeUrl.trim()); }}>
            Salva
          </button>
        ) : (
          <button type="button" onClick={() => setEditMode(true)}>Modifica</button>
        )}
        <button type="button" onClick={() => onDelete()}>Elimina</button>
        <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button>
        <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button>
      </div>
    </div>
  );
}

export default App;

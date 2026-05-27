import { useEffect, useMemo, useState } from 'react';

const STORAGE_TOKEN_KEY = 'appstudio_token';
const STORAGE_USER_KEY = 'appstudio_user';
const DB_NAME = 'appstudio-mp3-store';
const DB_VERSION = 1;

const YOUTUBE_PATTERNS = [
  /youtu\.be\/([\w-]{11})/,
  /v=([\w-]{11})/,
  /embed\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/
];

function parseYouTubeId(url) {
  if (!url) return '';
  const clean = url.trim();
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = clean.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function openFileStore() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error('IndexedDB non supportato dal browser'));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalFile(localId, file) {
  const db = await openFileStore();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').put(file, localId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Impossibile salvare il file locale'));
    };
  });
}

async function getLocalFile(localId) {
  const db = await openFileStore();
  const tx = db.transaction('files', 'readonly');
  const request = tx.objectStore('files').get(localId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error('Impossibile leggere il file locale'));
    };
  });
}

async function deleteLocalFile(localId) {
  const db = await openFileStore();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').delete(localId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Impossibile eliminare il file locale'));
    };
  });
}

function HamburgerButton({ isOpen, onClick }) {
  return (
    <button className={`hamburger-btn ${isOpen ? 'open' : ''}`} onClick={onClick} aria-label="Menu" aria-expanded={isOpen}>
      <span />
      <span />
      <span />
    </button>
  );
}

function SideMenu({ isOpen, sections, activeSection, onSelectSection, onClose }) {
  return (
    <>
      {isOpen && <div className="menu-overlay" onClick={onClose} />}
      <nav className={`side-menu ${isOpen ? 'open' : ''}`}>
        <div className="menu-header">
          <h2>Menu</h2>
          <button className="close-menu-btn" onClick={onClose} aria-label="Chiudi menu">?</button>
        </div>
        <ul className="menu-list">
          {sections.map((section) => (
            <li key={section.id}>
              <button
                className={`menu-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => {
                  onSelectSection(section.id);
                  onClose();
                }}
              >
                {section.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(STORAGE_TOKEN_KEY) || '');
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem(STORAGE_USER_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const [authMode, setAuthMode] = useState('login');
  const [authLoading, setAuthLoading] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [tracks, setTracks] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [localTrackSources, setLocalTrackSources] = useState({});
  const [title, setTitle] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [searchText, setSearchText] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [globalMessage, setGlobalMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('playlist');
  const [studySection, setStudySection] = useState('study-play');

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    const action = params.get('action');
    if (action === 'reset' && tokenParam) {
      setAuthMode('reset');
      setResetToken(tokenParam);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    setAuthLoading(true);
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error((await res.json()).error || 'Accesso non autorizzato');
        }
        return res.json();
      })
      .then((data) => {
        setUser(data);
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(data));
      })
      .catch(() => {
        setToken('');
        setUser(null);
        localStorage.removeItem(STORAGE_TOKEN_KEY);
        localStorage.removeItem(STORAGE_USER_KEY);
      })
      .finally(() => setAuthLoading(false));
  }, [token]);

  useEffect(() => {
    if (!user) return;
    loadTracks();
  }, [user]);

  useEffect(() => {
    return () => {
      Object.values(localTrackSources).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [localTrackSources]);

  const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Errore di rete');
    }
    return response.json();
  };

  const handleLogin = async () => {
    setGlobalError('');
    setGlobalMessage('');
    if (!authEmail.trim() || !authPassword.trim()) {
      setGlobalError('Inserisci email e password.');
      return;
    }
    setAuthLoading(true);
    try {
      const data = await fetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword })
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem(STORAGE_TOKEN_KEY, data.token);
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(data.user));
      setAuthEmail('');
      setAuthPassword('');
      setGlobalMessage('Accesso eseguito. Benvenuto in Appstudio.');
    } catch (error) {
      setGlobalError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async () => {
    setGlobalError('');
    setGlobalMessage('');
    if (!authEmail.trim() || !authPassword.trim()) {
      setGlobalError('Inserisci email e password.');
      return;
    }
    setAuthLoading(true);
    try {
      const data = await fetchJson('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword })
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem(STORAGE_TOKEN_KEY, data.token);
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(data.user));
      setAuthEmail('');
      setAuthPassword('');
      setGlobalMessage('Account creato con successo. Benvenuto in Appstudio.');
    } catch (error) {
      setGlobalError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setGlobalError('');
    setGlobalMessage('');
    if (!resetEmail.trim()) {
      setGlobalError('Inserisci l\'email per il recupero password.');
      return;
    }
    setAuthLoading(true);
    try {
      const data = await fetchJson('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() })
      });
      setGlobalMessage(data.message);
      setResetEmail('');
    } catch (error) {
      setGlobalError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setGlobalError('');
    setGlobalMessage('');
    if (!resetToken || !newPassword.trim()) {
      setGlobalError('Token e nuova password sono obbligatori.');
      return;
    }
    setAuthLoading(true);
    try {
      const data = await fetchJson('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: newPassword })
      });
      setGlobalMessage(data.message);
      setAuthMode('login');
      setResetToken('');
      setNewPassword('');
    } catch (error) {
      setGlobalError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    setToken('');
    setUser(null);
    setTracks([]);
    setSelectedTrackId(null);
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_USER_KEY);
    setActiveSection('playlist');
    setGlobalMessage('Sei stato disconnesso.');
  };

  const loadTracks = async () => {
    setGlobalError('');
    try {
      const data = await fetchJson('/api/tracks', {
        headers: { ...authHeaders, 'Content-Type': 'application/json' }
      });
      setTracks(data);
      if (!selectedTrackId && data.length) {
        setSelectedTrackId(data[0].id);
      }
      loadLocalTrackFiles(data.filter((track) => track.type === 'local'));
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  const loadLocalTrackFiles = async (localTracks) => {
    if (!window.indexedDB) return;
    const files = {};
    for (const track of localTracks) {
      try {
        const file = await getLocalFile(track.local_id);
        if (file) {
          files[track.local_id] = URL.createObjectURL(file);
        }
      } catch {
      }
    }
    setLocalTrackSources((current) => {
      Object.values(current).forEach((url) => {
        if (url && !Object.values(files).includes(url)) {
          URL.revokeObjectURL(url);
        }
      });
      return files;
    });
  };

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === selectedTrackId) || tracks[0] || null,
    [tracks, selectedTrackId]
  );

  const youtubeEmbedUrl = selectedTrack?.type === 'youtube' ? `https://www.youtube.com/embed/${parseYouTubeId(selectedTrack.youtube_url)}` : '';
  const localAudioUrl = selectedTrack?.type === 'local' ? localTrackSources[selectedTrack.local_id] : null;
  const currentSearch = selectedTrack?.title || searchText || 'brano musicale';
  const ultimateGuitarLink = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(currentSearch)}`;
  const chordifyLink = `https://chordify.net/search?q=${encodeURIComponent(currentSearch)}`;
  const youtubeTracks = tracks.filter((track) => track.type === 'youtube');
  const localTracks = tracks.filter((track) => track.type === 'local');

  const handleAddYouTube = async () => {
    setGlobalError('');
    setGlobalMessage('');
    if (!title.trim() || !youtubeUrl.trim()) {
      setGlobalError('Inserisci titolo e link YouTube.');
      return;
    }
    try {
      await fetchJson('/api/tracks', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), type: 'youtube', youtube_url: youtubeUrl.trim() })
      });
      setTitle('');
      setYoutubeUrl('');
      setGlobalMessage('Brano YouTube aggiunto alla playlist.');
      loadTracks();
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  const handleUploadMp3 = async (event) => {
    setGlobalError('');
    setGlobalMessage('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.mp3')) {
      setGlobalError('Seleziona un file MP3 valido.');
      event.target.value = '';
      return;
    }
    const localId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    try {
      await saveLocalFile(localId, file);
      await fetchJson('/api/tracks', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: file.name,
          type: 'local',
          local_id: localId,
          file_name: file.name,
          mime_type: file.type || 'audio/mpeg'
        })
      });
      setGlobalMessage('Brano MP3 caricato e salvato sul tuo dispositivo.');
      event.target.value = '';
      loadTracks();
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  const handleDeleteTrack = async (track) => {
    setGlobalError('');
    try {
      await fetchJson(`/api/tracks/${track.id}`, {
        method: 'DELETE',
        headers: { ...authHeaders, 'Content-Type': 'application/json' }
      });
      if (track.type === 'local' && track.local_id) {
        await deleteLocalFile(track.local_id).catch(() => null);
      }
      setGlobalMessage('Brano rimosso dalla playlist.');
      loadTracks();
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  const handleMoveTrack = async (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= tracks.length) return;
    const reordered = [...tracks];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    try {
      const data = await fetchJson('/api/tracks/order', {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: reordered.map((track) => track.id) })
      });
      setTracks(data);
      setGlobalMessage('Playlist riordinata.');
    } catch (error) {
      setGlobalError(error.message);
    }
  };

  if (!token || !user) {
    return (
      <div className="auth-shell">
        <div className="auth-panel">
          <div className="auth-header">
            <h1>Appstudio</h1>
            <p>Accedi o crea un account per gestire playlist, caricare MP3 locali e iniziare lo studio.</p>
          </div>
          {globalError && <div className="notice error">{globalError}</div>}
          {globalMessage && <div className="notice">{globalMessage}</div>}
          {authMode === 'login' && (
            <>
              <label>
                Email
                <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="tuo@email.com" />
              </label>
              <label>
                Password
                <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" />
              </label>
              <button className="primary-button" onClick={handleLogin} disabled={authLoading}>
                Accedi
              </button>
            </>
          )}
          {authMode === 'register' && (
            <>
              <label>
                Email
                <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="tuo@email.com" />
              </label>
              <label>
                Password
                <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" />
              </label>
              <button className="primary-button" onClick={handleRegister} disabled={authLoading}>
                Registrati
              </button>
            </>
          )}
          {authMode === 'forgot' && (
            <>
              <label>
                Email
                <input type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="tuo@email.com" />
              </label>
              <button className="primary-button" onClick={handleForgotPassword} disabled={authLoading}>
                Invia istruzioni di recupero
              </button>
            </>
          )}
          {authMode === 'reset' && (
            <>
              <label>
                Token di reset
                <input type="text" value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="Token da email" />
              </label>
              <label>
                Nuova password
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nuova password" />
              </label>
              <button className="primary-button" onClick={handleResetPassword} disabled={authLoading}>
                Reimposta password
              </button>
            </>
          )}
          <div className="auth-links">
            {authMode !== 'login' && (
              <button
                className="link-button"
                onClick={() => {
                  setAuthMode('login');
                  setGlobalError('');
                  setGlobalMessage('');
                }}
              >
                Torna al login
              </button>
            )}
            {authMode !== 'register' && (
              <button
                className="link-button"
                onClick={() => {
                  setAuthMode('register');
                  setGlobalError('');
                  setGlobalMessage('');
                }}
              >
                Crea account
              </button>
            )}
            {authMode !== 'forgot' && (
              <button
                className="link-button"
                onClick={() => {
                  setAuthMode('forgot');
                  setGlobalError('');
                  setGlobalMessage('');
                }}
              >
                Password dimenticata?
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-content">
          <HamburgerButton isOpen={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
          <div className="header-title">
            <h1>Appstudio</h1>
            <p>Studia cover e pezzi propri in modo semplice.</p>
          </div>
          <div className="user-panel">
            <span>{user.email}</span>
            <button className="secondary-button" onClick={logout}>
              Esci
            </button>
          </div>
        </div>
      </header>

      <SideMenu
        isOpen={menuOpen}
        sections={[
          { id: 'playlist', label: 'Playlist' },
          { id: 'manage', label: 'Aggiungi/togli/ordina canzoni' },
          { id: 'upload', label: 'Carica canzoni tue in MP3' },
          { id: 'study', label: 'Inizia lo studio' }
        ]}
        activeSection={activeSection}
        onSelectSection={(section) => {
          setActiveSection(section);
          if (section === 'study') {
            setStudySection('study-play');
          }
        }}
        onClose={() => setMenuOpen(false)}
      />

      <div className="app-layout">
        <main className="main-content">
          {globalError && <div className="notice error">{globalError}</div>}
          {globalMessage && <div className="notice">{globalMessage}</div>}

          {activeSection === 'playlist' && (
            <div className="panel">
              <h2>Playlist</h2>
              <p className="section-note">Le canzoni sono divise tra YouTube e brani MP3 caricati localmente.</p>
              <div className="track-group">
                <h3>YouTube</h3>
                {youtubeTracks.length ? (
                  <div className="track-grid">
                    {youtubeTracks.map((track) => {
                      const trackIndex = tracks.findIndex((item) => item.id === track.id);
                      return (
                        <div key={track.id} className={`track-row ${selectedTrackId === track.id ? 'selected' : ''}`}>
                          <button className="track-main" onClick={() => setSelectedTrackId(track.id)}>
                            <strong>{track.title}</strong>
                            <span>{track.youtube_url}</span>
                          </button>
                          <div className="track-actions">
                            <button className="secondary-button" onClick={() => handleDeleteTrack(track)}>
                              Rimuovi
                            </button>
                            <button className="secondary-button" onClick={() => handleMoveTrack(trackIndex, -1)} disabled={trackIndex <= 0}>
                              Su
                            </button>
                            <button className="secondary-button" onClick={() => handleMoveTrack(trackIndex, 1)} disabled={trackIndex === tracks.length - 1}>
                              Giù
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="section-note">Nessuna canzone YouTube in playlist.</p>
                )}
              </div>
              <div className="track-group">
                <h3>Brani MP3 locali</h3>
                {localTracks.length ? (
                  <div className="track-grid">
                    {localTracks.map((track) => {
                      const trackIndex = tracks.findIndex((item) => item.id === track.id);
                      return (
                        <div key={track.id} className={`track-row ${selectedTrackId === track.id ? 'selected' : ''}`}>
                          <button className="track-main" onClick={() => setSelectedTrackId(track.id)}>
                            <strong>{track.file_name || track.title}</strong>
                            <span>{track.local_id ? 'File locale disponibile' : 'File locale mancante'}</span>
                          </button>
                          <div className="track-actions">
                            <button className="secondary-button" onClick={() => handleDeleteTrack(track)}>
                              Rimuovi
                            </button>
                            <button className="secondary-button" onClick={() => handleMoveTrack(trackIndex, -1)} disabled={trackIndex <= 0}>
                              Su
                            </button>
                            <button className="secondary-button" onClick={() => handleMoveTrack(trackIndex, 1)} disabled={trackIndex === tracks.length - 1}>
                              Giù
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="section-note">Nessun brano MP3 caricato sul dispositivo.</p>
                )}
              </div>
            </div>
          )}

          {activeSection === 'manage' && (
            <div className="panel">
              <h2>Aggiungi o rimuovi canzoni</h2>
              <label>
                Titolo
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo del brano" />
              </label>
              <label>
                Link YouTube
                <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/..." />
              </label>
              <button className="primary-button" onClick={handleAddYouTube}>
                Aggiungi a playlist
              </button>
              <div className="section-note">Dopo l'aggiunta, usa la vista Playlist per rimuovere o riordinare.</div>
            </div>
          )}

          {activeSection === 'upload' && (
            <div className="panel">
              <h2>Carica canzoni tue in MP3</h2>
              <p className="section-note">I brani MP3 rimangono sul tuo PC o telefono e non vengono inviati al server.</p>
              <label>
                Seleziona file MP3
                <input type="file" accept="audio/mp3,audio/*" onChange={handleUploadMp3} />
              </label>
              {localTracks.length ? (
                <div className="track-grid">
                  {localTracks.map((track) => (
                    <div key={track.id} className="track-row">
                      <div className="track-main">
                        <strong>{track.file_name || track.title}</strong>
                        <span>{track.local_id ? 'Memorizzato localmente' : 'File assente nel browser'}</span>
                      </div>
                      <div className="track-actions">
                        <button className="secondary-button" onClick={() => handleDeleteTrack(track)}>
                          Rimuovi
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="section-note">Non ci sono ancora brani MP3 caricati.</p>
              )}
            </div>
          )}

          {activeSection === 'study' && (
            <div className="panel">
              <h2>Inizia lo studio</h2>
              <div className="study-nav">
                <button className={studySection === 'study-play' ? 'active-tab' : ''} onClick={() => setStudySection('study-play')}>
                  Seleziona/ascolta canzone da playlist
                </button>
                <button className={studySection === 'study-ult' ? 'active-tab' : ''} onClick={() => setStudySection('study-ult')}>
                  Cerca testi/accordi su Ultimate Guitar
                </button>
                <button className={studySection === 'study-chord' ? 'active-tab' : ''} onClick={() => setStudySection('study-chord')}>
                  Scopri accordi con Chordify
                </button>
              </div>

              {studySection === 'study-play' && (
                <div className="study-card">
                  <h3>Ascolta dalla playlist</h3>
                  {selectedTrack ? (
                    <>
                      <p>
                        <strong>{selectedTrack.title}</strong>
                        <br />
                        {selectedTrack.type === 'youtube' ? 'Video YouTube' : selectedTrack.file_name || 'File MP3 locale'}
                      </p>
                      {selectedTrack.type === 'youtube' && youtubeEmbedUrl && (
                        <div className="iframe-wrapper">
                          <iframe
                            title="Video YouTube"
                            src={youtubeEmbedUrl}
                            allow="autoplay; encrypted-media"
                            allowFullScreen
                          />
                        </div>
                      )}
                      {selectedTrack.type === 'local' && (
                        <div className="audio-card">
                          {localAudioUrl ? (
                            <audio controls src={localAudioUrl} className="audio-player" />
                          ) : (
                            <p className="section-note">Il file MP3 locale non � disponibile. Ricaricalo se necessario.</p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="section-note">Seleziona una canzone dalla Playlist per iniziare.</p>
                  )}
                </div>
              )}

              {studySection === 'study-ult' && (
                <div className="study-card">
                  <h3>Cerca su Ultimate Guitar</h3>
                  <p>Usa il titolo della canzone selezionata o inserisci un nuovo termine di ricerca.</p>
                  <label>
                    Cerca
                    <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Titolo o artista" />
                  </label>
                  <a className="primary-link" href={ultimateGuitarLink} target="_blank" rel="noreferrer">
                    Apri Ultimate Guitar
                  </a>
                </div>
              )}

              {studySection === 'study-chord' && (
                <div className="study-card">
                  <h3>Scopri accordi con Chordify</h3>
                  <p>Trova gli accordi per il brano selezionato o cerca un titolo a scelta.</p>
                  <label>
                    Cerca
                    <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Titolo o artista" />
                  </label>
                  <a className="primary-link" href={chordifyLink} target="_blank" rel="noreferrer">
                    Apri Chordify
                  </a>
                </div>
              )}
            </div>
          )}
        </main>

        <aside className="video-sidebar">
          <div className="panel video-panel">
            <h2>Quick study</h2>
            <p className="section-note">Qui vedi la traccia selezionata ed entri velocemente nello studio.</p>
            {selectedTrack ? (
              <>
                <div className="track-summary">
                  <strong>{selectedTrack.title}</strong>
                  <p>{selectedTrack.type === 'youtube' ? 'Video YouTube' : 'MP3 locale'}</p>
                </div>
                {selectedTrack.type === 'youtube' && youtubeEmbedUrl ? (
                  <div className="iframe-wrapper">
                    <iframe
                      title="Video YouTube preview"
                      src={youtubeEmbedUrl}
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                    />
                  </div>
                ) : selectedTrack.type === 'local' ? (
                  localAudioUrl ? (
                    <audio controls src={localAudioUrl} className="audio-player" />
                  ) : (
                    <p className="section-note">Riproduci il file MP3 dal pannello Studio o ricarica il brano se necessario.</p>
                  )
                ) : null}
                <div className="study-links">
                  <a className="secondary-link" href={ultimateGuitarLink} target="_blank" rel="noreferrer">
                    Cerca accordi su Ultimate Guitar
                  </a>
                  <a className="secondary-link" href={chordifyLink} target="_blank" rel="noreferrer">
                    Apri Chordify
                  </a>
                </div>
              </>
            ) : (
              <p className="section-note">Seleziona una canzone dalla playlist per ascoltarla.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;

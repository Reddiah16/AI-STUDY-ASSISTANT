import React, { useState, useEffect, useRef } from 'react';
import {
  fetchDocuments, saveDocumentMetadata, deleteDocument,
  fetchChatSessions, deleteChatSession, clearAllChatSessions,
  getProfile, updateProfile,
  type Document, type ChatSession, type Profile,
} from '../services/db';
import { uploadDocument, deleteDocumentFile, validateFile } from '../services/storage';
import {
  FileText, Upload, Trash2, BookOpen, Database,
  MessageSquare, Plus, Calendar, ExternalLink,
  User, Clock, ChevronRight, Sparkles,
} from 'lucide-react';

interface DashboardProps {
  user: any;
  onStartChat: (selectedDocs: Document[], sessionId?: string) => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  onLogout: () => void;
}

export default function Dashboard({ user, onStartChat, showToast, onLogout }: DashboardProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Profile modal
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Data Loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    loadAll();
  }, [user.id]);

  async function loadAll() {
    await Promise.all([loadDocuments(), loadSessions(), loadProfile()]);
  }

  async function loadDocuments() {
    try {
      setLoadingDocs(true);
      setDocuments(await fetchDocuments(user.id));
    } catch (err) {
      console.error(err);
      showToast('Failed to load study materials.', 'error');
    } finally {
      setLoadingDocs(false);
    }
  }

  async function loadSessions() {
    try {
      setLoadingSessions(true);
      setSessions(await fetchChatSessions(user.id));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadProfile() {
    try {
      const p = await getProfile(user.id);
      if (p) { setProfile(p); setProfileName(p.full_name); }
    } catch (err) {
      console.error(err);
    }
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) { showToast('Name cannot be empty.', 'error'); return; }
    try {
      setSavingProfile(true);
      const updated = await updateProfile(user.id, { full_name: profileName });
      setProfile(updated);
      showToast('Profile updated.', 'success');
      setShowProfileModal(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to update profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files[0]) await handleUpload(e.dataTransfer.files[0]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) await handleUpload(e.target.files[0]);
  };

  const handleUpload = async (file: File) => {
    const err = validateFile(file);
    if (err) { showToast(err, 'error'); return; }

    try {
      setUploading(true);
      showToast(`Uploading "${file.name}"…`, 'warning');
      const { filePath, fileUrl, contentText } = await uploadDocument(user.id, file);
      const newDoc = await saveDocumentMetadata(user.id, file.name, filePath, fileUrl, file.size, contentText);
      setDocuments(prev => [newDoc, ...prev]);
      showToast(`"${file.name}" uploaded and indexed!`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Upload failed. Please try again.', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Delete document ───────────────────────────────────────────────────────

  const handleDeleteDoc = async (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Remove "${doc.file_name}"?`)) return;
    try {
      showToast('Removing…', 'warning');
      await deleteDocumentFile(doc.file_path);
      await deleteDocument(doc.id);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      showToast('Document removed.', 'success');
    } catch (err: any) {
      showToast('Failed to delete document.', 'error');
    }
  };

  // ── Delete session ────────────────────────────────────────────────────────

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this chat session?')) return;
    try {
      await deleteChatSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      showToast('Session deleted.', 'success');
    } catch {
      showToast('Failed to delete session.', 'error');
    }
  };

  const handleClearAllSessions = async () => {
    if (sessions.length === 0) return;
    if (!confirm('Are you sure you want to clear all chat sessions? This action cannot be undone.')) return;
    try {
      showToast('Clearing all sessions…', 'warning');
      await clearAllChatSessions(user.id);
      setSessions([]);
      showToast('All chat sessions cleared.', 'success');
    } catch {
      showToast('Failed to clear chat sessions.', 'error');
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatBytes = (b: number) => {
    if (b === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const displayName = profile?.full_name || user.user_metadata?.full_name || user.email;
  const totalSize = documents.reduce((s, d) => s + Number(d.file_size), 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="dashboard-grid">

      {/* ── Header ── */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800 }}>
            Welcome back, <span className="gradient-text">{displayName}</span> 👋
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
            Upload study material and start an AI-powered revision session.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={() => setShowProfileModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <User size={15} /> Profile
          </button>
          <button className="btn btn-primary" onClick={() => onStartChat(documents)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            disabled={documents.length === 0}>
            <Sparkles size={15} /> Start Studying
          </button>
          <button className="btn btn-secondary" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="stats-bar">
        {[
          { icon: <FileText size={20} />, value: documents.length, label: 'Documents' },
          { icon: <MessageSquare size={20} />, value: sessions.length, label: 'Chat Sessions' },
          { icon: <Database size={20} />, value: formatBytes(totalSize), label: 'Storage Used' },
        ].map(({ icon, value, label }) => (
          <div className="stat-card" key={label}>
            <div className="stat-icon">{icon}</div>
            <div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Left Column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Upload zone */}
        <div className="card">
          <h3 style={{ fontSize: '1.05rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={17} style={{ color: 'var(--primary-light)' }} /> Upload Study Material
          </h3>
          <div
            className={`upload-zone ${dragActive ? 'dragging' : ''}`}
            onDragEnter={handleDrag} onDragOver={handleDrag}
            onDragLeave={handleDrag} onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" style={{ display: 'none' }}
              accept=".pdf,.txt,.md" onChange={handleFileChange} />
            {uploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div className="spinner" />
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Uploading &amp; chunking for RAG…
                </p>
              </div>
            ) : (
              <>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--primary-glow)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-light)' }}>
                  <Upload size={22} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Drag &amp; drop or click to browse</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '3px' }}>
                    PDF, TXT, MD · max 10 MB
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Documents list */}
        <div className="card" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={17} style={{ color: 'var(--primary-light)' }} /> My Documents
            </h3>
            {documents.length > 0 && (
              <button className="btn btn-primary" onClick={() => onStartChat(documents)}
                style={{ padding: '5px 12px', fontSize: '0.8rem', gap: '5px' }}>
                Chat All <BookOpen size={13} />
              </button>
            )}
          </div>

          {loadingDocs ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
              <div className="spinner" />
            </div>
          ) : documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)' }}>
              <FileText size={40} strokeWidth={1.2} style={{ marginBottom: '10px', opacity: 0.5 }} />
              <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No documents yet</p>
              <p style={{ fontSize: '0.82rem', marginTop: '4px' }}>Upload a PDF or text file to get started.</p>
            </div>
          ) : (
            <div className="document-list" style={{ maxHeight: '380px', overflowY: 'auto' }}>
              {documents.map(doc => (
                <div key={doc.id} className="document-item" style={{ cursor: 'pointer' }}
                  onClick={() => onStartChat([doc])}>
                  <div className="document-meta">
                    <div style={{ color: 'var(--primary-light)', flexShrink: 0 }}>
                      <FileText size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="document-title" title={doc.file_name}>{doc.file_name}</div>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        <span>{formatBytes(doc.file_size)}</span>
                        <span>·</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <Calendar size={9} /> {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <a href={doc.file_url} target="_blank" rel="noreferrer"
                      className="btn-icon" style={{ width: 28, height: 28 }}
                      onClick={e => e.stopPropagation()} title="Open file">
                      <ExternalLink size={11} />
                    </a>
                    <button className="btn-icon" style={{ width: 28, height: 28, color: 'var(--error)' }}
                      onClick={e => handleDeleteDoc(doc, e)} title="Delete">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right Column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* New session quick-start */}
        <div className="card" style={{
          background: 'linear-gradient(135deg, hsla(250,89%,65%,0.12), hsla(280,85%,60%,0.08))',
          border: '1px solid var(--border-focus)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: 48, height: 48, borderRadius: '10px', background: 'var(--primary-glow)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-light)', flexShrink: 0 }}>
              <Sparkles size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '4px' }}>Ask anything</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Start a new AI study session grounded in your uploaded documents.
              </p>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}
            onClick={() => onStartChat(documents)}
            disabled={documents.length === 0}>
            <Plus size={16} /> New Study Chat
          </button>
          {documents.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '8px' }}>
              Upload a document first to enable chat.
            </p>
          )}
        </div>

        {/* Recent sessions */}
        <div className="card" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={17} style={{ color: 'var(--primary-light)' }} /> Recent Sessions
            </h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={() => onStartChat(documents)}>
                View all
              </button>
              <button className="btn btn-danger"
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                onClick={handleClearAllSessions}
                disabled={sessions.length === 0}>
                Clear all
              </button>
            </div>
          </div>

          {loadingSessions ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
              <div className="spinner" style={{ width: 18, height: 18 }} />
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              <MessageSquare size={36} strokeWidth={1.2} style={{ marginBottom: '10px', opacity: 0.45 }} />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No sessions yet</p>
              <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>Start your first AI chat session above.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '340px', overflowY: 'auto' }}>
              {sessions.slice(0, 8).map(s => (
                <div key={s.id} className="document-item"
                  style={{ cursor: 'pointer', padding: '10px 12px' }}
                  onClick={() => onStartChat(documents, s.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <MessageSquare size={15} style={{ color: 'var(--primary-light)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                        {timeAgo(s.created_at)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                    <button className="btn-icon" style={{ width: 26, height: 26, color: 'var(--error)' }}
                      onClick={e => handleDeleteSession(s.id, e)} title="Delete session">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Profile Modal ── */}
      {showProfileModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, animation: 'fadeIn 0.2s ease-out'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: 400, margin: 20 }}>
            <h3 style={{ fontSize: '1.15rem', marginBottom: 16 }}>Profile Settings</h3>
            <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input className="input-field" type="text" value={profileName}
                  onChange={e => setProfileName(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary"
                  onClick={() => setShowProfileModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchChatSessions, createChatSession, deleteChatSession,
  fetchChatMessages, saveChatMessage,
  type ChatSession, type ChatMessage, type Document,
} from '../services/db';
import { ragAnswer, type RagSource } from '../services/rag';
import {
  MessageSquare, Plus, Trash2, Send, FileText,
  Sparkles, BookOpen, ArrowLeft, Menu, X,
} from 'lucide-react';

interface ChatInterfaceProps {
  user: any;
  allDocuments: Document[];
  initialSelectedDocs: Document[];
  /** If provided, open this session immediately instead of the latest one */
  initialSessionId?: string;
  onBackToDashboard: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(raw: string): { __html: string } {
  let html = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  html = html.replace(/^### (.+)$/gim,
    '<h3 style="margin:14px 0 6px;color:var(--text-primary);font-size:1.05rem">$1</h3>');
  html = html.replace(/^#### (.+)$/gim,
    '<h4 style="margin:10px 0 4px;color:var(--text-primary);font-size:0.95rem">$1</h4>');
  html = html.replace(/\*\*(.+?)\*\*/g,
    '<strong style="color:var(--text-primary)">$1</strong>');
  html = html.replace(/\*(.+?)\*/g,
    '<em style="color:var(--text-secondary)">$1</em>');
  html = html.replace(/`([^`]+)`/g,
    '<code style="background:var(--bg-surface-elevated);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.83em;color:var(--primary-light)">$1</code>');
  html = html.replace(/^- (.+)$/gim,
    '<li style="margin-left:18px;margin-bottom:4px;list-style:disc">$1</li>');

  return {
    __html: html.split('\n').map(line => {
      const t = line.trim();
      if (!t) return '<div style="height:6px"></div>';
      if (t.startsWith('<h') || t.startsWith('<li')) return line;
      return `<p style="margin-bottom:7px">${line}</p>`;
    }).join(''),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatInterface({
  user,
  allDocuments,
  initialSelectedDocs,
  initialSessionId,
  onBackToDashboard,
  showToast,
}: ChatInterfaceProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Document[]>(initialSelectedDocs);

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Streaming state — ephemeral, never persisted
  const [streamText, setStreamText] = useState('');
  const [streamSources, setStreamSources] = useState<RagSource[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Load sessions on mount ─────────────────────────────────────────────────

  useEffect(() => { loadSessions(); }, [user.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const loadSessions = async () => {
    try {
      setLoadingSessions(true);
      const data = await fetchChatSessions(user.id);
      setSessions(data);

      // Prefer the session the user clicked from the dashboard
      const target = initialSessionId
        ? data.find(s => s.id === initialSessionId)
        : data[0];

      if (target) {
        setCurrentSession(target);
      } else {
        const fresh = await createChatSession(user.id, 'New Study Session');
        setSessions([fresh]);
        setCurrentSession(fresh);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to load chat history.', 'error');
    } finally {
      setLoadingSessions(false);
    }
  };

  // ── Load messages when session changes ─────────────────────────────────────

  useEffect(() => {
    if (!currentSession) { setMessages([]); return; }
    (async () => {
      try {
        setLoadingMessages(true);
        setMessages(await fetchChatMessages(currentSession.id));
      } catch {
        showToast('Failed to load messages.', 'error');
      } finally {
        setLoadingMessages(false);
      }
    })();
  }, [currentSession?.id]);

  // ── Session management ─────────────────────────────────────────────────────

  const handleNewSession = async () => {
    try {
      const title = `Study Chat · ${new Date().toLocaleDateString()}`;
      const s = await createChatSession(user.id, title);
      setSessions(prev => [s, ...prev]);
      setCurrentSession(s);
      setSidebarOpen(false);
    } catch {
      showToast('Failed to create session.', 'error');
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    try {
      await deleteChatSession(id);
      const rest = sessions.filter(s => s.id !== id);
      setSessions(rest);
      if (currentSession?.id === id) setCurrentSession(rest[0] ?? null);
    } catch {
      showToast('Failed to delete session.', 'error');
    }
  };

  // ── Document chip toggle ───────────────────────────────────────────────────

  const toggleDoc = useCallback((doc: Document) => {
    setSelectedDocs(prev =>
      prev.some(d => d.id === doc.id)
        ? prev.filter(d => d.id !== doc.id)
        : [...prev, doc]
    );
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !currentSession || generating) return;

    const query = input.trim();
    setInput('');
    setGenerating(true);
    setStreamText('');
    setStreamSources([]);

    try {
      // 1. Persist user message
      const userMsg = await saveChatMessage(currentSession.id, 'user', query);
      setMessages(prev => [...prev, userMsg]);

      // 2. Call the RAG service (placeholder → real LLM hook point)
      await ragAnswer(
        {
          query,
          documentIds: selectedDocs.map(d => d.id),
          documentNames: selectedDocs.map(d => d.file_name),
          sessionId: currentSession.id,
        },
        {
          onChunk: (partial) => setStreamText(partial),
          onComplete: async (fullText, sources) => {
            try {
              // 3. Persist assistant message with sources
              const assistantMsg = await saveChatMessage(
                currentSession.id, 'assistant', fullText,
                sources
              );
              setMessages(prev => [...prev, assistantMsg]);
            } catch (err) {
              console.error('Failed to save assistant message', err);
            } finally {
              setStreamText('');
              setStreamSources([]);
              setGenerating(false);
              inputRef.current?.focus();
            }
          },
          onError: (err) => {
            console.error(err);
            showToast('Failed to generate answer. Please try again.', 'error');
            setGenerating(false);
          },
        }
      );
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Something went wrong.', 'error');
      setGenerating(false);
    }
  };

  // ── Key handling (Shift+Enter = newline, Enter = send) ─────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as any);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="chat-workspace">

      {/* ── Sidebar ── */}
      <div className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          style={{
            display: 'none', position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
          className="sidebar-close-btn"
        >
          <X size={18} />
        </button>

        <div style={{ padding: '14px', borderBottom: '1px solid var(--border-color)',
          display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={onBackToDashboard}
            style={{ width: '100%', gap: '6px', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={15} /> Dashboard
          </button>
          <button className="btn btn-primary" onClick={handleNewSession}
            style={{ width: '100%', gap: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={15} /> New Chat
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', paddingLeft: '8px' }}>
            Sessions
          </div>

          {loadingSessions ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <div className="spinner" style={{ width: 16, height: 16 }} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {sessions.map(s => {
                const active = currentSession?.id === s.id;
                return (
                  <div key={s.id}
                    onClick={() => { setCurrentSession(s); setSidebarOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 10px', borderRadius: '7px', cursor: 'pointer',
                      background: active ? 'var(--bg-surface-elevated)' : 'transparent',
                      border: `1px solid ${active ? 'var(--border-color)' : 'transparent'}`,
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <MessageSquare size={14} style={{
                        color: active ? 'var(--primary-light)' : 'var(--text-muted)', flexShrink: 0
                      }} />
                      <span style={{
                        fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}>
                        {s.title}
                      </span>
                    </div>
                    {sessions.length > 1 && active && (
                      <button onClick={e => handleDeleteSession(s.id, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
                        <Trash2 size={12} style={{ color: 'var(--error)' }} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="chat-main">

        {/* Header */}
        <div className="chat-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button className="btn-icon mobile-sidebar-toggle"
              onClick={() => setSidebarOpen(v => !v)}
              style={{ width: 34, height: 34 }}>
              <Menu size={16} />
            </button>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>
              {currentSession?.title ?? 'Study Space'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <Sparkles size={13} style={{ color: 'var(--primary-light)' }} />
            {selectedDocs.length === 0
              ? 'No documents selected'
              : `${selectedDocs.length} document${selectedDocs.length > 1 ? 's' : ''} active`}
          </div>
        </div>

        {/* Document context chips */}
        <div className="doc-selection-drawer">
          <div className="drawer-title">Context Documents — click to toggle</div>
          {allDocuments.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              No documents uploaded yet.{' '}
              <button onClick={onBackToDashboard}
                style={{ background: 'none', border: 'none', color: 'var(--primary-light)',
                  cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 'inherit' }}>
                Go to dashboard
              </button>{' '}
              to upload files.
            </p>
          ) : (
            <div className="doc-chip-container">
              {allDocuments.map(doc => (
                <div key={doc.id}
                  className={`doc-chip ${selectedDocs.some(d => d.id === doc.id) ? 'selected' : ''}`}
                  onClick={() => toggleDoc(doc)}>
                  <FileText size={11} />
                  <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.file_name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="chat-messages-container">
          {loadingMessages ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          ) : messages.length === 0 && !streamText ? (
            /* Empty state */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '16px',
              textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%',
                background: 'var(--primary-glow)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: 'var(--primary-light)' }}>
                <BookOpen size={28} />
              </div>
              <div>
                <h4 style={{ color: 'var(--text-primary)', fontSize: '1.05rem', marginBottom: 6 }}>
                  Ready to study
                </h4>
                <p style={{ fontSize: '0.85rem', maxWidth: 320, lineHeight: 1.5 }}>
                  {selectedDocs.length > 0
                    ? `Ask anything about "${selectedDocs[0].file_name}"${selectedDocs.length > 1 ? ` + ${selectedDocs.length - 1} more` : ''}.`
                    : 'Select a document above, then ask a question below.'}
                </p>
              </div>
              {/* Suggestion chips */}
              {selectedDocs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '4px' }}>
                  {['Summarise the key concepts', 'Give me a quiz on this', 'Explain the main topic'].map(suggestion => (
                    <button key={suggestion}
                      onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                      style={{
                        background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)', borderRadius: '20px', padding: '6px 14px',
                        fontSize: '0.8rem', cursor: 'pointer', transition: 'all var(--transition-fast)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map(msg => (
                <div key={msg.id} className={`message-bubble ${msg.sender_role}`}>
                  <div className="message-content"
                    dangerouslySetInnerHTML={renderMarkdown(msg.content)} />
                  {msg.sender_role === 'assistant' && msg.sources?.length > 0 && (
                    <SourceTags sources={msg.sources} onToast={showToast} />
                  )}
                </div>
              ))}

              {/* Live streaming bubble */}
              {streamText && (
                <div className="message-bubble assistant">
                  <div className="message-content"
                    dangerouslySetInnerHTML={renderMarkdown(streamText)} />
                  {streamSources.length > 0 && (
                    <SourceTags sources={streamSources} onToast={showToast} />
                  )}
                  {/* Blinking cursor indicator */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    <div className="spinner" style={{ width: 10, height: 10 }} />
                    Generating…
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="chat-input-container">
          <form onSubmit={handleSend} className="chat-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="chat-input-box"
              placeholder={
                selectedDocs.length === 0
                  ? 'Select a document above first…'
                  : 'Ask a question about your study material…'
              }
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={generating}
              autoFocus
            />
            <button type="submit" className="btn btn-primary"
              disabled={!input.trim() || generating}
              style={{ width: 48, height: 48, padding: 0, flexShrink: 0 }}>
              {generating
                ? <div className="spinner" style={{ width: 15, height: 15 }} />
                : <Send size={17} />}
            </button>
          </form>
          <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Answers are grounded in your selected documents · Press Enter to send
          </p>
        </div>
      </div>

      {/* Responsive helpers */}
      <style>{`
        @media (max-width: 768px) {
          .mobile-sidebar-toggle { display: flex !important; }
          .sidebar-close-btn { display: flex !important; }
        }
        @media (min-width: 769px) {
          .mobile-sidebar-toggle { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Source citation tags ─────────────────────────────────────────────────────

function SourceTags({
  sources,
  onToast,
}: {
  sources: RagSource[];
  onToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}) {
  return (
    <div className="message-sources" style={{ marginTop: 8 }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Sources:</span>
      {sources.map((src, i) => (
        <div key={i} className="source-tag"
          title={`${src.fileName}\nRelevance: ${Math.round(src.similarity * 100)}%\n\n"${src.contentSnippet}"`}
          onClick={() => onToast(
            `From "${src.fileName}" · ${Math.round(src.similarity * 100)}% match`, 'success'
          )}>
          <FileText size={10} />
          <span>{src.fileName}</span>
        </div>
      ))}
    </div>
  );
}

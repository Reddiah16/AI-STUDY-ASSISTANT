import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchChatSessions, createChatSession, deleteChatSession,
  fetchChatMessages, saveChatMessage,
  type ChatSession, type ChatMessage, type Document,
} from '../services/db';
import { ragAnswer, type RagSource } from '../services/rag';
import { streamGroundedAnswer, type DocumentChunk } from '../services/ai';
import {
  MessageSquare, Plus, Trash2, Send, FileText,
  Sparkles, BookOpen, ArrowLeft, Menu, X,
} from 'lucide-react';

type ActionType = 'summarize' | 'explain' | 'bullets' | 'quiz' | 'flashcards';

interface ChatInterfaceProps {
  user: any;
  allDocuments: Document[];
  initialSelectedDocs: Document[];
  /** If provided, open this session immediately instead of the latest one */
  initialSessionId?: string;
  onBackToDashboard: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

// ─── Structured answer renderer ───────────────────────────────────────────────

interface AnswerSection {
  heading: string;
  lines: string[];
}

/** Maps heading keywords → { icon, accent colour class } */
const SECTION_META: Record<string, { icon: string; accent: string }> = {
  summary:        { icon: '📋', accent: 'accent-blue'   },
  'key concepts': { icon: '🔑', accent: 'accent-purple' },
  'key points':   { icon: '🔑', accent: 'accent-purple' },
  'key concept':  { icon: '🔑', accent: 'accent-purple' },
  explanation:    { icon: '💡', accent: 'accent-yellow'  },
  'tech stack':   { icon: '🛠️', accent: 'accent-teal'   },
  technologies:   { icon: '🛠️', accent: 'accent-teal'   },
  challenges:     { icon: '⚡', accent: 'accent-orange'  },
  difficulties:   { icon: '⚡', accent: 'accent-orange'  },
  learning:       { icon: '📚', accent: 'accent-green'   },
  'what i learned': { icon: '📚', accent: 'accent-green' },
  sources:        { icon: '📄', accent: 'accent-gray'    },
  references:     { icon: '📄', accent: 'accent-gray'    },
  analysis:       { icon: '🔬', accent: 'accent-purple'  },
  results:        { icon: '📊', accent: 'accent-teal'    },
  conclusion:     { icon: '✅', accent: 'accent-green'   },
  overview:       { icon: '🗺️', accent: 'accent-blue'   },
  'study tips':   { icon: '✏️', accent: 'accent-pink'   },
  'revision tips': { icon: '✏️', accent: 'accent-pink'  },
  'synthesized summary': { icon: '📋', accent: 'accent-blue' },
  'section reference': { icon: '📌', accent: 'accent-gray' },
};

function getSectionMeta(heading: string): { icon: string; accent: string } {
  const lower = heading.toLowerCase().replace(/[📘📝💡✏️🔑📋🛠️⚡📚📄🔬📊✅🗺️📌:]/g, '').trim();
  for (const key of Object.keys(SECTION_META)) {
    if (lower.includes(key)) return SECTION_META[key];
  }
  return { icon: '📖', accent: 'accent-gray' };
}

/**
 * Inline text renderer — handles **bold**, *italic*, `code`, and plain text.
 */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={m.index} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={m.index} style={{ color: 'var(--text-secondary)' }}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={m.index} style={{ background: 'var(--bg-surface-elevated)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.83em', color: 'var(--primary-light)' }}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * Parses an array of content lines into bullet items or paragraphs.
 */
function renderLines(lines: string[]): React.ReactNode {
  return lines.map((line, i) => {
    const stripped = line.replace(/^[-•●▪◦■☑✓]\s*/, '').trim();
    if (!stripped) return null;
    const isBullet = /^[-•●▪◦■☑✓]/.test(line.trim());
    if (isBullet) {
      return (
        <div key={i} className="answer-bullet">
          <div className="answer-bullet-dot" />
          <div className="answer-bullet-text">{renderInline(stripped)}</div>
        </div>
      );
    }
    return (
      <p key={i} className="answer-paragraph">{renderInline(stripped)}</p>
    );
  });
}

// ─── Grounding helpers ──────────────────────────────────────────────────────────

function getGroundingLevel(sources: RagSource[]): 'high' | 'medium' | 'low' | 'none' {
  if (sources.length === 0) return 'none';
  const maxSim = Math.max(...sources.map(s => s.similarity));
  if (maxSim >= 0.70) return 'high';
  if (maxSim >= 0.50) return 'medium';
  return 'low';
}

function GroundingBadge({ sources }: { sources: RagSource[] }) {
  const level = getGroundingLevel(sources);
  const n = sources.length;
  const configs = {
    high:   { icon: '🟢', text: `Grounded · ${n} source${n > 1 ? 's' : ''}` },
    medium: { icon: '🟡', text: `Partially grounded · ${n} source${n > 1 ? 's' : ''}` },
    low:    { icon: '🟠', text: `Weak grounding · ${n} source${n > 1 ? 's' : ''}` },
    none:   { icon: '⚪', text: 'General knowledge — no documents matched' },
  };
  const { icon, text } = configs[level];
  return (
    <div className={`grounding-badge ${level}`}>
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

/**
 * Full structured answer renderer.
 * Splits the raw text into sections by ### or #### headings, renders each
 * as a visually distinct card. Grounding badge at top, source chips at bottom.
 */
function StructuredAnswer({
  raw,
  sources = [],
  onOpenSource,
}: {
  raw: string;
  sources?: RagSource[];
  onOpenSource?: (idx: number) => void;
}) {
  const sections: AnswerSection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  raw.split('\n').forEach(rawLine => {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentLines.some(l => l.trim())) {
        sections.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = headingMatch[1].replace(/[*_]/g, '').trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  });
  if (currentHeading || currentLines.some(l => l.trim())) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  const hasHeadings = !(sections.length === 0 || (sections.length === 1 && !sections[0].heading));

  return (
    <div>
      {/* Grounding badge */}
      <GroundingBadge sources={sources} />

      {hasHeadings ? (
        <div className="answer-body">
          {sections.map((sec, idx) => {
            const bodyLines = sec.lines.filter(l => l.trim());
            if (!sec.heading && bodyLines.length === 0) return null;
            if (!sec.heading) {
              return (
                <div key={idx} className="answer-plain">
                  {renderLines(bodyLines)}
                </div>
              );
            }
            const { icon, accent } = getSectionMeta(sec.heading);
            return (
              <div key={idx} className={`section-card ${accent}`}>
                <div className="section-header">
                  <div className="section-icon-wrap">{icon}</div>
                  <div className="section-title">{sec.heading}</div>
                </div>
                {bodyLines.length > 0 && (
                  <div className="section-body">
                    {renderLines(bodyLines)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="answer-plain">
          {renderLines(raw.split('\n'))}
        </div>
      )}

      {/* Source chips — clickable citations */}
      {sources.length > 0 && onOpenSource && (
        <div className="source-chip-row">
          <span className="source-chip-label">Cited:</span>
          {sources.map((src, i) => (
            <button
              key={i}
              className="source-chip"
              onClick={() => onOpenSource(i)}
              title={`${src.fileName} · ${Math.round(src.similarity * 100)}% match — click to view chunk`}
            >
              <span>📄</span>
              <span className="source-chip-name">{src.fileName}</span>
              <span className="source-chip-sim">{Math.round(src.similarity * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      {/* No-document soft warning */}
      {sources.length === 0 && (
        <div className="grounding-warning">
          <span>⚠️</span>
          <span>No document sources were matched. Upload and select study materials for grounded, document-sourced answers.</span>
        </div>
      )}
    </div>
  );
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
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth > 768 : true;
  });
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Streaming state — ephemeral, never persisted
  const [streamText, setStreamText] = useState('');
  const [streamSources, setStreamSources] = useState<RagSource[]>([]);

  // Action bar state
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [visibleSourceIds, setVisibleSourceIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Source drawer state
  const [drawerSources, setDrawerSources] = useState<RagSource[]>([]);
  const [drawerIndex, setDrawerIndex] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sticky Action Bar dynamic fade indicator scroll checking
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const lastMsg = messages[messages.length - 1];
  const showStickyActions = lastMsg && lastMsg.sender_role === 'assistant' && !generating;

  const checkScroll = useCallback(() => {
    const el = actionBarRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 10);
    setShowRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      checkScroll();
    }, 100);
    return () => clearTimeout(timer);
  }, [showStickyActions, checkScroll, messages.length]);

  const openDrawer = (sources: RagSource[], idx: number) => {
    setDrawerSources(sources);
    setDrawerIndex(idx);
  };
  const closeDrawer = () => setDrawerSources([]);

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

  // ── Action bar handlers ────────────────────────────────────────────────────

  const ACTION_PROMPTS: Record<ActionType, string> = {
    summarize:  'Summarize the following study answer into 3-5 concise bullet points with a one-sentence overview at the start.',
    explain:    'Rewrite the following study answer in very simple terms, as if explaining to a curious 12-year-old. Use analogies and plain language.',
    bullets:    'Reformat the following study answer strictly as a clean bulleted list of key points. No paragraphs.',
    quiz:       'Generate 5 short quiz questions with answers, strictly based on the following study answer. Format: Q: ... \nA: ...',
    flashcards: 'Create 5 flashcard pairs from the following study answer. Format each as:\nFront: [term or concept]\nBack: [definition or explanation]',
  };

  const ACTION_LABELS: Record<ActionType, string> = {
    summarize:  'Summarize',
    explain:    'Explain Simply',
    bullets:    'Show Bullets',
    quiz:       'Quiz Me',
    flashcards: 'Flashcards',
  };

  const handleActionQuery = async (action: ActionType, msgId: string, msgContent: string) => {
    if (generating || actionLoadingKey) return;
    const key = `${msgId}-${action}`;
    setActionLoadingKey(key);
    setGenerating(true);
    setStreamText('');
    setStreamSources([]);

    try {
      // Build a synthetic chunk from the existing answer so no retrieval round-trip is needed
      const syntheticChunk: DocumentChunk = {
        id: 'action-ctx',
        documentId: 'action',
        content: msgContent,
        similarity: 1.0,
      };

      const prompt = ACTION_PROMPTS[action];
      const label  = ACTION_LABELS[action];

      // Persist a user-side marker message
      if (currentSession) {
        const userMsg = await saveChatMessage(
          currentSession.id, 'user', `↩ ${label} the previous answer`
        );
        setMessages(prev => [...prev, userMsg]);
      }

      await streamGroundedAnswer(
        prompt,
        [syntheticChunk],
        ['Previous Answer'],
        (partial) => setStreamText(partial),
        async (fullText) => {
          if (currentSession) {
            const assistantMsg = await saveChatMessage(
              currentSession.id, 'assistant', fullText, []
            );
            setMessages(prev => [...prev, assistantMsg]);
          }
          setStreamText('');
          setStreamSources([]);
          setGenerating(false);
          setActionLoadingKey(null);
          inputRef.current?.focus();
        },
        (err) => {
          console.error('[ActionBar]', err);
          showToast(`${label} failed. Please try again.`, 'error');
          setGenerating(false);
          setActionLoadingKey(null);
        },
      );
    } catch (err: any) {
      showToast(err.message || 'Action failed.', 'error');
      setGenerating(false);
      setActionLoadingKey(null);
    }
  };

  const handleToggleSources = (msgId: string) => {
    setVisibleSourceIds(prev => {
      const next = new Set(prev);
      next.has(msgId) ? next.delete(msgId) : next.add(msgId);
      return next;
    });
  };

  const handleCopy = (msgId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => showToast('Copy failed — clipboard not available.', 'error'));
  };

  const handleSaveAnswer = (msgId: string, content: string) => {
    try {
      const saved: Record<string, { content: string; savedAt: string }> =
        JSON.parse(localStorage.getItem('study_saved_answers') || '{}');
      saved[msgId] = { content, savedAt: new Date().toISOString() };
      localStorage.setItem('study_saved_answers', JSON.stringify(saved));
      setSavedIds(prev => new Set([...prev, msgId]));
      showToast('Answer saved to your notebook!', 'success');
    } catch {
      showToast('Could not save answer.', 'error');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="chat-workspace">

      {/* ── Sidebar Backdrop for Mobile ── */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <div className={`chat-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
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
            <button className="btn-icon sidebar-toggle-btn"
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
        <div className={`doc-selection-drawer ${docsExpanded ? 'expanded' : 'collapsed'}`}>
          <button
            type="button"
            className="doc-drawer-toggle"
            onClick={() => setDocsExpanded(!docsExpanded)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '10px 16px',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={14} style={{ color: selectedDocs.length > 0 ? 'var(--primary-light)' : 'var(--text-muted)' }} />
              <span>
                {selectedDocs.length === 0
                  ? 'No documents selected as context'
                  : `${selectedDocs.length} active document${selectedDocs.length > 1 ? 's' : ''}`}
              </span>
            </div>
            <span className="doc-drawer-toggle-arrow" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transition: 'transform var(--transition-fast)', transform: docsExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              ▼
            </span>
          </button>

          {docsExpanded && (
            <div className="doc-drawer-content" style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '12px' }}>
              {allDocuments.length === 0 ? (
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
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
              {messages.map((msg, idx) => (
                <div key={msg.id} className={`message-bubble ${msg.sender_role}`}>
                  <div className="message-content">
                    {msg.sender_role === 'user'
                      ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                      : <StructuredAnswer
                          raw={msg.content}
                          sources={(msg.sources || []) as RagSource[]}
                          onOpenSource={(idx) => openDrawer((msg.sources || []) as RagSource[], idx)}
                        />
                    }
                  </div>

                  {/* Action bar — only for completed assistant messages, but hide for the latest message while the sticky bar is shown */}
                  {msg.sender_role === 'assistant' && (idx !== messages.length - 1) && (
                    <ActionBar
                      msgId={msg.id}
                      msgContent={msg.content}
                      sources={(msg.sources || []) as RagSource[]}
                      sourcesVisible={visibleSourceIds.has(msg.id)}
                      loadingKey={actionLoadingKey}
                      isCopied={copiedId === msg.id}
                      isSaved={savedIds.has(msg.id)}
                      disabled={generating}
                      onAction={(action) => handleActionQuery(action, msg.id, msg.content)}
                      onToggleSources={() => handleToggleSources(msg.id)}
                      onCopy={() => handleCopy(msg.id, msg.content)}
                      onSave={() => handleSaveAnswer(msg.id, msg.content)}
                      onOpenSource={(idx) => openDrawer((msg.sources || []) as RagSource[], idx)}
                      onToast={showToast}
                    />
                  )}
                </div>
              ))}

              {/* Live streaming bubble */}
              {streamText && (
                <div className="message-bubble assistant">
                  <div className="message-content">
                    <StructuredAnswer raw={streamText} />
                  </div>
                  <div className="answer-generating">
                    <div className="spinner" style={{ width: 10, height: 10 }} />
                    Generating…
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Sticky Sources panel for the active/last message when toggled */}
        {showStickyActions && visibleSourceIds.has(lastMsg.id) && lastMsg.sources && (lastMsg.sources as RagSource[]).length > 0 && (
          <div className="sticky-sources-panel">
            <div className="sources-panel-title">Document Sources</div>
            <div className="sources-panel-tags">
              {(lastMsg.sources as RagSource[]).map((src, i) => (
                <div
                  key={i}
                  className="source-tag"
                  title={`${src.fileName} · ${Math.round(src.similarity * 100)}% — click to view chunk`}
                  onClick={() => openDrawer(lastMsg.sources as RagSource[], i)}
                  style={{ cursor: 'pointer' }}
                >
                  <FileText size={10} />
                  <span>{src.fileName}</span>
                  <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>
                    {Math.round(src.similarity * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sticky Bottom Action Bar for the active/last assistant answer */}
        {showStickyActions && (
          <div className="sticky-action-bar-wrap">
            <div className={`fade-indicator-left ${showLeftFade ? 'visible' : ''}`} />
            <div ref={actionBarRef} className="sticky-action-bar" onScroll={checkScroll}>
              {PRIMARY_ACTIONS.map(({ id, icon, label }) => {
                const key = `${lastMsg.id}-${id}`;
                const isLoading = actionLoadingKey === key;
                return (
                  <button
                    key={id}
                    className={`sticky-action-btn ${isLoading ? 'loading' : ''}`}
                    disabled={generating || (actionLoadingKey !== null && !isLoading)}
                    onClick={() => handleActionQuery(id, lastMsg.id, lastMsg.content)}
                    title={label}
                  >
                    <span className="action-btn-icon">{isLoading ? '⏳' : icon}</span>
                    {label}
                  </button>
                );
              })}

              <div className="sticky-action-divider" />

              {/* Utility buttons */}
              {lastMsg.sources && (lastMsg.sources as RagSource[]).length > 0 && (
                <button
                  className={`sticky-action-btn-util ${visibleSourceIds.has(lastMsg.id) ? 'active' : ''}`}
                  onClick={() => handleToggleSources(lastMsg.id)}
                  title={visibleSourceIds.has(lastMsg.id) ? 'Hide sources' : 'Show sources'}
                >
                  📄 Sources
                </button>
              )}

              <button
                className={`sticky-action-btn-util ${copiedId === lastMsg.id ? 'copied' : ''}`}
                onClick={() => handleCopy(lastMsg.id, lastMsg.content)}
                title={copiedId === lastMsg.id ? 'Copied!' : 'Copy answer'}
              >
                {copiedId === lastMsg.id ? '✓' : '⎘'} Copy
              </button>

              <button
                className={`sticky-action-btn-util ${savedIds.has(lastMsg.id) ? 'saved' : ''}`}
                onClick={() => handleSaveAnswer(lastMsg.id, lastMsg.content)}
                title={savedIds.has(lastMsg.id) ? 'Saved!' : 'Save to notebook'}
              >
                {savedIds.has(lastMsg.id) ? '🔖' : '📌'} Save
              </button>
            </div>
            <div className={`fade-indicator-right ${showRightFade ? 'visible' : ''}`} />
          </div>
        )}

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

      {/* ── Source drawer overlay ── */}
      {drawerSources.length > 0 && (
        <SourceDrawer
          sources={drawerSources}
          index={drawerIndex}
          onClose={closeDrawer}
          onChange={setDrawerIndex}
        />
      )}
    </div>
  );
}

// ─── Action Bar ────────────────────────────────────────────────────────────────

interface ActionBarProps {
  msgId: string;
  msgContent: string;
  sources: RagSource[];
  sourcesVisible: boolean;
  loadingKey: string | null;
  isCopied: boolean;
  isSaved: boolean;
  disabled: boolean;
  onAction: (action: ActionType) => void;
  onToggleSources: () => void;
  onCopy: () => void;
  onSave: () => void;
  onOpenSource?: (idx: number) => void;
  onToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

const PRIMARY_ACTIONS: { id: ActionType; icon: string; label: string }[] = [
  { id: 'summarize',  icon: '📋', label: 'Summarize'     },
  { id: 'explain',    icon: '💡', label: 'Explain Simply' },
  { id: 'bullets',    icon: '•',  label: 'Show Bullets'   },
  { id: 'quiz',       icon: '❓', label: 'Quiz Me'        },
  { id: 'flashcards', icon: '🃏', label: 'Flashcards'     },
];

function ActionBar({
  msgId, msgContent, sources, sourcesVisible,
  loadingKey, isCopied, isSaved, disabled,
  onAction, onToggleSources, onCopy, onSave, onOpenSource, onToast,
}: ActionBarProps) {
  return (
    <div>
      <div className="action-bar">
        {/* ── Primary + secondary query actions ── */}
        <div className="action-bar-primary">
          {PRIMARY_ACTIONS.map(({ id, icon, label }, i) => {
            const key = `${msgId}-${id}`;
            const isLoading = loadingKey === key;
            const isPrimary = i === 0;
            return (
              <button
                key={id}
                className={`action-btn${isPrimary ? ' primary' : ''}${isLoading ? ' loading' : ''}`}
                disabled={disabled || (loadingKey !== null && !isLoading)}
                onClick={() => onAction(id)}
                title={label}
              >
                <span className="action-btn-icon">{isLoading ? '⏳' : icon}</span>
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Utility icon buttons ── */}
        <div className="action-bar-utils">
          {/* Show Sources */}
          {sources.length > 0 && (
            <button
              className={`action-btn-util${sourcesVisible ? ' active' : ''}`}
              title={sourcesVisible ? 'Hide sources' : 'Show sources'}
              onClick={onToggleSources}
            >
              📄
            </button>
          )}

          {/* Copy */}
          <button
            className={`action-btn-util${isCopied ? ' copied' : ''}`}
            title={isCopied ? 'Copied!' : 'Copy answer'}
            onClick={onCopy}
          >
            {isCopied ? '✓' : '⎘'}
          </button>

          {/* Save */}
          <button
            className={`action-btn-util${isSaved ? ' saved' : ''}`}
            title={isSaved ? 'Saved!' : 'Save to notebook'}
            onClick={onSave}
          >
            {isSaved ? '🔖' : '📌'}
          </button>
        </div>
      </div>

      {/* ── Sources panel (toggleable) ── */}
      {sourcesVisible && sources.length > 0 && (
        <div className="sources-panel">
          <div className="sources-panel-title">Document Sources</div>
          <div className="sources-panel-tags">
            {sources.map((src, i) => (
              <div
                key={i}
                className="source-tag"
                title={`${src.fileName} · ${Math.round(src.similarity * 100)}% — click to view chunk`}
                onClick={() => onOpenSource ? onOpenSource(i) : onToast(
                  `From "${src.fileName}" · ${Math.round(src.similarity * 100)}% match`, 'success'
                )}
                style={{ cursor: 'pointer' }}
              >
                <FileText size={10} />
                <span>{src.fileName}</span>
                <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>
                  {Math.round(src.similarity * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Source Drawer ─────────────────────────────────────────────────────────────

function SourceDrawer({
  sources,
  index,
  onClose,
  onChange,
}: {
  sources: RagSource[];
  index: number;
  onClose: () => void;
  onChange: (idx: number) => void;
}) {
  const src = sources[index];
  const sim = Math.round(src.similarity * 100);
  const HIGHLIGHT_LEN = 180;
  const simColor =
    sim >= 70 ? 'hsl(142, 72%, 55%)' :
    sim >= 50 ? 'hsl(45, 93%, 65%)' :
                'hsl(22, 92%, 65%)';

  return (
    <div className="source-drawer-overlay" onClick={onClose}>
      <div className="source-drawer" onClick={e => e.stopPropagation()}>
        {/* Drag handle */}
        <div className="source-drawer-handle" />

        {/* Header */}
        <div className="source-drawer-header">
          <div>
            <div className="source-drawer-subtitle">Source {index + 1} of {sources.length}</div>
            <div className="source-drawer-filename">📄 {src.fileName}</div>
          </div>
          <button className="source-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Similarity bar */}
        <div className="source-drawer-sim">
          <span className="source-sim-value" style={{ color: simColor }}>{sim}% match</span>
          <div className="source-sim-track">
            <div
              className="source-sim-fill"
              style={{ width: `${sim}%`, background: simColor }}
            />
          </div>
        </div>

        {/* Chunk content with highlighted snippet */}
        <div className="source-content-box">
          <div className="source-content-label">Retrieved chunk · {src.content.length} chars</div>
          <div className="source-content-text">
            <span className="source-highlight">
              {src.content.substring(0, HIGHLIGHT_LEN)}
            </span>
            <span className="source-rest">
              {src.content.substring(HIGHLIGHT_LEN)}
            </span>
          </div>
        </div>

        {/* Navigation */}
        {sources.length > 1 && (
          <div className="source-drawer-nav">
            <button
              className="source-nav-btn"
              disabled={index === 0}
              onClick={() => onChange(index - 1)}
            >
              ◀ Prev
            </button>
            <span className="source-nav-counter">{index + 1} / {sources.length}</span>
            <button
              className="source-nav-btn"
              disabled={index === sources.length - 1}
              onClick={() => onChange(index + 1)}
            >
              Next ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

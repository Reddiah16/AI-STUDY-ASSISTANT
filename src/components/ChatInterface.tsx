import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { supabase, isSupabaseConfigured } from '../lib/supabase';

type ActionType = 'summarize' | 'explain' | 'bullets' | 'quiz' | 'flashcards';

export type StudyMode = 'normal' | 'simple' | 'exam' | 'revision' | 'flashcard' | 'quiz';

export const STUDY_TAGS = ['Important', 'Definitions', 'Needs Revision'];

export const STUDY_MODE_PROMPTS: Record<StudyMode, string> = {
  normal: '',
  simple: '\n[STUDY MODE: Simple Explanation] Format the output as a simple explanation using everyday language and an intuitive analogy or a metaphor that a child could understand. Avoid technical jargon or explain it immediately in plain words.',
  exam: '\n[STUDY MODE: Exam Prep] Format the output as a structured, formal academic answer. Highlight clear definitions, key bulleted points, and any critical terms. Conclude with 2 potential review questions.',
  revision: '\n[STUDY MODE: Revision] Format the output as bulleted revision notes. Use bold terms, headers, key definitions, and quick bullets. Make it highly scannable for rapid studying.',
  flashcard: '\n[STUDY MODE: Flashcards] Format the output strictly as a set of Front/Back flashcards (at least 3 cards). Format each card as:\nFront: [concept or question]\nBack: [concise definition or explanation]',
  quiz: '\n[STUDY MODE: Quiz] Format the output strictly as a study quiz. Generate 3-5 multiple-choice or short-answer questions with correct answers listed at the very bottom.'
};

export const STUDY_MODES = [
  { id: 'normal', label: '📖 Normal', desc: 'Standard grounded study answers' },
  { id: 'simple', label: '👶 Simple', desc: 'Explanation using simple analogies' },
  { id: 'exam', label: '🎓 Exam Prep', desc: 'Academic styling and sample questions' },
  { id: 'revision', label: '📝 Revision', desc: 'Scannable bullet summary notes' },
  { id: 'flashcard', label: '🃏 Flashcards', desc: 'Front/Back flashcard study deck' },
  { id: 'quiz', label: '❓ Quiz', desc: '3-5 test-yourself questions' },
];

interface ChatInterfaceProps {
  user: any;
  allDocuments: Document[];
  initialSelectedDocs: Document[];
  /** If provided, open this session immediately instead of the latest one */
  initialSessionId?: string;
  onBackToDashboard: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

// ─── Notebook Drawer Component ───────────────────────────────────────────────

function NotebookDrawer({
  savedAnswers,
  onClose,
  onRemove,
}: {
  savedAnswers: Record<string, { content: string; savedAt: string; query: string; tags?: string[] }>;
  onClose: () => void;
  onRemove: (msgId: string) => void;
}) {
  const items = Object.entries(savedAnswers).sort(
    (a, b) => new Date(b[1].savedAt).getTime() - new Date(a[1].savedAt).getTime()
  );
  const [selectedIdx, setSelectedIdx] = useState(0);

  // If items shrink or delete occurred
  useEffect(() => {
    if (selectedIdx >= items.length && items.length > 0) {
      setSelectedIdx(items.length - 1);
    }
  }, [items.length, selectedIdx]);

  if (items.length === 0) {
    return (
      <div className="source-drawer-overlay" onClick={onClose}>
        <div className="source-drawer" style={{ padding: '24px', textAlign: 'center', maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
          <div className="source-drawer-handle" />
          <h3 style={{ marginBottom: 12, fontFamily: 'var(--font-display)' }}>Study Notebook</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No bookmarked study answers yet.</p>
          <button className="btn btn-secondary" onClick={onClose} style={{ marginTop: 16, width: '100%' }}>Close</button>
        </div>
      </div>
    );
  }

  const [msgId, data] = items[selectedIdx];

  return (
    <div className="source-drawer-overlay" onClick={onClose}>
      <div className="source-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: '720px' }}>
        <div className="source-drawer-handle" />
        
        <div className="source-drawer-header">
          <div>
            <div className="source-drawer-subtitle">Notebook Entry {selectedIdx + 1} of {items.length}</div>
            <div className="source-drawer-filename">🔖 {data.query}</div>
          </div>
          <button className="source-drawer-close" onClick={onClose}>✕</button>
        </div>

        {/* Tags sub-header */}
        <div style={{ display: 'flex', gap: '8px', padding: '10px 22px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Applied Tags:</span>
          {(data.tags || []).length === 0 ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>None</span>
          ) : (
            (data.tags || []).map(t => {
              const tagColors: Record<string, string> = {
                'Important': 'tag-important active',
                'Definitions': 'tag-definitions active',
                'Needs Revision': 'tag-revision active'
              };
              return (
                <span key={t} className={`study-tag-pill ${tagColors[t] || ''}`} style={{ padding: '2px 8px', fontSize: '0.68rem', pointerEvents: 'none' }}>
                  {t}
                </span>
              );
            })
          )}
        </div>

        <div className="source-content-box" style={{ padding: '20px 22px' }}>
          <StructuredAnswer raw={data.content} />
        </div>

        <div className="source-drawer-nav">
          <button
            className="source-nav-btn"
            disabled={selectedIdx === 0}
            onClick={() => setSelectedIdx(selectedIdx - 1)}
          >
            ◀ Prev
          </button>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '0.78rem' }} onClick={() => onRemove(msgId)}>
              🗑️ Delete
            </button>
            <span className="source-nav-counter">{selectedIdx + 1} / {items.length}</span>
          </div>

          <button
            className="source-nav-btn"
            disabled={selectedIdx === items.length - 1}
            onClick={() => setSelectedIdx(selectedIdx + 1)}
          >
            Next ▶
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Answer Skeleton Loader ──────────────────────────────────────────────────

function AnswerSkeletonLoader() {
  return (
    <div className="skeleton-container animate-pulse">
      <div className="skeleton-card-item">
        <div className="skeleton-hdr">
          <div className="skeleton-icon" />
          <div className="skeleton-title" />
        </div>
        <div className="skeleton-body">
          <div className="skeleton-line l-90" />
          <div className="skeleton-line l-75" />
          <div className="skeleton-line l-50" />
        </div>
      </div>
      <div className="skeleton-card-item" style={{ opacity: 0.65 }}>
        <div className="skeleton-hdr">
          <div className="skeleton-icon" />
          <div className="skeleton-title" />
        </div>
        <div className="skeleton-body">
          <div className="skeleton-line l-90" />
          <div className="skeleton-line l-75" />
        </div>
      </div>
    </div>
  );
}

function CompactSessionSkeleton() {
  return (
    <div className="skeleton-container animate-pulse" style={{ gap: '8px', padding: '0 8px' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 0', opacity: 1 - (i - 1) * 0.18 }}>
          <div className="skeleton-icon" style={{ width: 14, height: 14, borderRadius: '3px' }} />
          <div className="skeleton-line" style={{ flex: 1, height: 10, borderRadius: '3px' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Follow-up suggestion chips types & components ───────────────────────────

interface SuggestionChip {
  id: string;
  label: string;
  prompt: string;
}

function getSuggestionsForAnswer(content: string): SuggestionChip[] {
  const lower = content.toLowerCase();
  const chips: SuggestionChip[] = [];

  const hasCode = content.includes('```') || lower.includes('const ') || lower.includes('function ') || lower.includes('import ');
  const isQuiz = lower.includes('q:') || lower.includes('front:') || lower.includes('question:');
  const isShort = content.length < 400;

  if (hasCode) {
    chips.push({ id: 'explain_code', label: '💻 Explain Code', prompt: 'Walk through the code block in the previous answer step-by-step and explain how it works.' });
    chips.push({ id: 'example', label: '💡 Give Example', prompt: 'Provide another code example or concrete application of this concept.' });
  } else {
    chips.push({ id: 'example', label: '💡 Give Example', prompt: 'Provide a concrete, real-world example explaining the key concepts in the previous answer.' });
  }

  if (isQuiz) {
    chips.push({ id: 'explain_answers', label: '🧠 Explain Answers', prompt: 'Go through the questions in the previous answer and explain the reasoning behind each correct answer.' });
    chips.push({ id: 'notes', label: '📝 Create Revision Notes', prompt: 'Generate structured, easy-to-read revision notes based on these questions.' });
  } else {
    if (!isShort) {
      chips.push({ id: 'shorter', label: '⚡ Make Shorter', prompt: 'Summarize the previous answer to make it significantly shorter and more concise while keeping the main points.' });
    }
    chips.push({ id: 'simple', label: '👶 Explain Simply', prompt: 'Explain the previous answer in extremely simple words with an analogy, suitable for a beginner.' });
  }

  if (!isQuiz) {
    chips.push({ id: 'questions', label: '❓ Important Questions', prompt: 'List 3-5 key exam or study questions based on the concepts discussed in the previous answer.' });
    chips.push({ id: 'test', label: '🎯 Test Me', prompt: 'Ask me 3 multiple-choice or short questions to test my understanding of the previous answer. Wait for my response before giving answers.' });
  }

  return chips.slice(0, 4);
}

interface SuggestionChipsProps {
  msgContent: string;
  onSelect: (chip: SuggestionChip) => void;
  loadingId: string | null;
  disabled: boolean;
}

function SuggestionChips({
  msgContent,
  onSelect,
  loadingId,
  disabled,
}: SuggestionChipsProps) {
  const chips = getSuggestionsForAnswer(msgContent);

  return (
    <div className="suggestion-chips-container">
      {chips.map(chip => {
        const isLoading = loadingId === chip.id;
        return (
          <button
            key={chip.id}
            className={`suggestion-chip ${isLoading ? 'loading' : ''}`}
            onClick={() => onSelect(chip)}
            disabled={disabled}
          >
            {isLoading ? <span className="chip-spinner" /> : null}
            <span>{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
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
    const trimmedLine = line.trim();
    const isBullet = /^[-•●▪◦■☑✓]/.test(trimmedLine);
    if (isBullet) {
      const stripped = trimmedLine.replace(/^[-•●▪◦■☑✓]\s*/, '');
      if (!stripped) return null;
      return (
        <div key={i} className="answer-bullet">
          <div className="answer-bullet-dot" />
          <div className="answer-bullet-text">{renderInline(stripped)}</div>
        </div>
      );
    }
    if (!trimmedLine) return null;
    return (
      <p key={i} className="answer-paragraph">{renderInline(trimmedLine)}</p>
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
  onRetry,
}: {
  raw: string;
  sources?: RagSource[];
  onOpenSource?: (idx: number) => void;
  onRetry?: () => void;
}) {
  if (raw.startsWith('[ERROR]')) {
    const errorMsg = raw.replace('[ERROR]', '').trim();
    return (
      <div className="chat-error-card">
        <div className="chat-error-header">
          <span>⚠️</span>
          <span>Study Assistant Error</span>
        </div>
        <div className="chat-error-body">
          {errorMsg}
        </div>
        {onRetry && (
          <button type="button" className="btn btn-secondary chat-error-retry-btn" onClick={onRetry}>
            🔄 Retry Generation
          </button>
        )}
      </div>
    );
  }
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

  // Action bar state
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [visibleSourceIds, setVisibleSourceIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);

  // Study Mode, Notebook, and collapsible states
  const [activeMode, setActiveMode] = useState<StudyMode>('normal');
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [savedAnswers, setSavedAnswers] = useState<Record<string, any>>({});
  const [messageTags, setMessageTags] = useState<Record<string, string[]>>({});
  const [sidebarNotebookExpanded, setSidebarNotebookExpanded] = useState(false);
  const [sidebarDoubtsExpanded, setSidebarDoubtsExpanded] = useState(false);

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

  // Dynamic Recent Doubts shortcut generator (clean user questions)
  const recentDoubts = useMemo(() => {
    return Array.from(new Set(
      messages
        .filter(m => m.sender_role === 'user' && !m.content.startsWith('↩') && !m.content.startsWith('👉'))
        .map(m => m.content)
    )).slice(-5).reverse();
  }, [messages]);

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

  // Load Saved Notebook and Message Tags
  const loadSavedAnswers = useCallback(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('study_saved_answers') || '{}');
      setSavedAnswers(saved);
      // Synchronize savedIds set
      setSavedIds(new Set(Object.keys(saved)));
    } catch {
      setSavedAnswers({});
    }
  }, []);

  const loadMessageTags = useCallback(() => {
    try {
      const tags = JSON.parse(localStorage.getItem('study_message_tags') || '{}');
      setMessageTags(tags);
    } catch {
      setMessageTags({});
    }
  }, []);

  useEffect(() => {
    loadSavedAnswers();
    loadMessageTags();
  }, [loadSavedAnswers, loadMessageTags]);

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

  const handleGenerationError = useCallback(async (err: Error, customToastMsg: string) => {
    showToast(customToastMsg, 'error');
    if (currentSession) {
      try {
        const errMsg = await saveChatMessage(
          currentSession.id,
          'assistant',
          `[ERROR] ${err.message || 'Generation failed. Please try again.'}`
        );
        setMessages(prev => [...prev, errMsg]);
      } catch (saveErr) {
        console.error('Failed to save error message', saveErr);
      }
    }
    setGenerating(false);
  }, [currentSession, showToast]);

  // ── Send message ───────────────────────────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !currentSession || generating) return;

    const query = input.trim();
    setInput('');
    setGenerating(true);
    setStreamText('');

    try {
      // 1. Persist user message
      const userMsg = await saveChatMessage(currentSession.id, 'user', query);
      setMessages(prev => [...prev, userMsg]);

      // 2. Call the RAG service (placeholder → real LLM hook point)
      await ragAnswer(
        {
          query: query + (STUDY_MODE_PROMPTS[activeMode] || ''),
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
              setGenerating(false);
              inputRef.current?.focus();
            }
          },
          onError: (err) => handleGenerationError(err, 'Failed to generate answer. Please try again.'),
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
          setGenerating(false);
          setActionLoadingKey(null);
          inputRef.current?.focus();
        },
        (err) => {
          handleGenerationError(err, `${label} failed. Please try again.`);
          setActionLoadingKey(null);
        },
      );
    } catch (err: any) {
      showToast(err.message || 'Action failed.', 'error');
      setGenerating(false);
      setActionLoadingKey(null);
    }
  };

  const handleFollowUp = async (label: string, promptText: string, parentContent: string) => {
    if (generating) return;
    setGenerating(true);
    setStreamText('');

    try {
      const syntheticChunk: DocumentChunk = {
        id: 'action-ctx',
        documentId: 'action',
        content: parentContent,
        similarity: 1.0,
      };

      if (currentSession) {
        const userMsg = await saveChatMessage(
          currentSession.id,
          'user',
          `👉 ${label}`
        );
        setMessages(prev => [...prev, userMsg]);
      }

      await streamGroundedAnswer(
        promptText,
        [syntheticChunk],
        ['Previous Answer Context'],
        (partial) => setStreamText(partial),
        async (fullText) => {
          if (currentSession) {
            const assistantMsg = await saveChatMessage(
              currentSession.id,
              'assistant',
              fullText,
              []
            );
            setMessages(prev => [...prev, assistantMsg]);
          }
          setStreamText('');
          setGenerating(false);
          inputRef.current?.focus();
        },
        (err) => handleGenerationError(err, 'Failed to generate answer. Please try again.'),
      );
    } catch (err: any) {
      showToast(err.message || 'Follow-up failed.', 'error');
      setGenerating(false);
    }
  };

  const handleSuggestionClick = async (chip: SuggestionChip, msgContent: string) => {
    if (generating || selectedSuggestionId) return;
    setSelectedSuggestionId(chip.id);
    await handleFollowUp(chip.label, chip.prompt, msgContent);
    setSelectedSuggestionId(null);
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
      const msgIdx = messages.findIndex(m => m.id === msgId);
      let query = 'Saved Answer';
      if (msgIdx > 0 && messages[msgIdx - 1].sender_role === 'user') {
        query = messages[msgIdx - 1].content;
      }

      const saved: Record<string, { content: string; savedAt: string; query: string; tags?: string[] }> =
        JSON.parse(localStorage.getItem('study_saved_answers') || '{}');
      saved[msgId] = {
        content,
        savedAt: new Date().toISOString(),
        query,
        tags: messageTags[msgId] || []
      };
      localStorage.setItem('study_saved_answers', JSON.stringify(saved));
      setSavedIds(prev => new Set([...prev, msgId]));
      loadSavedAnswers();
      showToast('Answer saved to your notebook!', 'success');
    } catch {
      showToast('Could not save answer.', 'error');
    }
  };

  const toggleMessageTag = (msgId: string, tag: string) => {
    const current = messageTags[msgId] || [];
    const updated = current.includes(tag)
      ? current.filter(t => t !== tag)
      : [...current, tag];
    
    const nextTags = { ...messageTags, [msgId]: updated };
    setMessageTags(nextTags);
    localStorage.setItem('study_message_tags', JSON.stringify(nextTags));
    
    // Sync with Saved Notebook
    const saved = JSON.parse(localStorage.getItem('study_saved_answers') || '{}');
    if (saved[msgId]) {
      saved[msgId].tags = updated;
      localStorage.setItem('study_saved_answers', JSON.stringify(saved));
      loadSavedAnswers();
    }
    showToast(`Updated tags for answer`, 'success');
  };

  const deleteMessage = async (msgId: string) => {
    if (isSupabaseConfigured) {
      await supabase.from('messages').delete().eq('id', msgId);
    } else {
      const MOCK_MESSAGES = 'study_assistant_messages';
      const msgs = JSON.parse(localStorage.getItem(MOCK_MESSAGES) || '[]');
      const filtered = msgs.filter((m: any) => m.id !== msgId);
      localStorage.setItem(MOCK_MESSAGES, JSON.stringify(filtered));
    }
  };

  const regenerateLastAnswer = async (mode: StudyMode) => {
    const msgList = [...messages];
    const lastAssistantIdx = msgList.map(m => m.sender_role).lastIndexOf('assistant');
    if (lastAssistantIdx === -1) return;

    const lastAssistantMsg = msgList[lastAssistantIdx];
    
    let precedingUserMsg = null;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (msgList[i].sender_role === 'user') {
        precedingUserMsg = msgList[i];
        break;
      }
    }
    if (!precedingUserMsg) return;

    const query = precedingUserMsg.content;

    const filteredMessages = messages.filter(m => m.id !== lastAssistantMsg.id);
    setMessages(filteredMessages);

    try {
      await deleteMessage(lastAssistantMsg.id);
    } catch (err) {
      console.error('Failed to delete old assistant message', err);
    }

    setGenerating(true);
    setStreamText('');

    try {
      await ragAnswer(
        {
          query: query + (STUDY_MODE_PROMPTS[mode] || ''),
          documentIds: selectedDocs.map(d => d.id),
          documentNames: selectedDocs.map(d => d.file_name),
          sessionId: currentSession!.id,
        },
        {
          onChunk: (partial) => setStreamText(partial),
          onComplete: async (fullText, sources) => {
            try {
              const assistantMsg = await saveChatMessage(
                currentSession!.id, 'assistant', fullText,
                sources
              );
              setMessages(prev => [...prev, assistantMsg]);
            } catch (err) {
              console.error('Failed to save regenerated assistant message', err);
            } finally {
              setStreamText('');
              setGenerating(false);
              inputRef.current?.focus();
            }
          },
          onError: (err) => handleGenerationError(err, 'Failed to regenerate answer. Please try again.'),
        }
      );
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Something went wrong.', 'error');
      setGenerating(false);
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
            <CompactSessionSkeleton />
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

          {/* Collapsible Study Sections */}
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            
            {/* Saved Notebook collapsible */}
            <div>
              <button
                onClick={() => setSidebarNotebookExpanded(!sidebarNotebookExpanded)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '6px 8px', borderRadius: '4px'
                }}
              >
                <span>Notebook ({Object.keys(savedAnswers).length})</span>
                <span style={{ fontSize: '0.6rem' }}>{sidebarNotebookExpanded ? '▼' : '▶'}</span>
              </button>
              
              <div className={`collapsible-wrapper ${sidebarNotebookExpanded ? 'expanded' : ''}`}>
                <div className="collapsible-content" style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '4px' }}>
                  {Object.keys(savedAnswers).length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 8px', fontStyle: 'italic' }}>
                      No saved answers.
                    </div>
                  ) : (
                    Object.entries(savedAnswers).map(([id, item]) => (
                      <div
                        key={id}
                        onClick={() => setNotebookOpen(true)}
                        style={{
                          fontSize: '0.8rem', padding: '6px 8px', borderRadius: '6px',
                          cursor: 'pointer', color: 'var(--text-secondary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}
                        className="sidebar-notebook-item"
                        title={item.query}
                      >
                        🔖 {item.query}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Recent Doubts collapsible */}
            <div>
              <button
                onClick={() => setSidebarDoubtsExpanded(!sidebarDoubtsExpanded)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '6px 8px', borderRadius: '4px'
                }}
              >
                <span>Recent Doubts</span>
                <span style={{ fontSize: '0.6rem' }}>{sidebarDoubtsExpanded ? '▼' : '▶'}</span>
              </button>
              
              <div className={`collapsible-wrapper ${sidebarDoubtsExpanded ? 'expanded' : ''}`}>
                <div className="collapsible-content" style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '4px' }}>
                  {recentDoubts.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 8px', fontStyle: 'italic' }}>
                      No recent questions.
                    </div>
                  ) : (
                    recentDoubts.map((doubt, idx) => (
                      <div
                        key={idx}
                        onClick={() => { setInput(doubt); inputRef.current?.focus(); }}
                        style={{
                          fontSize: '0.8rem', padding: '6px 8px', borderRadius: '6px',
                          cursor: 'pointer', color: 'var(--text-secondary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}
                        className="sidebar-notebook-item"
                        title={doubt}
                      >
                        ❓ {doubt}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

          </div>
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

          <div className={`collapsible-wrapper ${docsExpanded ? 'expanded' : ''}`} style={{ borderTop: docsExpanded ? '1px solid var(--border-color)' : '1px solid transparent', transition: 'all var(--transition-normal) cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <div className="collapsible-content">
              <div className="doc-drawer-content" style={{ padding: '8px 16px 16px', paddingTop: '12px' }}>
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
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages-container">
          {loadingMessages ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          ) : messages.length === 0 && !streamText ? (
            /* Empty state */
            <div className="chat-empty-state">
              <div className="chat-empty-state-icon-wrap">
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
                      className="empty-state-suggestion"
                    >
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
                          onRetry={() => regenerateLastAnswer(activeMode)}
                        />
                    }
                  </div>

                  {/* Topic Tags Pills */}
                  {msg.sender_role === 'assistant' && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tags:</span>
                      {STUDY_TAGS.map(tag => {
                        const active = (messageTags[msg.id] || []).includes(tag);
                        const tagColors: Record<string, string> = {
                          'Important': 'tag-important',
                          'Definitions': 'tag-definitions',
                          'Needs Revision': 'tag-revision'
                        };
                        return (
                          <button
                            key={tag}
                            className={`study-tag-pill ${tagColors[tag]} ${active ? 'active' : ''}`}
                            onClick={() => toggleMessageTag(msg.id, tag)}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Action bar — only for completed assistant messages, but hide for the latest message while the sticky bar is shown */}
                  {msg.sender_role === 'assistant' && (idx !== messages.length - 1) && (
                    <ActionBar
                      msgId={msg.id}
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

                  {/* Suggestion Chips — only for the latest completed assistant message */}
                  {msg.sender_role === 'assistant' && (idx === messages.length - 1) && !generating && (
                    <SuggestionChips
                      msgContent={msg.content}
                      onSelect={(chip) => handleSuggestionClick(chip, msg.content)}
                      loadingId={selectedSuggestionId}
                      disabled={generating || selectedSuggestionId !== null}
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

              {/* Skeleton loading bubble during initial prompt process wait */}
              {generating && !streamText && (
                <div className="message-bubble assistant">
                  <div className="message-content">
                    <AnswerSkeletonLoader />
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
          {/* Study Mode Selector tabs */}
          <div className="study-modes-bar">
            {STUDY_MODES.map(mode => (
              <button
                key={mode.id}
                type="button"
                className={`study-mode-tab ${activeMode === mode.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveMode(mode.id as StudyMode);
                  showToast(`Switched study mode to: ${mode.label}`, 'success');
                  // If last message is assistant, automatically regenerate it
                  const last = messages[messages.length - 1];
                  if (last && last.sender_role === 'assistant' && !generating) {
                    regenerateLastAnswer(mode.id as StudyMode);
                  }
                }}
                title={mode.desc}
              >
                {mode.label}
              </button>
            ))}
          </div>

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

      {/* ── Notebook drawer overlay ── */}
      {notebookOpen && (
        <NotebookDrawer
          savedAnswers={savedAnswers}
          onClose={() => setNotebookOpen(false)}
          onRemove={(id) => {
            const saved = JSON.parse(localStorage.getItem('study_saved_answers') || '{}');
            delete saved[id];
            localStorage.setItem('study_saved_answers', JSON.stringify(saved));
            setSavedAnswers(saved);
            setSavedIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            showToast('Deleted from Notebook', 'warning');
          }}
        />
      )}
    </div>
  );
}

// ─── Action Bar ────────────────────────────────────────────────────────────────

interface ActionBarProps {
  msgId: string;
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
  msgId, sources, sourcesVisible,
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

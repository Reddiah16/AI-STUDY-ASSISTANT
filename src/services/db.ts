import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { type DocumentChunk, chunkDocument, generateMockEmbedding } from './ai';

// --- Database Interfaces ---

export interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string;
  updated_at?: string;
}

export interface Document {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  file_size: number;
  content_text: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_role: 'user' | 'assistant';
  content: string;
  sources: any[];
  created_at: string;
}

// --- LocalStorage Helpers (for Demo/Mock mode) ---

const MOCK_PROFILES = 'study_assistant_profiles';
const MOCK_DOCUMENTS = 'study_assistant_documents';
const MOCK_CHUNKS = 'study_assistant_chunks';
const MOCK_SESSIONS = 'study_assistant_sessions';
const MOCK_MESSAGES = 'study_assistant_messages';

function getLocal<T>(key: string, defaultValue: T): T {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : defaultValue;
}

function setLocal<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Profiles Service ---

export async function getProfile(userId: string): Promise<Profile | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile from Supabase:', error);
      return null;
    }
    return data;
  }

  const profiles = getLocal<Record<string, Profile>>(MOCK_PROFILES, {});
  return profiles[userId] || { id: userId, full_name: 'Demo Student' };
}

export async function updateProfile(userId: string, profile: Partial<Profile>): Promise<Profile> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...profile })
      .select()
      .single();

    if (error) throw new Error(`Profile update failed: ${error.message}`);
    return data;
  }

  const profiles = getLocal<Record<string, Profile>>(MOCK_PROFILES, {});
  const existing = profiles[userId] || { id: userId, full_name: 'Demo Student' };
  const updated = { ...existing, ...profile, updated_at: new Date().toISOString() };
  profiles[userId] = updated;
  setLocal(MOCK_PROFILES, profiles);
  return updated;
}

// --- Documents Service ---

export async function fetchDocuments(userId: string): Promise<Document[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching documents from Supabase:', error);
      return [];
    }
    return data || [];
  }

  const docs = getLocal<Document[]>(MOCK_DOCUMENTS, []);
  return docs.filter(d => d.user_id === userId);
}

export async function saveDocumentMetadata(
  userId: string,
  fileName: string,
  filePath: string,
  fileUrl: string,
  fileSize: number,
  contentText: string
): Promise<Document> {
  if (isSupabaseConfigured) {
    // 1. Save document metadata to DB
    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        user_id: userId,
        file_name: fileName,
        file_path: filePath,
        file_url: fileUrl,
        file_size: fileSize,
        content_text: contentText
      })
      .select()
      .single();

    if (docError) throw new Error(`Database error saving document: ${docError.message}`);

    // 2. Perform chunking & create embeddings
    const textChunks = chunkDocument(contentText);
    const chunksData = textChunks.map((chunk, idx) => ({
      document_id: document.id,
      content: chunk,
      metadata: { page: idx + 1, name: fileName },
      embedding: generateMockEmbedding(chunk) // Generate compatible vector dimensions
    }));

    if (chunksData.length > 0) {
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert(chunksData);
      
      if (chunkError) {
        console.error('Failed to save document chunks to Supabase, but metadata is saved:', chunkError.message);
      }
    }

    return document;
  }

  // Local Storage Flow
  const docs = getLocal<Document[]>(MOCK_DOCUMENTS, []);
  const newDoc: Document = {
    id: crypto.randomUUID(),
    user_id: userId,
    file_name: fileName,
    file_path: filePath,
    file_url: fileUrl,
    file_size: fileSize,
    content_text: contentText,
    created_at: new Date().toISOString()
  };

  docs.unshift(newDoc);
  setLocal(MOCK_DOCUMENTS, docs);

  // Split and save chunks locally
  const textChunks = chunkDocument(contentText);
  const localChunks = getLocal<DocumentChunk[]>(MOCK_CHUNKS, []);
  textChunks.forEach((chunk) => {
    localChunks.push({
      id: crypto.randomUUID(),
      documentId: newDoc.id,
      content: chunk
    });
  });
  setLocal(MOCK_CHUNKS, localChunks);

  return newDoc;
}

export async function deleteDocument(documentId: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (error) throw new Error(`Failed to delete document from Postgres: ${error.message}`);
    return;
  }

  // Local Storage Delete
  let docs = getLocal<Document[]>(MOCK_DOCUMENTS, []);
  docs = docs.filter(d => d.id !== documentId);
  setLocal(MOCK_DOCUMENTS, docs);

  let chunks = getLocal<DocumentChunk[]>(MOCK_CHUNKS, []);
  chunks = chunks.filter(c => c.documentId !== documentId);
  setLocal(MOCK_CHUNKS, chunks);
}

/**
 * Gets all chunks for given document IDs
 */
export async function getDocumentChunks(documentIds: string[]): Promise<DocumentChunk[]> {
  if (documentIds.length === 0) return [];

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('document_chunks')
      .select('id, document_id, content')
      .in('document_id', documentIds);

    if (error) {
      console.error('Error fetching document chunks:', error);
      return [];
    }

    return (data || []).map(chunk => ({
      id: chunk.id,
      documentId: chunk.document_id,
      content: chunk.content
    }));
  }

  const allChunks = getLocal<DocumentChunk[]>(MOCK_CHUNKS, []);
  return allChunks.filter(c => documentIds.includes(c.documentId));
}

// --- Chat Sessions Service ---

export async function fetchChatSessions(userId: string): Promise<ChatSession[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching chat sessions:', error);
      return [];
    }
    return data || [];
  }

  const sessions = getLocal<ChatSession[]>(MOCK_SESSIONS, []);
  return sessions.filter(s => s.user_id === userId);
}

export async function createChatSession(userId: string, title: string): Promise<ChatSession> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ user_id: userId, title })
      .select()
      .single();

    if (error) throw new Error(`Failed to create chat session: ${error.message}`);
    return data;
  }

  const sessions = getLocal<ChatSession[]>(MOCK_SESSIONS, []);
  const newSession: ChatSession = {
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    created_at: new Date().toISOString()
  };

  sessions.unshift(newSession);
  setLocal(MOCK_SESSIONS, sessions);
  return newSession;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) throw new Error(`Failed to delete chat session: ${error.message}`);
    return;
  }

  let sessions = getLocal<ChatSession[]>(MOCK_SESSIONS, []);
  sessions = sessions.filter(s => s.id !== sessionId);
  setLocal(MOCK_SESSIONS, sessions);

  let messages = getLocal<ChatMessage[]>(MOCK_MESSAGES, []);
  messages = messages.filter(m => m.session_id !== sessionId);
  setLocal(MOCK_MESSAGES, messages);
}

// --- Chat Messages Service ---

export async function fetchChatMessages(sessionId: string): Promise<ChatMessage[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching chat messages:', error);
      return [];
    }
    return data || [];
  }

  const messages = getLocal<ChatMessage[]>(MOCK_MESSAGES, []);
  return messages
    .filter(m => m.session_id === sessionId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function saveChatMessage(
  sessionId: string,
  senderRole: 'user' | 'assistant',
  content: string,
  sources: any[] = []
): Promise<ChatMessage> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        sender_role: senderRole,
        content,
        sources
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to save message: ${error.message}`);
    return data;
  }

  const messages = getLocal<ChatMessage[]>(MOCK_MESSAGES, []);
  const newMessage: ChatMessage = {
    id: crypto.randomUUID(),
    session_id: sessionId,
    sender_role: senderRole,
    content,
    sources,
    created_at: new Date().toISOString()
  };

  messages.push(newMessage);
  setLocal(MOCK_MESSAGES, messages);
  return newMessage;
}

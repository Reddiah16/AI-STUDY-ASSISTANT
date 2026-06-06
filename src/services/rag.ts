/**
 * RAG (Retrieval-Augmented Generation) Service
 * ─────────────────────────────────────────────
 * This module is the single integration point for AI answer generation.
 *
 * CURRENT STATE  →  Simulated/placeholder pipeline (no API key required).
 * FUTURE STATE   →  Replace `ragAnswer()` body with a real backend call:
 *                   - Supabase Edge Function  (recommended)
 *                   - OpenAI / Gemini API
 *                   - LangChain / LlamaIndex server
 *
 * The shape of the inputs/outputs is intentionally kept stable so wiring in
 * a real LLM is a one-file change.
 */

import { getDocumentChunks } from './db';
import {
  queryMockVectorStore,
  generateMockAnswer,
  type DocumentChunk,
} from './ai';

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface RagSource {
  id: string;
  documentId: string;
  fileName: string;
  contentSnippet: string;
  similarity: number;
}

export interface RagRequest {
  query: string;
  /** IDs of documents to search over */
  documentIds: string[];
  /** Human-readable file names for display */
  documentNames: string[];
  sessionId: string;
}

export interface RagStreamCallbacks {
  /** Called repeatedly with the growing answer text (streaming effect) */
  onChunk: (partialText: string) => void;
  /** Called once when the full answer is ready, with final text + sources */
  onComplete: (fullText: string, sources: RagSource[]) => void;
  /** Called if the pipeline throws */
  onError: (error: Error) => void;
}

// ─── Retrieval Step ────────────────────────────────────────────────────────────

/**
 * Fetches document chunks from the database and ranks them by relevance.
 *
 * FUTURE: replace with a Supabase RPC call to `match_document_chunks`
 * using a real embedding vector.
 */
async function retrieveRelevantChunks(
  query: string,
  documentIds: string[],
  topK = 4
): Promise<DocumentChunk[]> {
  if (documentIds.length === 0) return [];

  // 1. Pull all stored chunks for the selected documents
  const allChunks = await getDocumentChunks(documentIds);

  // 2. Score + rank chunks  (swap this for pgvector cosine similarity)
  return queryMockVectorStore(query, allChunks, topK);
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Runs the full RAG pipeline for a student query and streams the answer.
 *
 * Pipeline steps:
 *   1. Retrieve relevant chunks  (vector search placeholder)
 *   2. Build source citations
 *   3. Stream answer tokens to `onChunk`
 *   4. Call `onComplete` with the final text + citations
 *
 * To connect a real LLM, replace steps 2–4 with an API call, keeping the
 * same callback interface so the UI does not need to change.
 */
export async function ragAnswer(
  request: RagRequest,
  callbacks: RagStreamCallbacks
): Promise<void> {
  const { query, documentIds, documentNames } = request;
  const { onChunk, onComplete, onError } = callbacks;

  try {
    // ── Step 1: Retrieve ───────────────────────────────────────────────────
    const matchedChunks = await retrieveRelevantChunks(query, documentIds);

    // ── Step 2: Build citations ────────────────────────────────────────────
    const sources: RagSource[] = matchedChunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      fileName:
        // find the document name that matches this chunk's parent doc
        (() => {
          const idx = documentIds.indexOf(chunk.documentId);
          return idx !== -1 ? documentNames[idx] : 'Document';
        })(),
      contentSnippet: chunk.content.substring(0, 140) + '…',
      similarity: chunk.similarity ?? 0.5,
    }));

    // ── Step 3: Stream answer ──────────────────────────────────────────────
    // generateMockAnswer calls onChunk repeatedly then calls the completion cb.
    generateMockAnswer(
      query,
      matchedChunks,
      documentNames,
      (partialText) => onChunk(partialText),
      (fullText) => onComplete(fullText, sources)
    );

    /*
     * ── FUTURE REPLACEMENT ─────────────────────────────────────────────────
     * Replace the generateMockAnswer block above with a real streaming call:
     *
     * const response = await fetch('/api/rag', {
     *   method: 'POST',
     *   headers: { 'Content-Type': 'application/json' },
     *   body: JSON.stringify({ query, chunks: matchedChunks }),
     * });
     *
     * const reader = response.body!.getReader();
     * let fullText = '';
     * while (true) {
     *   const { done, value } = await reader.read();
     *   if (done) break;
     *   const token = new TextDecoder().decode(value);
     *   fullText += token;
     *   onChunk(fullText);
     * }
     * onComplete(fullText, sources);
     * ───────────────────────────────────────────────────────────────────────
     */
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

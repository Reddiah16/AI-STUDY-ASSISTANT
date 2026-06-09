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

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getDocumentChunks } from './db';
import {
  queryMockVectorStore,
  streamGroundedAnswer,
  generateEmbedding,
  getEmbeddingProvider,
  type DocumentChunk,
} from './ai';

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface RagSource {
  id: string;
  documentId: string;
  fileName: string;
  contentSnippet: string;
  content: string; // The full retrieved context chunk
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
 * Uses Supabase RPC vector search (`match_document_chunks`) when Supabase
 * is configured, otherwise falls back to local simulation.
 */
async function retrieveRelevantChunks(
  query: string,
  documentIds: string[],
  topK = 4
): Promise<DocumentChunk[]> {
  console.info(`[RAG Retrieval] Initiating search for query: "${query}" across ${documentIds.length} document(s).`);

  if (documentIds.length === 0) {
    console.warn('[RAG Retrieval] Failed retrieval: No documents were selected for context.');
    return [];
  }

  const provider = getEmbeddingProvider();
  const isMockProvider = provider.constructor.name === 'MockEmbeddingProvider';

  if (isSupabaseConfigured && !isMockProvider) {
    try {
      console.info('[RAG Retrieval] Generating query embedding via configured provider...');
      const queryEmbedding = await generateEmbedding(query);
      console.info('[RAG Retrieval] Query embedding generated successfully.');

      console.info(`[RAG Retrieval] Querying Supabase match_document_chunks RPC with threshold 0.35, topK=${topK}...`);
      const { data, error } = await supabase.rpc('match_document_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.35, // Stricter threshold for highly relevant context
        match_count: topK,
        filter_document_ids: documentIds,
      });

      if (error) {
        console.error(`[RAG Retrieval] Supabase pgvector RPC search failed: ${error.message}. Falling back to client-side search.`);
      } else {
        const resultsCount = data?.length ?? 0;
        if (resultsCount > 0) {
          console.info(`[RAG Retrieval] Successfully retrieved ${resultsCount} chunk(s) from Supabase.`);
          interface RpcChunk { id: string; document_id: string; content: string; similarity: number; }
          data.forEach((item: RpcChunk, index: number) => {
            console.info(`  - Chunk #${index + 1}: ID=${item.id}, DocumentID=${item.document_id}, Similarity=${(item.similarity * 100).toFixed(1)}%, Snippet="${item.content.substring(0, 80).replace(/\n/g, ' ')}..."`);
          });
          return data.map((item: RpcChunk) => ({
            id: item.id,
            documentId: item.document_id,
            content: item.content,
            similarity: item.similarity,
          }));
        } else {
          console.warn(`[RAG Retrieval] Failed retrieval: Supabase search returned 0 matching chunks for query "${query}".`);
        }
      }
    } catch (err: unknown) {
      console.error('[RAG Retrieval] Vector search exception occurred:', err, 'Falling back to client-side search.');
    }
  }

  console.info('[RAG Retrieval] Running client-side fallback retrieval.');
  try {
    const allChunks = await getDocumentChunks(documentIds);
    console.info(`[RAG Retrieval] Loaded ${allChunks.length} total chunks from storage for selected documents.`);

    const matched = await queryMockVectorStore(query, allChunks, topK);
    const resultsCount = matched.length;

    if (resultsCount > 0) {
      console.info(`[RAG Retrieval] Successfully retrieved ${resultsCount} chunk(s) via client-side fallback.`);
      matched.forEach((chunk, index) => {
        console.info(`  - Fallback Chunk #${index + 1}: ID=${chunk.id}, DocumentID=${chunk.documentId}, Similarity=${((chunk.similarity ?? 0.5) * 100).toFixed(1)}%, Snippet="${chunk.content.substring(0, 80).replace(/\n/g, ' ')}..."`);
      });
    } else {
      console.warn(`[RAG Retrieval] Failed retrieval: Fallback search returned 0 matching chunks for query "${query}".`);
    }
    return matched;
  } catch (fallbackErr: unknown) {
    console.error('[RAG Retrieval] Fallback search failed entirely:', fallbackErr);
    return [];
  }
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

  console.info(`[RAG Pipeline] Processing prompt. SessionId=${request.sessionId}`);
  try {
    // ── Step 1: Retrieve ───────────────────────────────────────────────────
    const matchedChunks = await retrieveRelevantChunks(query, documentIds, 6);

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
      content: chunk.content, // Save the full retrieved context
      similarity: chunk.similarity ?? 0.5,
    }));

    // ── Step 3: Stream answer ──────────────────────────────────────────────
    console.info(`[RAG Pipeline] Initiating streaming grounded answer generation using ${matchedChunks.length} chunks.`);
    await streamGroundedAnswer(
      query,
      matchedChunks,
      documentNames,
      (partialText) => onChunk(partialText),
      (fullText) => {
        console.info(`[RAG Pipeline] Answer generation completed successfully. Output length: ${fullText.length} characters.`);
        onComplete(fullText, sources);
      },
      (error) => {
        console.error('[RAG Pipeline] Error during streaming answer generation:', error);
        onError(error);
      }
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
    const errorObj = err instanceof Error ? err : new Error(String(err));
    console.error('[RAG Pipeline] Execution failed:', errorObj);
    onError(errorObj);
  }
}

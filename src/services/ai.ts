/**
 * AI & RAG Processing Service
 * Contains placeholders and modular interfaces for:
 * 1. Document chunking (sliding window text splitter)
 * 2. Embedding generation (1536-dim vector generator placeholder)
 * 3. Semantic retrieval (simulated cosine similarity search on text chunks)
 * 4. Grounded answer generation (simulated streaming responses with citations)
 */

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  similarity?: number;
}

/**
 * 1. Document Chunking
 * Splits text into overlapping chunks of a target character length.
 */
export function chunkDocument(text: string, chunkSize = 600, overlap = 120): string[] {
  if (!text || text.trim() === '') {
    console.info('chunkDocument: Empty text provided, returning 0 chunks.');
    return [];
  }
  
  if (text.length <= chunkSize) {
    console.info('chunkDocument: Text is smaller than chunk size, returning 1 chunk.');
    return [text.trim()];
  }

  const chunks: string[] = [];
  let index = 0;

  while (index < text.length) {
    const chunk = text.substring(index, index + chunkSize);
    const trimmedChunk = chunk.trim();
    if (trimmedChunk) {
      chunks.push(trimmedChunk);
    }
    index += chunkSize - overlap;
  }

  console.info(`chunkDocument: Split text into ${chunks.length} chunks (size=${chunkSize}, overlap=${overlap}).`);
  return chunks;
}

/**
 * 2. Embedding Generation
 */

export interface EmbeddingProvider {
  generate(text: string): Promise<number[]>;
  generateBatch(texts: string[]): Promise<number[][]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  async generate(text: string): Promise<number[]> {
    const vector = new Array(1536).fill(0);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    for (let j = 0; j < 1536; j++) {
      const value = Math.sin(hash + j) * Math.cos(hash - j);
      vector[j] = Math.round(value * 10000) / 10000;
    }
    return vector;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.generate(t)));
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(text: string): Promise<number[]> {
    const results = await this.generateBatch([text]);
    return results[0];
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        input: texts,
        model: 'text-embedding-3-small' // standard 1536-dim model
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error?.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }
}

let activeProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (activeProvider) return activeProvider;

  const openAiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (openAiKey) {
    console.info('Using OpenAIEmbeddingProvider');
    activeProvider = new OpenAIEmbeddingProvider(openAiKey);
  } else {
    console.info('Using MockEmbeddingProvider (No API key found)');
    activeProvider = new MockEmbeddingProvider();
  }

  return activeProvider;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return getEmbeddingProvider().generate(text);
}

// Compatibility alias for remaining synchronous callers
export function generateMockEmbedding(text: string): number[] {
  const vector = new Array(1536).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) { hash = text.charCodeAt(i) + ((hash << 5) - hash); }
  for (let j = 0; j < 1536; j++) { vector[j] = Math.round((Math.sin(hash + j) * Math.cos(hash - j)) * 10000) / 10000; }
  return vector;
}

/**
 * 3. Semantic Retrieval (Local Simulation)
 * Simulates vector query matching using keyword density / string matching.
 * In production, this logic will be handled by Supabase pgvector RPC call match_document_chunks.
 */
export async function semanticRetrieval(
  query: string,
  chunks: DocumentChunk[],
  limit = 3
): Promise<DocumentChunk[]> {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  const chunksWithScores = chunks.map(chunk => {
    let score = 0;
    const contentLower = chunk.content.toLowerCase();
    
    // Simple TF-IDF approximation for keyword match
    queryWords.forEach(word => {
      const regex = new RegExp(word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
      const count = (contentLower.match(regex) || []).length;
      if (count > 0) {
        score += count * (1 / word.length); // Weight longer words higher
      }
    });

    const variance = (Math.sin(chunk.content.length) + 1) * 0.05;

    // Strict filter: similarity is only set if we had actual keyword matches
    const similarity = score > 0 
      ? Math.min(0.99, score / 5 + 0.4 + variance) 
      : 0;

    return {
      ...chunk,
      similarity
    };
  });

  // Sort descending by similarity score and filter out zero-similarity chunks
  return chunksWithScores
    .filter(c => (c.similarity ?? 0) > 0)
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);
}

// Compatibility alias for queryMockVectorStore
export const queryMockVectorStore = semanticRetrieval;

/**
 * 4. Grounded Answer Generation (LLM Integration)
 */

export interface LlmProvider {
  generateStream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (partialText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void
  ): Promise<void>;
}

export class MockLlmProvider implements LlmProvider {
  async generateStream(
    _systemPrompt: string,
    userPrompt: string,
    onChunk: (partialText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const queryMatch = userPrompt.match(/User Question:\s*"([^"]+)"/i) || userPrompt.match(/Question:\s*(.+)/i);
      const query = queryMatch ? queryMatch[1] : 'your query';
      const hasChunks = !userPrompt.includes('No study materials were selected');

      let body = '';

      if (hasChunks) {
        // ── Parse source chunks from userPrompt ──────────────────────────────
        const sources: { index: number; content: string }[] = [];
        const sourceRegex = /\[Source (\d+)\]:\s*([\s\S]+?)(?=\[Source \d+\]|User Question:|$)/g;
        let match;
        while ((match = sourceRegex.exec(userPrompt)) !== null) {
          sources.push({ index: parseInt(match[1]), content: match[2].trim() });
        }

        // Extract sentences from each source
        const sentences: { text: string; sourceIdx: number }[] = [];
        sources.forEach(src => {
          const clean = src.content.replace(/\.{2,}/g, ' ').replace(/[•●▪◦■☑✓]/g, ' ').replace(/\s+/g, ' ').trim();
          clean.split(/\n+|(?<=[.!?])\s+/).forEach(s => {
            const t = s.trim();
            if (t.length > 20) sentences.push({ text: t, sourceIdx: src.index });
          });
        });

        // Clean keywords from query
        const stopWords = new Set(['what','how','does','explain','why','where','when','who','which','about','from','with','your','study','this','that','these','those','there','their']);
        const queryWords = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));

        // Score and rank sentences, keeping only those with at least one keyword match (score > 0)
        const scored = sentences.map(s => {
          let score = 0;
          const lower = s.text.toLowerCase();
          queryWords.forEach(w => { if (lower.includes(w)) score += 3; });
          return { ...s, score };
        }).filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score);

        // Deduplicate
        const relevant: typeof scored = [];
        const seen = new Set<string>();
        for (const s of scored) {
          const norm = s.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!seen.has(norm)) { seen.add(norm); relevant.push(s); }
          if (relevant.length >= 5) break;
        }

        if (relevant.length === 0) {
          // Source is weak or missing matching information
          body += `### Summary\n`;
          body += `I cannot find a full answer in the selected study documents because the sources are missing or weak. No relevant matching information was found in the documents for your question.`;
        } else {
          // ── ### Summary ───────────────────────────────────────────────────
          body += `### Summary\n`;
          body += `**Direct Answer:** ${relevant[0].text} [Source ${relevant[0].sourceIdx}]\n\n`;
          if (relevant[1]) {
            body += `${relevant[1].text} [Source ${relevant[1].sourceIdx}]. `;
          }
          if (relevant[2]) {
            body += `${relevant[2].text} [Source ${relevant[2].sourceIdx}].`;
          }
          body += `\n\n`;

          // ── ### Key Points ─────────────────────────────────────────────────
          body += `### Key Points\n`;
          relevant.forEach((s) => {
            const titleWords = s.text.split(' ').slice(0, 4).join(' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/^[a-z]/, c => c.toUpperCase());
            body += `- **${titleWords}**: ${s.text} [Source ${s.sourceIdx}]\n`;
          });
          body += `\n`;

          // ── ### Explanation (only if explicit examples or code appear in sources) ──
          const explanationSentences = relevant.filter(s => 
            /example|e\.g\.|such as|for instance|code|illustrate|scenario/i.test(s.text)
          );
          if (explanationSentences.length > 0) {
            body += `### Explanation\n`;
            explanationSentences.forEach((s) => {
              body += `${s.text} [Source ${s.sourceIdx}].\n\n`;
            });
          }

          // ── ### Conclusion ────────────────────────────────────────────────
          body += `### Conclusion\n`;
          body += `Based strictly on the retrieved files, the core finding is that ${relevant[0].text.replace(/^[A-Z]/, c => c.toLowerCase())} [Source ${relevant[0].sourceIdx}].`;
        }

      } else {
        // ── No chunks selected ─────────
        body += `### Summary\n`;
        body += `No active study documents are selected. Please select one or more documents from the context panel above so I can answer your question.`;
      }

      // ── Stream the text word-by-word ──────────────────────────────────────
      const fullText = body;
      let response = '';
      const words = fullText.split(' ');
      let currentIdx = 0;
      const interval = setInterval(() => {
        if (currentIdx < words.length) {
          const nextWords = words.slice(currentIdx, currentIdx + 3).join(' ') + ' ';
          response += nextWords;
          onChunk(response);
          currentIdx += 3;
        } else {
          clearInterval(interval);
          onComplete(fullText);
        }
      }, 45);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}


export class OpenAiLlmProvider implements LlmProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateStream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (partialText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine) continue;
          if (cleanedLine === 'data: [DONE]') continue;

          if (cleanedLine.startsWith('data: ')) {
            try {
              const jsonStr = cleanedLine.slice(6);
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                onChunk(fullText);
              }
            } catch {
              // Ignore parsing errors for partial/incomplete SSE lines
            }
          }
        }
      }
      onComplete(fullText);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

let activeLlmProvider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (activeLlmProvider) return activeLlmProvider;

  const openAiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (openAiKey) {
    console.info('Using OpenAiLlmProvider');
    activeLlmProvider = new OpenAiLlmProvider(openAiKey);
  } else {
    console.info('Using MockLlmProvider (No API key found)');
    activeLlmProvider = new MockLlmProvider();
  }

  return activeLlmProvider;
}

export interface GroundedPromptPayload {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Builds the grounded system and user prompts.
 * This is kept modular to make it easy to customize the prompts later.
 */
export function buildGroundedPrompt(
  query: string,
  contextChunks: DocumentChunk[],
  documentNames: string[]
): GroundedPromptPayload {
  const systemPrompt = `You are a strict and highly accurate AI Study Assistant.
Your primary directive is to treat the provided study materials as the ONLY trusted source of truth.

Follow these strict rules:
1. GROUNDEDNESS: Generate your answer ONLY and EXCLUSIVELY from the provided retrieved context chunks. Do not assume, extrapolate, speculate, or bring in any outside knowledge or general facts not explicitly stated in the sources.
2. FACTUAL MATCH: Every claim you make must be a direct factual match to the provided text. Remove any unsupported claims.
3. CONCISE ACCURACY: Write concisely, directly, and factually. Do not use filler words, speculative analysis, or general explanations.
4. SOURCE CITATION: Cite sources (e.g. [Source 1], [Source 2]) for every key fact, definition, or claim.
5. DISCLAIMER ON WEAK OR MISSING SOURCE: If the provided chunks do not contain enough information to fully answer the question, or if no chunks match the question, you MUST explicitly state: "I cannot find a full answer in the selected study documents because the sources are missing or weak." and only provide what partial context is directly supported. Do not make up any answers.
6. EXTRA EXPLANATION: Add extra explanation or worked examples ONLY when the retrieved source material explicitly contains them. Do not generate hypothetical code blocks, scenarios, or explanations out of general knowledge.

Formatting structure (card-based rendering):
Use the following headers, but only include a section if there is direct, factual material in the sources to support it. If a section has no source support, omit it entirely.
- ### Summary (A single-sentence direct answer, followed by concise, strictly grounded paragraph(s))
- ### Key Points (Fact-based key points with brief definitions, cited from sources)
- ### Explanation (Explanations or examples ONLY if explicitly present in the sources)
- ### Conclusion (A final consolidating factual sentence)`;

  const userPrompt = contextChunks.length === 0
    ? `No study materials were selected for this query. Provide a clear message to the user: "No active study documents are selected. Please select one or more documents from the context panel above so I can answer your question."`
    : `Study Materials (from documents: ${documentNames.join(', ')}):
${contextChunks.map((c, i) => `[Source ${i + 1}]: ${c.content}`).join('\n\n')}

User Question: "${query}"

Answer the question strictly using the provided Study Materials. Prioritize groundedness, factual match, concise accuracy, and active citations. If the sources are weak or missing details to fully answer, state so explicitly.`;

  return { systemPrompt, userPrompt };
}

export async function streamGroundedAnswer(
  query: string,
  contextChunks: DocumentChunk[],
  documentNames: string[],
  onChunk: (partialText: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: Error) => void
): Promise<void> {
  const { systemPrompt, userPrompt } = buildGroundedPrompt(query, contextChunks, documentNames);

  try {
    const provider = getLlmProvider();
    await provider.generateStream(systemPrompt, userPrompt, onChunk, onComplete, onError);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// Compatibility wrapper around streamGroundedAnswer
export function generateGroundedAnswer(
  query: string,
  contextChunks: DocumentChunk[],
  documentNames: string[],
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void
) {
  streamGroundedAnswer(
    query,
    contextChunks,
    documentNames,
    onChunk,
    onComplete,
    (err) => console.error('Error in generateGroundedAnswer compatibility wrapper:', err)
  ).catch(err => {
    console.error('Unhandled exception in streamGroundedAnswer:', err);
  });
}

// Compatibility alias for generateMockAnswer
export const generateMockAnswer = generateGroundedAnswer;


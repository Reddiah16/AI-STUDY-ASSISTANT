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
export function chunkDocument(text: string, chunkSize = 800, overlap = 150): string[] {
  if (!text || text.trim() === '') {
    console.info('chunkDocument: Empty text provided, returning 0 chunks.');
    return [];
  }
  
  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (cleanText.length <= chunkSize) {
    console.info('chunkDocument: Text is smaller than chunk size, returning 1 chunk.');
    return [cleanText];
  }

  const separators = ['\n\n', '\n', '. ', ' '];
  
  function splitText(textToSplit: string, depth: number): string[] {
    if (textToSplit.length <= chunkSize) return [textToSplit];
    
    const separator = depth < separators.length ? separators[depth] : '';
    let splits: string[];
    
    if (separator) {
      splits = textToSplit.split(separator);
    } else {
      // Fallback: forced cut
      splits = [];
      for (let i = 0; i < textToSplit.length; i += chunkSize) {
        splits.push(textToSplit.substring(i, i + chunkSize));
      }
    }
    
    const goodChunks: string[] = [];
    let currentChunk = '';
    
    for (const split of splits) {
      if (currentChunk === '') {
        if (split.length > chunkSize && separator) {
          goodChunks.push(...splitText(split, depth + 1));
        } else {
          currentChunk = split;
        }
      } else {
        const potentialChunk = currentChunk + separator + split;
        if (potentialChunk.length <= chunkSize) {
          currentChunk = potentialChunk;
        } else {
          goodChunks.push(currentChunk);
          if (split.length > chunkSize && separator) {
            goodChunks.push(...splitText(split, depth + 1));
            currentChunk = '';
          } else {
            // Apply overlap if requested and possible
            let overlapText = '';
            if (overlap > 0 && currentChunk.length > overlap) {
               overlapText = currentChunk.slice(-overlap);
               const spaceIdx = overlapText.indexOf(' ');
               if (spaceIdx !== -1) overlapText = overlapText.slice(spaceIdx);
            }
            currentChunk = overlapText + (overlapText ? ' ' : '') + split;
          }
        }
      }
    }
    if (currentChunk) goodChunks.push(currentChunk);
    return goodChunks;
  }
  
  const finalChunks = splitText(cleanText, 0).map(c => c.trim()).filter(c => c.length > 0);
  console.info(`chunkDocument: Recursively split text into ${finalChunks.length} chunks (size=${chunkSize}, overlap=${overlap}).`);
  return finalChunks;
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

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(text: string): Promise<number[]> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: {
          parts: [{ text: text }]
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${error?.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const vector = data.embedding.values as number[];
    
    // Pad to 1536 dimensions to match database schema expectation
    const paddedVector = new Array(1536).fill(0);
    for (let i = 0; i < vector.length && i < 1536; i++) {
      paddedVector[i] = vector[i];
    }
    return paddedVector;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    // text-embedding-004 supports batchEmbedContents but for simplicity we will map over generate
    return Promise.all(texts.map(t => this.generate(t)));
  }
}

let activeProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (activeProvider) return activeProvider;

  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const openAiKey = import.meta.env.VITE_OPENAI_API_KEY;
  
  if (geminiKey) {
    console.info('Using GeminiEmbeddingProvider');
    activeProvider = new GeminiEmbeddingProvider(geminiKey);
  } else if (openAiKey) {
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
  let queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  // Fallback for short queries
  if (queryWords.length === 0 && query.trim().length > 0) {
    queryWords = [query.toLowerCase().trim()];
  }
  
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
  let results = chunksWithScores
    .filter(c => (c.similarity ?? 0) > 0)
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);
    
  // Fallback: If no keywords matched, just return the first few chunks so the LLM gets some context
  if (results.length === 0 && chunks.length > 0) {
    results = chunks.slice(0, limit).map(c => ({ ...c, similarity: 0.1 }));
  }
  
  return results;
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

export class GeminiLlmProvider implements LlmProvider {
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
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }]
            }
          ]
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
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine) continue;
          
          if (cleanedLine.startsWith('data: ')) {
            try {
              const jsonStr = cleanedLine.slice(6);
              const parsed = JSON.parse(jsonStr);
              const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const openAiKey = import.meta.env.VITE_OPENAI_API_KEY;
  
  if (geminiKey) {
    console.info('Using GeminiLlmProvider');
    activeLlmProvider = new GeminiLlmProvider(geminiKey);
  } else if (openAiKey) {
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
  const systemPrompt = `You are a strict, highly accurate, and analytical AI Study Assistant.
Your primary directive is to treat the provided study materials as the ONLY trusted source of truth.

Follow these strict rules:
1. GROUNDEDNESS & HALLUCINATION PREVENTION: Generate your answer ONLY and EXCLUSIVELY from the provided retrieved context chunks. Do not assume, extrapolate, speculate, or bring in any outside knowledge or general facts not explicitly stated in the sources.
2. ZERO HALLUCINATION CONSTRAINT: If the answer cannot be determined from the context, or if the question is unrelated to the study materials, you MUST state exactly: "The provided documents do not contain the answer." Do not attempt to guess or synthesize an answer from outside knowledge.
3. FACTUAL MATCH: Every claim you make must be a direct factual match to the provided text.
4. SOURCE CITATION: You MUST cite the source exactly using the provided source tags (e.g., [Source 1], [Source 2]) at the end of every sentence or key fact you extract. This is absolutely critical.
5. CONCISE ACCURACY: Write concisely, directly, and factually. Do not use filler words.

Formatting structure (card-based rendering):
Use the following headers, but only include a section if there is direct, factual material in the sources to support it. If a section has no source support, omit it entirely.
- ### Summary (A concise, strictly grounded direct answer)
- ### Key Points (Fact-based key points with brief definitions, cited from sources)
- ### Conclusion (A final consolidating factual sentence)`;

  const userPrompt = contextChunks.length === 0
    ? `No study materials were selected for this query. Provide a clear message to the user: "No active study documents are selected. Please select one or more documents from the context panel above so I can answer your question."`
    : `Study Materials:
${contextChunks.map((c, i) => `--- START [Source ${i + 1}] (from document: ${documentNames[i] || 'Unknown'}) ---\n${c.content}\n--- END [Source ${i + 1}] ---`).join('\n\n')}

User Question: "${query}"

Answer the question strictly using ONLY the provided Study Materials. Remember the ZERO HALLUCINATION CONSTRAINT. Provide active [Source X] citations for every sentence.`;

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


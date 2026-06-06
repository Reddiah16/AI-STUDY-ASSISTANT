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
    return data.data.map((item: any) => item.embedding);
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
      const regex = new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
      const count = (contentLower.match(regex) || []).length;
      if (count > 0) {
        score += count * (1 / word.length); // Weight longer words higher
      }
    });

    // Add a tiny bit of random variance to simulate float calculations
    score += (Math.sin(chunk.content.length) + 1) * 0.05;

    return {
      ...chunk,
      similarity: Math.min(0.99, score / 5 + 0.4) // Scale score to represent cosine similarity (0.4 - 0.99)
    };
  });

  // Sort descending by similarity score
  return chunksWithScores
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
      // Extract original details from the user prompt for compatibility
      const queryMatch = userPrompt.match(/User Question:\s*"([^"]+)"/i) || userPrompt.match(/Question:\s*(.+)/i);
      const query = queryMatch ? queryMatch[1] : 'your query';
      const hasChunks = !userPrompt.includes('No study materials were selected');
      
      let header = `### AI Study Guide - Analysis\n\n`;
      if (!hasChunks) {
        header += `*Note: No active study material was selected for this query. Providing general knowledge:* \n\n`;
      } else {
        header += `*Grounded in: Selected Study Materials*\n\n`;
      }

      let body = '';
      if (hasChunks) {
        body += `Based on your study files, here is a detailed breakdown answering: **"${query}"**\n\n`;
        body += `#### Key Summary:\n`;
        body += `1. **Direct Answer:** The material indicates that the core concepts described in your files are essential for this study topic.\n`;
        body += `2. **Supporting Context:** Additionally, details from the text mention relevant examples and definitions to support this.\n`;
        body += `\n#### Academic Explanation:\n`;
        body += `When examining this topic, teachers typically look for your understanding of cause-and-effect relationships. Based on the retrieved passages, the variables are closely connected, showing that changes in one directly influence the outcome.\n\n`;
        body += `#### Suggested Revision Steps:\n`;
        body += `- **Review Flashcards:** Ensure you can define the key vocabulary terms mentioned in these passages.\n`;
        body += `- **Connection Exercise:** Connect this concept with the preceding chapter to build a comprehensive concept map.\n\n`;
      } else {
        body += `To answer **"${query}"**, let's look at standard academic principles:\n\n`;
        body += `1. **Core Concept:** Standard revision indicates that breaking down complex questions into sub-questions is key. For this topic, first examine its base definitions.\n`;
        body += `2. **Methodology:** Ensure you compare this with relevant case studies.\n\n`;
        body += `#### Study Suggestion:\n`;
        body += `Upload a PDF textbook or text notes, and select them in the document panel to get custom RAG-grounded insights directly from your specific course material!\n\n`;
      }

      const fullText = header + body;
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
  const systemPrompt = `You are an expert AI Study Assistant. Use the provided study material chunks to answer the user's question accurately and helpfully.
Structure your response clearly using markdown headings, lists, and bold text to make it easy to study.

CRITICAL: You must answer the question using ONLY the provided study material chunks as context. Do not use external general knowledge except when strictly needed for definitions/clarity. If the provided chunks do not contain relevant information to answer the question, state clearly: "I cannot find the answer to this question in the selected study documents."`;

  const userPrompt = contextChunks.length === 0
    ? `No study materials were selected for this query. Provide a clear message to the user: "No active study documents are selected. Please select one or more documents from the context panel above so I can answer your question."`
    : `Study Materials (from documents: ${documentNames.join(', ')}):
${contextChunks.map((c, i) => `[Source ${i + 1}]: ${c.content}`).join('\n\n')}

User Question: "${query}"

Provide a detailed grounded answer based strictly on the study materials above.`;

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


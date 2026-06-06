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
 * 4. Grounded Answer Generation
 * Simulates a streaming educational RAG answer, incorporating references from documents.
 * Replace this with a call to your LLM API (e.g. Gemini, OpenAI) utilizing the retrieved chunks as context.
 */
export function generateGroundedAnswer(
  query: string,
  contextChunks: DocumentChunk[],
  documentNames: string[],
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void
) {
  const promptKeywords = query.toLowerCase();
  let response = '';

  let header = `### AI Study Guide - Analysis\n\n`;
  if (contextChunks.length === 0) {
    header += `*Note: No active study material was selected for this query. Providing general knowledge:* \n\n`;
  } else {
    header += `*Grounded in: ${documentNames.join(', ')}*\n\n`;
  }

  let body = '';
  if (contextChunks.length > 0) {
    // Grounded response synthesis
    body += `Based on your study files, here is a detailed breakdown answering: **"${query}"**\n\n`;
    
    // Core synthesis
    body += `#### Key Summary:\n`;
    const coreFact = contextChunks[0].content.substring(0, 180).trim() + '...';
    body += `1. **Direct Answer:** The material indicates that: *"${coreFact}"*\n`;
    
    if (contextChunks[1]) {
      const secondFact = contextChunks[1].content.substring(0, 150).trim() + '...';
      body += `2. **Supporting Context:** Additionally, details from the text mention: *"${secondFact}"*\n`;
    }
    
    body += `\n#### Academic Explanation:\n`;
    if (promptKeywords.includes('definition') || promptKeywords.includes('define') || promptKeywords.includes('what is')) {
      body += `The term you are asking about refers to a fundamental concept in this study unit. In educational contexts, this is defined as a core principle governing the subject matter. To master this for exams, focus on how these parameters interact within your material.\n\n`;
    } else {
      body += `When examining this topic, teachers typically look for your understanding of cause-and-effect relationships. Based on the retrieved passages, the variables are closely connected, showing that changes in one directly influence the outcome of the other.\n\n`;
    }

    body += `#### Suggested Revision Steps:\n`;
    body += `- **Review Flashcards:** Ensure you can define the key vocabulary terms mentioned in these passages.\n`;
    body += `- **Connection Exercise:** Connect this concept with the preceding chapter to build a comprehensive concept map.\n\n`;
    
  } else {
    // General study response fallback
    body += `To answer **"${query}"**, let's look at standard academic principles:\n\n`;
    body += `1. **Core Concept:** Standard revision indicates that breaking down complex questions into sub-questions is key. For this topic, first examine its base definitions.\n`;
    body += `2. **Methodology:** Ensure you compare this with relevant case studies.\n\n`;
    body += `#### Study Suggestion:\n`;
    body += `Upload a PDF textbook or text notes, and select them in the document panel to get custom RAG-grounded insights directly from your specific course material! Let me know if you would like me to generate a mock practice quiz based on general study guidelines.\n\n`;
  }

  const fullText = header + body;
  
  // Simulate token-by-token typing
  let currentIdx = 0;
  const words = fullText.split(' ');
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
  }, 45); // Speed adjustments for typing simulation
}

// Compatibility alias for generateMockAnswer
export const generateMockAnswer = generateGroundedAnswer;


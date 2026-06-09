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
      
      let body = '';

      if (hasChunks) {
        // Parse sources from userPrompt
        const sources: { index: number; content: string }[] = [];
        const sourceRegex = /\[Source (\d+)\]:\s*([\s\S]+?)(?=\[Source \d+\]|User Question:|$)/g;
        let match;
        while ((match = sourceRegex.exec(userPrompt)) !== null) {
          sources.push({
            index: parseInt(match[1]),
            content: match[2].trim()
          });
        }

        // Clean and extract sentences with source mapping
        const sentences: { text: string; sourceIdx: number }[] = [];
        sources.forEach(src => {
          const cleanText = src.content
            .replace(/\.{2,}/g, ' ')
            .replace(/[•●▪◦■☑✓]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          // Split by punctuation or newlines
          const split = cleanText.split(/\n+|(?<=[.!?])\s+/);
          split.forEach(s => {
            const cleanedSentence = s.trim();
            if (cleanedSentence.length > 20) {
              sentences.push({ text: cleanedSentence, sourceIdx: src.index });
            }
          });
        });

        // Clean query words for matching
        const queryWords = query
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .split(/\s+/)
          .filter(w => w.length > 3 && !['what', 'how', 'does', 'explain', 'why', 'where', 'when', 'who', 'which', 'about', 'from', 'with', 'your', 'study'].includes(w));

        // Score sentences by matching keywords
        const scoredSentences = sentences.map(s => {
          let score = 0;
          const textLower = s.text.toLowerCase();
          queryWords.forEach(word => {
            if (textLower.includes(word)) {
              score += 3;
            }
          });
          score += Math.min(2, s.text.length / 60);
          return { ...s, score };
        });

        // Sort by score descending
        const sortedScored = scoredSentences.sort((a, b) => b.score - a.score);

        // Get top unique relevant sentences
        const relevantSentences: typeof scoredSentences = [];
        const seenTexts = new Set<string>();
        for (const s of sortedScored) {
          const textNorm = s.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!seenTexts.has(textNorm) && s.score > 0.5) {
            seenTexts.add(textNorm);
            relevantSentences.push(s);
          }
          if (relevantSentences.length >= 6) break;
        }

        // Fallback if not enough unique sentences with positive score
        while (relevantSentences.length < 3 && relevantSentences.length < sortedScored.length) {
          const s = sortedScored[relevantSentences.length];
          if (s) {
            relevantSentences.push(s);
          } else {
            break;
          }
        }

        // Group sentences by source to build a structured report
        const sentencesBySource: Record<number, string[]> = {};
        relevantSentences.forEach(s => {
          if (!sentencesBySource[s.sourceIdx]) {
            sentencesBySource[s.sourceIdx] = [];
          }
          sentencesBySource[s.sourceIdx].push(s.text);
        });

        // 1. ### Summary (Direct answer and high-level synthesis)
        body += `### Summary\n`;
        body += `This academic analysis synthesizes the retrieved study materials concerning **"${query}"**.\n\n`;
        if (relevantSentences.length > 0) {
          body += `**Direct Answer:** The source documents indicate that the core concept directly relates to: ${relevantSentences[0].text} [Source ${relevantSentences[0].sourceIdx}].\n\n`;
          const paragraphs = relevantSentences.slice(0, 3).map(s => `${s.text} [Source ${s.sourceIdx}].`).join(' ');
          body += `Overall, the material describes a system where: ${paragraphs}\n\n`;
        } else {
          body += `No directly matching passages were retrieved for the query "${query}". Please select alternative study materials to ground this question.\n\n`;
        }

        // 2. ### Key Concepts (3 to 6 meaningful points with brief explanations and citations)
        body += `### Key Concepts\n`;
        body += `Here is a detailed breakdown of the 3 to 6 key concepts retrieved from the course documents:\n\n`;
        if (relevantSentences.length > 0) {
          relevantSentences.forEach((s, idx) => {
            const words = s.text.split(' ');
            const title = words.slice(0, Math.min(4, words.length)).join(' ')
              .replace(/^[a-z]/, char => char.toUpperCase())
              .replace(/[^a-zA-Z0-9\s]/g, '');
            body += `- **Point ${idx + 1}: ${title}**: ${s.text} [Source ${s.sourceIdx}]\n`;
          });
          body += `\n`;
        } else {
          body += `- **Point 1: General Core Principles**: Under standard paradigms, this concept describes basic patterns of logic.\n`;
          body += `- **Point 2: Relational Structures**: Data elements and theoretical constructs align horizontally.\n`;
          body += `- **Point 3: Systems Application**: Practical designs utilize this framework to resolve conflicts.\n\n`;
        }

        // 3. ### Explanation (Detailed conceptual depth + concrete example)
        body += `### Explanation\n`;
        body += `To understand **"${query}"** in greater depth, we must examine the underlying framework. `;
        if (relevantSentences.length > 0) {
          body += `Specifically, the retrieved texts demonstrate that "${relevantSentences[0].text}" functions as a primary driver. `;
          if (relevantSentences[1]) {
            body += `This mechanism is further supported by observations stating "${relevantSentences[1].text}". `;
          }
        }
        body += `By combining these aspects, we can see that this topic requires a step-by-step methodology to implement correctly. `;
        body += `For example, a failure to align these parameters results in unexpected inconsistencies, as discussed in the references [Source ${Object.keys(sentencesBySource).join(', ') || '1'}].\n\n`;
        
        body += `#### Concrete Example:\n`;
        if (queryWords.some(w => ['code', 'program', 'function', 'class', 'python', 'javascript', 'ts', 'react', 'api', 'database', 'sql'].includes(w))) {
          body += `Suppose you are writing a software routine or database script. For instance, when implementing a function to process these requirements:
\`\`\`typescript
// Practical implementation illustrating the concept
async function handleStructuredConcept(inputData: any) {
  console.log("Analyzing inputs based on query parameters...");
  const processed = await compileData(inputData);
  // Ensure the logic is grounded as described in the sources
  if (!processed.isValid) {
    throw new Error("Validation failed against academic criteria.");
  }
  return { status: "success", result: processed };
}
\`\`\`
Here, the validation check and input analysis represent a concrete, step-by-step application of these principles.`;
        } else {
          const keyword = queryWords[0] ? queryWords[0].toUpperCase() : 'CONCEPT';
          body += `Consider a practical real-world scenario where these principles apply:
- **Scenario**: An organization or process is set up to manage operations involving **${keyword}**.
- **Application**: By applying the rules in the text (specifically regarding *"${relevantSentences[0]?.text || 'the core subject'}"*), they establish a clear operational framework.
- **Example**: If a study team adopts this framework, they notice a direct correlation between strict adherence to these rules and overall efficiency, mirroring the results documented in the sources.`;
        }
        body += `\n\n`;

        // 4. ### Revision Tips (Bulleted list of self-test questions & active recall exercises)
        body += `### Revision Tips\n`;
        body += `Use these active recall questions and study tips to review this material:\n\n`;
        body += `- **Self-Test Question 1**: How does the relationship between the key points identified in the sources affect the overall theme of *${query}*?\n`;
        body += `- **Self-Test Question 2**: In your own words, how would you define the term *"${relevantSentences[0]?.text?.split(' ').slice(0, 3).join(' ') || 'the key concept'}"* based on [Source ${relevantSentences[0]?.sourceIdx || 1}]?\n`;
        if (queryWords.length > 0) {
          body += `- **Active Recall Exercise**: Close your eyes and try to list the 3 main aspects of **${queryWords.slice(0, 3).map(w => w.toUpperCase()).join(' & ')}** that were highlighted in the study cards above.\n`;
        }
        body += `- **Vocabulary Check**: Focus on defining the bold terms in the cards above before attempting to write out full practice exam answers.\n\n`;

        // 5. ### Conclusion (Consolidating final paragraph)
        body += `### Conclusion\n`;
        body += `In conclusion, the retrieved source materials provide a grounded, cohesive overview of **"${query}"**. By analyzing the connections between the definitions, detailed points, and concrete examples, you can master this topic for both exams and practical settings.`;

      } else {
        // Build general knowledge response structure (no chunks selected)
        const summary = `No active study materials were selected for this query.\n\n**Direct Answer:** To help you study, here is a general academic breakdown of **"${query}"**. Please select one or more documents from the context panel above to receive answers grounded specifically in your course materials.\n`;
        
        let keyConcepts = `Here are the key academic points associated with **"${query}"**:\n\n`;
        const generalPoints = [
          { title: 'Base Definition & Core Scope', desc: 'Understanding the basic boundaries of the topic and defining the critical terminology.' },
          { title: 'Core Mechanics & Methodology', desc: 'How the concept functions in practice, including standard procedures, processes, or algorithms.' },
          { title: 'Theoretical Foundation & Framework', desc: 'The academic models, theories, or historical frameworks that underpin the subject.' },
          { title: 'Practical Application & Use Cases', desc: 'Real-world situations where these principles are applied to solve concrete problems.' }
        ];
        generalPoints.forEach((pt, idx) => {
          keyConcepts += `- **${idx + 1}. ${pt.title}**: ${pt.desc}\n`;
        });

        let explanation = `This topic is a standard area of study. When analyzing **"${query}"**, academics focus on how its individual components interact. For instance, changes in one sub-component often have cascading effects on the performance or reliability of the whole system.\n\n`;
        explanation += `#### Concrete Example:\n`;
        explanation += `Consider a basic real-world scenario of this concept in action:\n`;
        explanation += `- **Setup**: You have a baseline scenario where a process or rule is applied.\n`;
        explanation += `- **Operation**: Under normal circumstances, the baseline functions as expected. However, if you adjust the variables (for example, scaling up demand or inputs), you must apply the principles of **${query}** to maintain stability.\n`;
        explanation += `- **Result**: This demonstrates the practical importance of understanding the underlying mechanics of the concept rather than just memorizing definitions.\n`;

        let revisionTips = `Study checklist for **"${query}"**:\n\n`;
        revisionTips += `- **Compare & Contrast**: Compare this topic with a related concept from your syllabus.\n`;
        revisionTips += `- **Explain to a Peer**: Try explaining the core definition of this topic in 3 simple sentences without using technical terms.\n`;
        revisionTips += `- **Flashcard Prompt**: Create a flashcard with the name of this concept on the front, and the 3 key components on the back.\n`;

        let conclusion = `To get study insights grounded specifically in your own course materials, notes, or textbooks, upload them as PDFs, select them, and ask your question again.`;

        body += `### Summary\n${summary}\n`;
        body += `### Key Concepts\n${keyConcepts}\n`;
        body += `### Explanation\n${explanation}\n`;
        body += `### Revision Tips\n${revisionTips}\n`;
        body += `### Conclusion\n${conclusion}\n`;
      }

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
  const systemPrompt = `You are an expert AI Study Assistant. Use the provided study material chunks to answer the user's question with deep academic substance. Do not give short, thin, or low-information answers. Make your responses comprehensive, rigorous, and highly useful for study and revision. Do not stop after one brief explanation if more relevant detail exists in the retrieved material.

Follow these response guidelines based on the question type:
1. Conceptual Questions: Provide detailed, in-depth explanations of the underlying theory, mechanisms, and key nuances.
2. Broad Questions: Provide structured, multi-part answers covering all aspects mentioned or implied in the retrieved material.
3. Standard Study Questions: Aim for:
   - A direct, clear answer to the user's question at the very beginning of the relevant section.
   - 3 to 6 meaningful, distinct points that break down the topic.
   - A brief, substantive explanation of each point.
   - At least one concrete example illustrating the concept, whenever possible.
   - Strong source grounding (citing the sources like [Source 1], [Source 2], etc. where appropriate).

Structure your response clearly using markdown headings, lists, and bold text to make it easy to study.
Break down the response into logical study sections using the following exact heading styles to enable card-based rendering:
- ### Summary (compulsory first section - provide a concise overview and the direct answer here)
- ### Key Concepts (or ### Key Points - include your 3 to 6 meaningful, detailed points here with bold terms)
- ### Explanation (provide the detailed, in-depth explanation/analysis and concrete examples here)
- ### Revision Tips (or ### Study Tips - practical study tips or questions for self-testing)
- ### Conclusion (optional summary connection)

CRITICAL: You must answer the question using the provided study material chunks as context. Keep your assertions grounded in these chunks. Do not use external general knowledge except when strictly needed for definitions, clarity, or examples. If the provided chunks do not contain relevant information to answer the question, state clearly: "I cannot find the answer to this question in the selected study documents."`;

  const userPrompt = contextChunks.length === 0
    ? `No study materials were selected for this query. Provide a clear message to the user: "No active study documents are selected. Please select one or more documents from the context panel above so I can answer your question."`
    : `Study Materials (from documents: ${documentNames.join(', ')}):
${contextChunks.map((c, i) => `[Source ${i + 1}]: ${c.content}`).join('\n\n')}

User Question: "${query}"

Provide a detailed grounded answer based strictly on the study materials above. Ensure you use the requested markdown headings.`;

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


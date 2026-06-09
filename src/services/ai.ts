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

        // Score and rank sentences
        const scored = sentences.map(s => {
          let score = 0;
          const lower = s.text.toLowerCase();
          queryWords.forEach(w => { if (lower.includes(w)) score += 3; });
          score += Math.min(2, s.text.length / 60);
          return { ...s, score };
        }).sort((a, b) => b.score - a.score);

        // Deduplicate and pick top 6
        const relevant: typeof scored = [];
        const seen = new Set<string>();
        for (const s of scored) {
          const norm = s.text.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!seen.has(norm)) { seen.add(norm); relevant.push(s); }
          if (relevant.length >= 6) break;
        }
        while (relevant.length < 3 && relevant.length < scored.length) {
          relevant.push(scored[relevant.length]);
        }

        const allSourceIds = [...new Set(relevant.map(s => s.sourceIdx))].join(', ');

        // ── ### Summary — direct sentence + 2 paragraphs ─────────────────────
        body += `### Summary\n`;
        body += `**Direct Answer:** ${relevant[0]?.text || `The topic of "${query}" is addressed in the selected study materials.`} [Source ${relevant[0]?.sourceIdx || 1}]\n\n`;

        const para1Sentences = relevant.slice(0, 3).map(s => `${s.text} [Source ${s.sourceIdx}]`).join('. ');
        body += `${para1Sentences}.\n\n`;

        if (relevant.length > 3) {
          const para2Sentences = relevant.slice(3).map(s => `${s.text} [Source ${s.sourceIdx}]`).join('. ');
          body += `${para2Sentences}. Together, these points establish a comprehensive understanding of the concept and its implications within the broader subject area.\n\n`;
        } else {
          body += `Understanding this topic requires careful attention to both the definitions established in the source material and the relationships between the individual components described above. The passages retrieved from the selected documents provide a solid foundation for approaching exam questions and practical applications of this subject.\n\n`;
        }

        // ── ### Key Points — bullets with explanation ─────────────────────────
        body += `### Key Points\n`;
        body += `The following key points are grounded directly in the retrieved study material:\n\n`;
        relevant.forEach((s) => {
          const titleWords = s.text.split(' ').slice(0, 5).join(' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/^[a-z]/, c => c.toUpperCase());
          body += `- **${titleWords}**: ${s.text} [Source ${s.sourceIdx}]\n`;
        });
        body += `\n`;

        // ── ### Explanation — deep paragraph + example ────────────────────────
        body += `### Explanation\n`;
        body += `To understand **"${query}"** in depth, it is important to examine how the individual components described in the sources relate to one another. `;
        body += `The retrieved passages reveal that ${relevant[0]?.text || 'the core principle involves a structured approach to the subject matter'} [Source ${relevant[0]?.sourceIdx || 1}]. `;
        if (relevant[1]) {
          body += `This is closely connected to the observation that ${relevant[1].text} [Source ${relevant[1].sourceIdx}]. `;
        }
        body += `Taken together, these elements form a coherent framework that governs how this concept functions in practice. A failure to understand any one of these components in isolation can lead to gaps in comprehension, particularly when answering application-based or scenario-driven exam questions.\n\n`;

        if (relevant[2]) {
          body += `Furthermore, ${relevant[2].text} [Source ${relevant[2].sourceIdx}]. This adds another layer of meaning to the topic, indicating that the concept is not merely definitional but has real structural and procedural implications. Students are advised to focus not only on what the term means but on how it is applied and what consequences arise from its correct or incorrect application.\n\n`;
        }

        body += `#### Example:\n`;
        const isCode = queryWords.some(w => ['code','program','function','class','algorithm','python','javascript','database','sql','api','react'].includes(w));
        if (isCode) {
          body += `Consider the following practical implementation that illustrates this concept:\n`;
          body += `\`\`\`typescript\n// Example demonstrating the concept from [Source ${allSourceIds}]\nasync function applyConceptPipeline(input: string): Promise<string> {\n  // Step 1: Validate input according to the rules defined in source material\n  if (!input || input.trim() === '') throw new Error('Input must be non-empty.');\n  // Step 2: Process according to the methodology described\n  const processed = input.split(' ').map(word => word.toUpperCase()).join('-');\n  // Step 3: Return a structured result\n  return \`Result: \${processed}\`;\n}\n\`\`\`\nIn this example, each step mirrors the structured methodology outlined in the source documents.\n\n`;
        } else {
          const kw = queryWords[0] ? queryWords[0].charAt(0).toUpperCase() + queryWords[0].slice(1) : 'Concept';
          body += `**Real-World Scenario:** Consider a situation where a student or practitioner must apply **${kw}** in a structured setting.\n`;
          body += `- **Setup:** The scenario begins with a defined problem or requirement, as described in the study material.\n`;
          body += `- **Application:** The individual applies the rules and definitions from the source — specifically, *"${relevant[0]?.text || 'the core principle'}"* — to guide their decision-making.\n`;
          body += `- **Outcome:** The result aligns with the expected behaviour described in [Source ${allSourceIds}], demonstrating that a correct understanding of the concept leads to predictable, well-reasoned conclusions.\n\n`;
        }

        // ── ### Revision Notes — self-test bullets ────────────────────────────
        body += `### Revision Notes\n`;
        body += `Use the following checklist to consolidate your understanding before an exam or assessment:\n\n`;
        body += `- **Define the concept**: Write a one-sentence definition of *${query}* without looking at your notes. Compare it to [Source ${relevant[0]?.sourceIdx || 1}].\n`;
        body += `- **List the key components**: From memory, list the main points covered in the Key Points section above. Aim to recall at least 3 without prompting.\n`;
        if (queryWords.length > 0) {
          body += `- **Use the vocabulary**: Write a short paragraph using the terms **${queryWords.slice(0, 3).map(w => w.toUpperCase()).join(', ')}** correctly in context.\n`;
        }
        body += `- **Apply to a scenario**: Describe a real or hypothetical situation where this concept would be applied. What decisions would you make and why?\n`;
        body += `- **Self-test question**: How does the information in [Source ${allSourceIds}] directly support or illustrate the concept of *${query}*? Write your answer in 3–4 sentences.\n\n`;

        // ── ### Conclusion ────────────────────────────────────────────────────
        body += `### Conclusion\n`;
        body += `In conclusion, the study materials retrieved from your selected documents provide a well-grounded, multi-faceted explanation of **"${query}"**. The key insight is that ${relevant[0]?.text || 'the concept is well-defined and practically applicable'} [Source ${relevant[0]?.sourceIdx || 1}]. By working through the paragraphs and bullet points above, reviewing the provided example, and completing the revision notes, you will be well-prepared to answer both theoretical and application-based questions on this topic.`;

      } else {
        // ── No chunks selected: structured general knowledge response ─────────
        body += `### Summary\n`;
        body += `**Direct Answer:** No study documents are currently selected, so this answer is based on general academic knowledge about **"${query}"**.\n\n`;
        body += `To study any topic effectively, it is essential to first understand its foundational definitions, then explore the mechanisms and processes through which it operates, and finally connect it to real-world applications or examples. This layered approach — moving from definition to theory to practice — is a well-established method in academic study and forms the backbone of how examiners design questions. For **"${query}"**, this means beginning with the core terminology, understanding how the underlying system or concept functions, and then applying that understanding to solve problems or answer scenario-based questions.\n\n`;
        body += `Without access to your specific course materials, this response draws on standard academic principles. Please upload and select your PDFs or notes to receive answers grounded directly in your syllabus and textbook content. Doing so will significantly improve the precision and relevance of every response.\n\n`;

        body += `### Key Points\n`;
        body += `The following points reflect the general academic treatment of this type of topic:\n\n`;
        body += `- **Base Definition and Scope**: Every topic begins with a clear definition that establishes its boundaries. Understanding what the concept *is* — and equally what it is *not* — is the first step to mastering it.\n`;
        body += `- **Core Mechanisms and Processes**: Most academic topics involve a set of rules, steps, or processes that explain how the concept works. These should be understood in sequence, not in isolation.\n`;
        body += `- **Theoretical Foundations**: Academic subjects are grounded in theory. Understanding the *why* behind a concept — the assumptions and principles that support it — deepens comprehension and enables flexible application.\n`;
        body += `- **Practical Application and Use Cases**: The ability to apply a concept to a new or unfamiliar scenario is what distinguishes surface-level memorisation from genuine understanding.\n\n`;

        body += `### Explanation\n`;
        body += `When approaching **"${query}"** from an academic standpoint, it is important to recognise that this concept does not exist in isolation. It is connected to a broader set of ideas, frameworks, and methods that form the context within which it operates. In an exam setting, questions on this topic are likely to test not just your recall of the definition, but your ability to explain the mechanism, compare it with related concepts, and apply it to a given situation.\n\n`;
        body += `A strong approach is to treat the concept as a structured system: identify its inputs, processes, and outputs, or its causes, characteristics, and consequences. This framework can be applied universally and tends to produce comprehensive, well-organised exam answers.\n\n`;
        body += `#### Example:\n`;
        body += `- **Setup**: A student is asked to explain this concept in an exam scenario with a specific constraint or variable.\n`;
        body += `- **Application**: They apply the definition and process rules to the scenario, identifying how each component of the concept manifests in context.\n`;
        body += `- **Conclusion**: By working through each step logically, they arrive at a well-reasoned, evidence-based answer.\n\n`;

        body += `### Revision Notes\n`;
        body += `Use this checklist to review the topic before your assessment:\n\n`;
        body += `- **Define it**: Write a one-sentence definition of *${query}* from memory.\n`;
        body += `- **Explain the mechanism**: In 2–3 sentences, describe *how* it works.\n`;
        body += `- **Give an example**: Identify one concrete real-world or textbook example.\n`;
        body += `- **Connect it**: How does this topic relate to at least one other concept in your syllabus?\n`;
        body += `- **Upload your materials**: For course-specific grounding, upload your PDFs and select them before asking your question.\n\n`;

        body += `### Conclusion\n`;
        body += `This response provides a general academic framework for approaching **"${query}"**. For answers grounded specifically in your course materials, lecture notes, or textbook, upload them as PDFs, select them in the document panel, and re-ask your question. The assistant will then synthesise a detailed, source-grounded answer tailored to your exact syllabus.`;
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
  const systemPrompt = `You are an expert AI Study Assistant. Your role is to provide academically rigorous, substantive answers grounded in the user's uploaded study material. Never give short, compressed, or thin answers. Do not summarise everything into a single line.

For every question, follow this exact format:

1. DIRECT ANSWER — A single clear sentence that directly answers the question.
2. PARAGRAPHS — Write 1 to 3 full, detailed paragraphs that explain the concept in depth. Cover the theory, the context, how it works, why it matters, and any nuances from the retrieved material. Do not compress important ideas. Do not use bullet points in this section.
3. BULLET POINTS — After the paragraphs, use bullet points to organise key concepts, examples, steps, or revision notes. Each bullet should be substantive — not a single compressed phrase.

Use the following section headings (card-based rendering):
- ### Summary (Direct answer sentence + 1 to 3 detailed paragraphs)
- ### Key Points (Bullet points of key concepts, each with a brief explanation)
- ### Explanation (Deeper analysis paragraph(s) + a worked example or scenario)
- ### Revision Notes (Bulleted revision checklist and self-test questions)
- ### Conclusion (A final consolidating paragraph)

Additional rules:
- For study and conceptual questions, always include explanation, examples, and important takeaways.
- Always ground the answer in the retrieved source material. Cite sources like [Source 1], [Source 2] where relevant.
- Do not make answers too short. Do not compress important ideas into a single line.
- If the retrieved chunks do not contain enough information, state: "I cannot find a full answer in the selected study documents" and provide what partial context is available.`;

  const userPrompt = contextChunks.length === 0
    ? `No study materials were selected for this query. Provide a clear message to the user: "No active study documents are selected. Please select one or more documents from the context panel above so I can answer your question."`
    : `Study Materials (from documents: ${documentNames.join(', ')}):
${contextChunks.map((c, i) => `[Source ${i + 1}]: ${c.content}`).join('\n\n')}

User Question: "${query}"

Follow the required format strictly: direct answer sentence, then 1–3 detailed paragraphs, then bullet points. Ground everything in the study materials above.`;

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


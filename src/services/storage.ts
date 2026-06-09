import { supabase, isSupabaseConfigured } from '../lib/supabase';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/** The name of the Supabase Storage bucket used for all uploads */
export const STORAGE_BUCKET = 'study-documents';

/** Accepted MIME types and corresponding extensions */
const ACCEPTED_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/x-markdown': ['.md'],
};

export interface UploadedFileResponse {
  filePath: string;
  fileUrl: string;
  contentText: string;
}

export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

// ─────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────

/**
 * Returns an error string if the file fails validation, or null if valid.
 * Checks MIME type, file extension, and size limit.
 */
export function validateFile(file: File, maxMb = 10): string | null {
  const MAX_BYTES = maxMb * 1024 * 1024;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const mimeAllowed = Object.keys(ACCEPTED_TYPES).includes(file.type);
  const extAllowed = Object.values(ACCEPTED_TYPES).flat().includes(ext);

  if (!mimeAllowed && !extAllowed) {
    return `Unsupported file type "${ext}". Accepted: PDF, TXT, MD.`;
  }
  if (file.size > MAX_BYTES) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${maxMb} MB.`;
  }
  if (file.size === 0) {
    return 'File appears to be empty.';
  }
  return null;
}

// ─────────────────────────────────────────────
// Content Text Extraction
// ─────────────────────────────────────────────

/**
 * Attempts to read plain text from TXT and MD files directly in the browser.
 * Falls back to educational mock content for PDFs (no PDF parsing dependency).
 */
async function extractContentText(file: File): Promise<string> {
  const isTextFile =
    file.type === 'text/plain' ||
    file.type === 'text/markdown' ||
    file.type === 'text/x-markdown' ||
    file.name.endsWith('.txt') ||
    file.name.endsWith('.md');

  if (isTextFile) {
    try {
      return await file.text();
    } catch {
      // Fallback if browser text reader fails
    }
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      console.info(`Starting PDF text extraction for: ${file.name}`);
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Filter out marked content and keep only TextItems (which contain str and transform)
        const textItems = (textContent.items as unknown[]).filter((item): item is { str: string; transform: number[] } => 
          !!item && typeof item === 'object' && 'str' in item && 'transform' in item
        );
        
        // Sort items: top to bottom, then left to right
        const sortedItems = [...textItems].sort((a, b) => {
          const yDiff = b.transform[5] - a.transform[5];
          if (Math.abs(yDiff) > 5) {
            return yDiff;
          }
          return a.transform[4] - b.transform[4];
        });

        let pageText = '';
        let lastY: number | null = null;
        for (const item of sortedItems) {
          const y = item.transform[5];
          const str = item.str;
          
          if (lastY !== null && Math.abs(y - lastY) > 5) {
            pageText += '\n';
          } else if (pageText !== '' && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
            pageText += ' ';
          }
          
          pageText += str;
          lastY = y;
        }
        
        fullText += pageText + '\n\n';
      }
      
      console.info(`Successfully extracted ${fullText.length} characters from ${pdf.numPages} pages.`);
      return fullText.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error parsing PDF (${file.name}):`, msg);
      // Fall back to mock content below if it fails completely
    }
  }

  // Fallback placeholder content for unreadable or unsupported files
  return generateMockContentForFile(file.name);
}

/**
 * Generates placeholder study content based on the file name.
 * Used for PDFs until a real text-extraction service is wired in.
 */
function generateMockContentForFile(fileName: string): string {
  const n = fileName.toLowerCase();

  if (n.includes('biology') || n.includes('bio') || n.includes('cell')) {
    return `Cellular Biology Study Notes
1. Mitochondria: Often referred to as the powerhouse of the cell, mitochondria generate most of the cell's supply of adenosine triphosphate (ATP). They contain their own ribosomes and DNA.
2. Photosynthesis: The process used by plants and algae to harness sunlight energy. Formula: 6CO2 + 6H2O + Light → C6H12O6 + 6O2.
3. DNA Replication: The biological process of producing two identical replicas of DNA from one original molecule. It occurs in all living organisms and is the basis for biological inheritance.
4. Mitosis vs Meiosis: Mitosis produces two identical diploid daughter cells; meiosis produces four unique haploid gamete cells.`;
  }

  if (n.includes('history') || n.includes('war') || n.includes('revolution')) {
    return `Modern World History Syllabus
1. French Revolution (1789-1799): Radical political upheaval leading to a republic and Napoleon's dictatorship.
2. Industrial Revolution (~1760-1840): Transition to new manufacturing processes; key inventions include the steam engine and cotton gin.
3. World War I (1914-1918): Global conflict involving 30+ nations, ending four major empires and creating the League of Nations.
4. Magna Carta (1215): Royal charter establishing that everyone, including the king, is subject to the law.`;
  }

  if (n.includes('math') || n.includes('calc') || n.includes('algebra')) {
    return `Mathematics Formulas & Principles
1. Quadratic Formula: x = (-b ± √(b²-4ac)) / 2a
2. Pythagorean Theorem: a² + b² = c²
3. Euler's Identity: e^(iπ) + 1 = 0
4. Derivative: Represents the instantaneous rate of change; geometrically the slope of the tangent line.`;
  }

  return `Study Guide – ${fileName}
Chapter 1: Study Foundations
- Active Recall: Stimulate memory during learning rather than passively re-reading.
- Spaced Repetition: Review material at expanding intervals (1 day, 3 days, 7 days…).
- Feynman Technique: Explain concepts in simple terms to expose gaps in understanding.
- Pomodoro Technique: 25-minute focused blocks separated by 5-minute breaks.`;
}

// ─────────────────────────────────────────────
// Core Upload / Delete Operations
// ─────────────────────────────────────────────

/**
 * Uploads a file to Supabase Storage inside the authenticated user's folder.
 *
 * Storage path layout: study-documents/{userId}/{timestamp}_{sanitized-name}
 *
 * Requires the bucket to have the following policies (see storage_policies.sql):
 *   - INSERT: authenticated users, path must start with their uid
 *   - SELECT: authenticated users, path must start with their uid
 *   - DELETE: authenticated users, path must start with their uid
 *
 * Falls back to a local Blob URL + mock content when Supabase is not configured.
 */
export async function uploadDocument(
  userId: string,
  file: File
): Promise<UploadedFileResponse> {
  // 1. Validate before touching the network
  const validationError = validateFile(file);
  if (validationError) throw new Error(validationError);

  // 2. Extract (or generate) text content
  const contentText = await extractContentText(file);

  // 3a. Live Supabase upload
  if (isSupabaseConfigured) {
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `${userId}/${Date.now()}_${sanitizedName}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false, // Never silently overwrite an existing file
      });

    if (uploadError) {
      // Provide human-readable messages for the most common errors
      if (uploadError.message.includes('Bucket not found')) {
        throw new Error(
          `Storage bucket "${STORAGE_BUCKET}" does not exist. ` +
          `Create it in Supabase Dashboard → Storage → New Bucket.`
        );
      }
      if (uploadError.message.includes('security')) {
        throw new Error(
          `Upload blocked by storage policy. Make sure the INSERT policy ` +
          `allows authenticated users to upload to their own folder.`
        );
      }
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // 4. Retrieve the public URL (works for public buckets)
    //    For private buckets replace with createSignedUrl() instead.
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return { filePath, fileUrl: urlData.publicUrl, contentText };
  }

  // 3b. Demo / offline fallback
  await new Promise(resolve => setTimeout(resolve, 700));
  return {
    filePath: `mock-storage/${userId}/${file.name}`,
    fileUrl: URL.createObjectURL(file),
    contentText,
  };
}

/**
 * Deletes a file from Supabase Storage.
 * Silently skips mock paths used in demo mode.
 */
export async function deleteDocumentFile(filePath: string): Promise<void> {
  if (!isSupabaseConfigured || filePath.startsWith('mock-storage/')) return;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([filePath]);

  if (error) {
    // Log but don't throw — a failed storage delete should not block the
    // UI; the database row is removed in the next step regardless.
    console.error(`Storage delete failed for "${filePath}": ${error.message}`);
  }
}

/**
 * Creates a short-lived signed URL for a private file (60 seconds).
 * Use this instead of getPublicUrl() if the bucket is set to private.
 */
export async function getSignedUrl(
  filePath: string,
  expiresInSeconds = 60
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error) {
    console.error(`Failed to create signed URL: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}

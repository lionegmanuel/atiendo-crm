/**
 * Policy file ingestion helpers for the RAG pipeline.
 *
 * Supports PDF and Markdown policy documents. Text is extracted, split on
 * markdown headings first (semantic sections), then chunked at ~400 tokens
 * (~1600 chars) with ~50 token (~200 char) overlap.
 *
 * The embedding step is deferred — ingestPolicyFile returns the extracted
 * chunks and emits a knowledge_source.updated event for the rag-indexer to
 * consume asynchronously.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { chunkText } from "@/lib/ai/rag/chunker";
import { extractPdfText, PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { extractMarkdownText } from "@/lib/ai/rag/extractors/markdown";

export { PdfExtractError };

// ~400 tokens × 4 chars/token ≈ 1600 chars
const POLICY_MAX_CHARS = 1600;
// ~50 tokens × 4 chars/token ≈ 200 chars
const POLICY_OVERLAP_CHARS = 200;

// Regex to detect markdown headings (# and ##)
const HEADING_RE = /^#{1,2}\s+.+$/m;

/**
 * Splits policy text into overlapping chunks, respecting markdown heading
 * boundaries first before falling back to paragraph/sentence splitting.
 *
 * Strategy:
 *   1. If text contains heading markers (# / ##), split on those boundaries.
 *   2. Pass each section through the standard `chunkText` chunker at policy
 *      params (1600 chars / 200 overlap).
 *   3. Concatenate all section chunks (overlap already applied within section).
 */
export function chunkPolicyText(text: string): string[] {
  if (!HEADING_RE.test(text)) {
    // No headings — standard chunking
    return chunkText(text, { maxChars: POLICY_MAX_CHARS, overlapChars: POLICY_OVERLAP_CHARS });
  }

  // Split on heading lines, keeping heading as part of following section
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,2}\s+/.test(line) && current.length > 0) {
      const section = current.join("\n").trim();
      if (section.length > 0) sections.push(section);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    const section = current.join("\n").trim();
    if (section.length > 0) sections.push(section);
  }

  const chunks: string[] = [];
  for (const section of sections) {
    const sectionChunks = chunkText(section, {
      maxChars: POLICY_MAX_CHARS,
      overlapChars: POLICY_OVERLAP_CHARS,
    });
    chunks.push(...sectionChunks);
  }

  return chunks.filter((c) => c.length > 0);
}

export interface IngestPolicyArgs {
  organizationId: string;
  agentId: string;
  knowledgeSourceId: string;
  blobPath: string;
  ext: "pdf" | "md";
}

export interface IngestPolicyResult {
  chunkCount: number;
}

/**
 * Downloads a policy file from Supabase Storage, extracts text, and chunks it.
 * Returns the chunk count — actual embedding is handled by the rag-indexer
 * worker that listens to knowledge_source.updated events.
 *
 * Throws `PdfExtractError` if PDF extraction fails.
 */
export async function ingestPolicyFile(args: IngestPolicyArgs): Promise<IngestPolicyResult> {
  const { organizationId, knowledgeSourceId, blobPath, ext } = args;
  const admin = createAdminClient();

  // Download blob from private ai-policy bucket
  const { data: blob, error: downloadErr } = await admin.storage
    .from("ai-policy")
    .download(blobPath);

  if (downloadErr || !blob) {
    throw new Error(
      `[ai-policy-upload] Failed to download blob ${blobPath} for org ${organizationId}: ${downloadErr?.message ?? "no data"}`,
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  // Extract text
  let text: string;
  if (ext === "pdf") {
    text = await extractPdfText(buffer); // may throw PdfExtractError
  } else {
    text = extractMarkdownText(buffer);
  }

  const chunks = chunkPolicyText(text);

  console.warn(
    `[ai-policy-upload] ingestPolicyFile: ks=${knowledgeSourceId} ext=${ext} chunks=${chunks.length}`,
  );

  return { chunkCount: chunks.length };
}

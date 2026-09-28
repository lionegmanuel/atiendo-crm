/**
 * Text chunker for the RAG indexing pipeline.
 *
 * Semantic-aware: splits by paragraphs first, then by sentence boundaries
 * for oversized chunks. Applies overlap between consecutive chunks to preserve
 * cross-boundary context for retrieval.
 */

import { createHash } from "node:crypto";

export interface ChunkOptions {
  /** Maximum characters per chunk before sub-splitting. Default: 1500 */
  maxChars?: number;
  /** Characters of overlap between consecutive chunks. Default: 200 */
  overlapChars?: number;
}

/**
 * Splits `text` into overlapping chunks suitable for embedding.
 *
 * Strategy:
 *   1. Split by double-newline (paragraph boundaries).
 *   2. If any paragraph exceeds `maxChars`, sub-split by `. ` (sentence boundaries).
 *   3. Add `overlapChars` of the previous chunk's tail to the next chunk's head.
 *   4. Trim and remove empty results.
 */
export function chunkText(text: string, opts?: ChunkOptions): string[] {
  const maxChars = opts?.maxChars ?? 1500;
  const overlapChars = opts?.overlapChars ?? 200;

  // Step 1: paragraph split
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Step 2: sub-split oversized paragraphs
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      segments.push(para);
    } else {
      // Split by sentence boundaries (". " or ".\n")
      const sentences = para.split(/\.(?:\s|\n)/).filter((s) => s.trim().length > 0);
      let current = "";
      for (const sentence of sentences) {
        const candidate = current ? `${current}. ${sentence.trim()}` : sentence.trim();
        if (candidate.length > maxChars && current.length > 0) {
          segments.push(current.trim());
          current = sentence.trim();
        } else {
          current = candidate;
        }
      }
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
    }
  }

  if (segments.length === 0) return [];
  if (segments.length === 1) {
    const only = segments[0];
    return only ? [only] : [];
  }

  // Step 3: apply overlap
  const chunks: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    if (i === 0) {
      chunks.push(seg);
      continue;
    }
    const prev = chunks[chunks.length - 1] ?? "";
    const tail = prev.length > overlapChars ? prev.slice(-overlapChars) : prev;
    const chunk = `${tail}\n${seg}`.trim();
    chunks.push(chunk);
  }

  // Step 4: deduplicate and filter empties
  return chunks.filter((c) => c.length > 0);
}

/**
 * Computes a SHA-256 hex digest of `content` for change detection / dedup.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

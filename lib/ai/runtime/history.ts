/**
 * Sliding-window history loader for ai_agent_runs (S-13.08).
 *
 * Loads the last `messageWindow` messages of the conversation (chronological,
 * oldest-first) and trims to fit `tokenWindow`. Token estimation is the
 * cheap-and-cheerful len/4 heuristic — within the noise of the runtime budget.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LoadHistoryInput {
  conversationId: string;
  organizationId: string;
  messageWindow: number;
  tokenWindow: number;
  /** Exclude the inbound that triggered the run (we add it explicitly later). */
  excludeMessageId?: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function loadHistoryWithBudget(
  supabase: SupabaseClient,
  input: LoadHistoryInput,
): Promise<HistoryMessage[]> {
  const limit = Math.max(input.messageWindow, 1);
  const { data, error } = await supabase
    .from("messages")
    .select("id, body, direction, sent_at")
    .eq("organization_id", input.organizationId)
    .eq("conversation_id", input.conversationId)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const filtered = (data as Array<{
    id: string;
    body: string | null;
    direction: string;
    sent_at: string;
  }>)
    .filter((m) => m.id !== input.excludeMessageId)
    .filter((m) => (m.body ?? "").trim().length > 0);

  // Sort oldest-first, then trim greedily from the back so newest messages stay.
  filtered.reverse();

  let totalTokens = 0;
  const kept: HistoryMessage[] = [];
  for (let i = filtered.length - 1; i >= 0; i--) {
    const m = filtered[i]!;
    const text = (m.body ?? "").trim();
    const tokens = estimateTokens(text);
    if (totalTokens + tokens > input.tokenWindow) break;
    totalTokens += tokens;
    kept.unshift({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: text,
    });
  }

  return kept;
}

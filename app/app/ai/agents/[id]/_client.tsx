"use client";
import { AgentEditor } from "@/components/ai/AgentEditor";
import type { AgentRow } from "@/hooks/ai/useAgent";

interface Props {
  agentId: string;
  initialData: AgentRow;
  readOnly?: boolean;
}

export function AgentEditorClient({ agentId, initialData, readOnly }: Props) {
  return <AgentEditor agentId={agentId} initialData={initialData} readOnly={readOnly} />;
}

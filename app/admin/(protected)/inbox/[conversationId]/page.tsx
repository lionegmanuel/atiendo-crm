import { AdminThreadClient } from "../_components/AdminThread";

interface Props {
  params: Promise<{ conversationId: string }>;
}

export default async function AdminConversationPage({ params }: Props) {
  const { conversationId } = await params;
  return <AdminThreadClient conversationId={conversationId} />;
}

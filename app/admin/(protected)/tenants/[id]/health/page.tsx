import { TenantHealthClient } from "./_client";

interface TenantHealthPageProps {
  params: Promise<{ id: string }>;
}

export default async function TenantHealthPage({ params }: TenantHealthPageProps) {
  const { id } = await params;
  return <TenantHealthClient id={id} />;
}

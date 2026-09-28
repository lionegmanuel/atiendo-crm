/**
 * As abas de seção que viviam aqui foram removidas: só apareciam para quem já
 * estava dentro de `/app/ai/*`, o que deixava Conhecimento, Credenciais, Uso,
 * Casos e Alertas invisíveis do resto do sistema. Quem faz esse trabalho agora
 * é o hub em `/app/ai`, alcançável pelo sidebar.
 */
export default function AiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

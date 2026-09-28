import { AgendaCarregando } from "@/components/agenda/estados";

/**
 * O esqueleto tem a FORMA da grade — sete colunas e a faixa de horas — e não
 * três barras genéricas. É o que o resto do produto faz (o do funil desenha 5
 * colunas × 3 cards), e a razão é de percepção: silhueta certa faz a espera
 * parecer continuação; retângulo genérico faz parecer que a página trocou.
 */
export default function AgendaLoading() {
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="h-14" />
      <AgendaCarregando />
    </div>
  );
}

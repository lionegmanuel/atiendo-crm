import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { estadoDosDestinosInternos } from "@/lib/automation/destinos-internos-autorizados";
import { traduzir } from "@/lib/i18n/dicionario";

import { FormularioDeDestinosInternos } from "./_form";
import { tituloNoIdiomaDaInstalacao } from "@/lib/i18n/idiomaDaInstalacao";

export const metadata = { title: tituloNoIdiomaDaInstalacao("Destinos internos") };
export const dynamic = "force-dynamic";

/**
 * A tela onde quem administra a INSTALAÇÃO autoriza endereços da rede interna
 * — decisão 22-d, issue #1004.
 *
 * ── O defeito que ela fecha ─────────────────────────────────────────────────
 *
 * A tela de Provedores promete apontar para "um modelo rodando na sua própria
 * máquina", e a proteção de destino do PR #964 recusa exatamente esse caso.
 * Quem segue a promessa recebe a imagem virando aviso na Central. A decisão
 * 22-d dá a válvula a quem PAGA a máquina — e a decisão diz, com as palavras
 * do dono, que o lugar onde ele controla deve ser visível e fácil de acessar.
 * Só o `.env` não é isso: é um arquivo no servidor, e num kit self-host ele
 * exige ssh.
 *
 * ── Por que `/admin`, e não `/app/settings` ─────────────────────────────────
 *
 * O objeto é a rede da MÁQUINA. Num revendedor que hospeda várias empresas,
 * deixar o admin de um tenant declarar um endereço interno entregaria a rede do
 * servidor — e o ponto inteiro da decisão é que a organização, sozinha, não
 * pode. Mesmo argumento de `/admin/cadastro`, `/admin/marca` e `/admin/google`;
 * esta tela é irmã das três.
 *
 * ── Por que `notFound()`, e não `redirect('/403')` ──────────────────────────
 *
 * Para quem não administra a instalação, esta tela não faz parte do produto. O
 * layout de `(protected)` já roda `requirePlatformAdmin()`, então o gate abaixo
 * é redundante HOJE; ele fica porque a garantia precisa ser local, e um layout
 * pode ser movido. Mesma decisão, mesma frase, de `/admin/cadastro`.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  const estado = await estadoDosDestinosInternos();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Destinos internos", usuario.idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Endereços da rede deste servidor que a instalação pode alcançar.",
            usuario.idioma,
          )}
        </p>
      </div>
      <FormularioDeDestinosInternos
        listaInicial={[...estado.lista]}
        vemDoPiso={estado.vemDoPiso}
      />
    </div>
  );
}

# Marketplace e Extensões — pesquisa de arquitetura

**17/set/2026.** Três investigações paralelas e independentes para o épico *Marketplace e Extensões*.

- **Worktree:** `/Users/rafaelmelgaco/wt/marketplace-ext` · **Branch:** `feat/marketplace-de-extensoes`
- **SHA base:** `8ad4e2572` (topo real de `origin/main` às 22h de 17/set)
- **Régua:** **CONFIRMADO/MEDIDO** (li o código ou rodei o comando, com evidência citada),
  **INFERIDO** (deriva de leitura) e **PROPOSTO** (desenho) têm significados separados.
  Evidência de leitura não é prova de execução.

| Frente | Pergunta |
|---|---|
| [01 — O que impacta](01-o-que-impacta.md) | Que bases existentes condicionam o marketplace, e o que elas obrigam ou proíbem |
| [02 — O que será impactado](02-o-que-sera-impactado.md) | O que, hoje funcionando, muda de comportamento ou corre risco de regressão |
| [03 — O que pode impactar](03-o-que-pode-impactar.md) | O que transforma o épico em problema: falhas, ataque, custo, promessas impossíveis |

A síntese para acompanhar sem ler os três está no **PROG-030**, na pasta `Decisão Implementações`.
As escolhas que dependem do dono do produto estão no **DEC-007**.

## As cinco conclusões que mudaram o plano

1. **A página pública mora em outro repositório** (`deskcomm-site`), fora deste CI, e este
   repositório não gera página estática. A vitrine pública é um segundo pull request.
2. **Instalar é ato do administrador da instalação**, não do usuário do tenant: exige
   `is_platform_admin`, escopo `full` e ausência de sessão de suporte (`lib/extensions/http.ts:43-70`).
   Uma loja que confunda as duas audiências vira um catálogo onde todo botão devolve 403.
3. **O pacote nunca fornece uma URL** — ele nomeia uma capacidade, e o servidor resolve para um
   destino constante (`app/api/v1/extensions/[id]/open/route.ts:44`), que o cliente reconfere
   (`components/extensions/ExtensionGuide.tsx:149`). Qualquer ampliação de capacidade tem de
   preservar essa propriedade, e ela precisa de um teste que a afirme **como propriedade**.
4. **Um comando shell que falasse com o banco perderia tudo**: política de origem, vínculo de DNS,
   verificação em duas etapas, parser estrito e a trilha de auditoria inteira — as ações de
   auditoria são escritas no serviço, não no banco. Um comando só é seguro como cliente HTTP fino.
5. **Um contador de download grava IP por default** em qualquer infraestrutura, e isso reconstrói
   adoção — exatamente o que a política de métricas recusou. A medição precisa nascer decidida.

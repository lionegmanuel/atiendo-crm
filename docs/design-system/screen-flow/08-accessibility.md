---
title: Accessibility
parent: README.md
fonte: WCAG 2.1 AA + design-system base + Sub-PRD 04 §4.3
version: 0.1
date: 2026-04-28
---

# 08 — Accessibility

> Compromisso AA mínimo. Atendente passa 8h+/dia no produto: teclado-first é requisito de produtividade, não bonus de inclusão. Reduce-motion respeitado em toda animação.

## 1. Atalhos de teclado canônicos

### 1.1 Globais (em qualquer tela `/app/*`)

| Atalho | Ação |
|---|---|
| `Cmd/Ctrl + K` | Busca global (contacts, leads, conversations) |
| `?` | Mostra cheatsheet de atalhos (modal) |
| `g` depois `i` | Vai pra `/app/inbox` |
| `g` depois `p` | Vai pra Pipeline (último visitado) |
| `g` depois `c` | Vai pra `/app/contacts` |
| `g` depois `s` | Vai pra `/app/settings` |
| `Esc` | Fecha modal/dialog/drawer mais externo |

### 1.2 Inbox (`/app/inbox`)

| Atalho | Ação |
|---|---|
| `j` | Conversa abaixo na lista |
| `k` | Conversa acima na lista |
| `Enter` | Abre conversa focada |
| `r` | Foca composer pra responder |
| `e` | Resolver conversa atual |
| `a` | Claim ("Eu cuido") |
| `m` | Marcar como não lida |
| `Cmd/Ctrl + Enter` | Enviar mensagem (no composer) |
| `/` | Abre menu de quick replies |
| `n` | Nova nota interna |

### 1.3 Kanban (`/app/pipelines/[id]`)

| Atalho | Ação |
|---|---|
| `j/k` | Próximo/anterior card na coluna atual |
| `h/l` | Coluna anterior/próxima |
| `Enter` | Abre card focado |
| `Space` | Inicia "modo mover": setas movem entre stages, Enter confirma |
| `Cmd/Ctrl + A` | Seleciona todos visíveis (modo bulk) |
| `Esc` | Sai do modo bulk |

### 1.4 Composer

| Atalho | Ação |
|---|---|
| `Cmd/Ctrl + Enter` | Enviar |
| `Cmd/Ctrl + V` | Colar imagem (suporte clipboard image) |
| `Tab` | Sai do composer (acessa toolbar) |
| `:emoji:` | Auto-complete emoji |

Atalhos finalizados deferidos pra Spec Sub-PRD 04 §9; lista acima é proposta inicial.

## 2. Navegação por teclado (Tab order)

Toda tela autenticada deve ser navegável **inteiramente** com `Tab` / `Shift+Tab` / `Enter` / `Esc` / setas:

1. **Skip link** (`Pular pra conteúdo principal`) — primeiro elemento focável em cada layout
2. **Header**: logo, search global, notifications bell, profile menu
3. **Sidebar**: itens em ordem de leitura
4. **Conteúdo principal**: ordem de leitura visual
5. **Modais**: foco trapped dentro do modal; `Esc` fecha; foco volta pro elemento que abriu

### Foco visível
- Anel `ring-2 ring-sage-500 ring-offset-2 ring-offset-background` em todo elemento focável
- Nunca remover outline com `outline:none` sem substituto visível
- `focus-visible:` (não `focus:`) pra evitar ring em mouse

## 3. ARIA roles & labels

### 3.1 Componentes custom críticos

| Componente | Role | Labels |
|---|---|---|
| `<ConversationList>` | `listbox` (ou `list` + `listitem`) | `aria-label="Lista de conversas"`, items com `aria-selected` |
| `<KanbanBoard>` | `region` | `aria-label="Quadro {pipeline.name}"` |
| `<KanbanColumn>` | `list` | `aria-label="Estágio {stage.name} com {count} cards"` |
| `<KanbanCard>` | `listitem` ou `button` | `aria-label="{lead.title}, valor {value}, {tags}"` |
| `<MessageBubble>` | `article` | `aria-label="Mensagem {role} em {time}"` |
| `<HandoffBanner>` | `alert` | `aria-live="assertive"` — atendente precisa saber agora |
| `<NotificationBell>` | `button` | `aria-label="Notificações ({count} novas)"`, `aria-expanded` |
| `<PresenceDot>` | `status` | `aria-label="{name} está {online/busy/offline}"` |
| `<ComposerBar textarea>` | `textbox` | `aria-label="Compor mensagem"`, `aria-multiline="true"` |
| `<MFAInput>` | `group` de 6 inputs | `aria-label="Código TOTP de 6 dígitos"` |
| `<KanbanCard dragging>` | mantém role `button` | `aria-grabbed="true"` (deprecated mas ainda lido por NVDA) + `aria-describedby` com instruções |

### 3.2 Live regions

- `<ToastViewport>`: `role="region"`, `aria-live="polite"` (default toasts) ou `aria-live="assertive"` pra erros críticos
- Banner "Reconectando…": `role="alert"`, `aria-live="polite"`
- Notificação de nova mensagem: `aria-live="polite"` pra não interromper leitura
- Handoff alert: `aria-live="assertive"` (atendente precisa interromper o que faz)

### 3.3 Forms

- Todo `<input>`/`<textarea>` tem `<label>` associado (não placeholder-only)
- Erros de validação: `aria-invalid="true"` + `aria-describedby="{id}-error"`
- Required fields marcados visualmente E com `aria-required="true"`
- Loading buttons: `aria-busy="true"` durante request

## 4. Contraste

A paleta sage/zinc do design-system base já confirma AA. Validações específicas:

| Combinação | Razão | OK? |
|---|---|---|
| Texto principal (`zinc-900`) sobre `background` (`zinc-50`) | 16:1 | ✅ AAA |
| Texto secundário (`zinc-600`) sobre `background` | 7:1 | ✅ AAA |
| Texto em botão sage (`white` sobre `sage-600`) | 5.2:1 | ✅ AA |
| Sentiment baixo (texto branco sobre vermelho) | precisa ≥4.5:1 | confirmar na Spec |
| Estados disabled | 3:1 mínimo (UI components) | confirmar |

**Nunca usar cor como único sinal**: status `failed` tem ícone `WarningCircle` + texto + cor; status `online` tem dot + texto + cor.

## 5. Reduce-motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Aplicações específicas:
- **Skeletons**: estáticos (sem `animate-pulse`)
- **Toasts**: aparecem sem slide
- **Drag-drop**: movimentos instantâneos (sem ease)
- **Auto-scroll** na thread: jump direto, sem smooth
- **Realtime banner**: sem ícone giratório (ícone estático ou simples)

## 6. Screen reader announcements

### 6.1 Eventos críticos a anunciar

| Evento | Live region | Texto |
|---|---|---|
| Nova mensagem inbound | polite | "Nova mensagem de {nome}: {preview 80 chars}" |
| Handoff disparado | assertive | "Bot escalou para humano. Motivo: {trigger_reason}" |
| Conversation atribuída a mim | polite | "Você assumiu a conversa com {nome}" |
| Mensagem enviada | (do not announce — visual já mostra) | — |
| Mensagem falhou ao enviar | assertive | "Falha ao enviar — toque para reenviar" |
| LGPD request recebido | polite | "Novo pedido LGPD de {nome}, prazo D+7" |
| WAHA session caiu | assertive | "Sessão WhatsApp {phone} desconectada" |
| Drag-drop conflict | polite | "Card mudou enquanto você arrastava — atualizado" |
| Realtime reconnecting | polite | "Reconectando ao servidor" |

### 6.2 Ordem de leitura na inbox aberta

1. Conversa selecionada na lista (anunciada quando muda)
2. Header da thread (nome + presença + ações)
3. Última mensagem visível na thread
4. Composer com label "Compor mensagem"
5. Side panel: nome do contact + lead atual

## 7. Focus management

### 7.1 Modais
- Foco vai pro 1º elemento focável ao abrir
- Foco fica trapped (Tab cicla dentro)
- `Esc` fecha; foco volta pro elemento que disparou

### 7.2 Navegação entre rotas
- Foco vai pro `<h1>` da nova página (programaticamente, `tabIndex={-1}`)
- Skip link sempre disponível

### 7.3 Notificações de novo conteúdo
- **Não** mover foco automaticamente quando nova mensagem chega
- Anunciar via live region
- Atendente decide quando ir lá

### 7.4 Forms com erro
- Foco move pro 1º campo com erro ao submit failure
- Mensagens de erro vinculadas via `aria-describedby`

## 8. Testes obrigatórios

### 8.1 Manual
- Navegar inbox completa só com teclado (login → claim → reply → resolve)
- Navegar Kanban com setas + Space (modo mover)
- Abrir modal → fechar com Esc → foco volta corretamente

### 8.2 Screen reader
- VoiceOver (Safari macOS) — checklist obrigatório antes de release P0
- NVDA (Firefox Windows) — Fase 1.5

### 8.3 Automated
- `axe-core` integrado nos testes E2E (CI bloqueia merge se crítico encontrado)
- `eslint-plugin-jsx-a11y` no lint (CI)

## 9. Internacionalização (consideração futura)

PT-BR único no MVP. Mas:
- Strings sempre via lookup, nunca hardcoded em JSX
- `<html lang="pt-BR">` no layout root
- Datas via `Intl.DateTimeFormat('pt-BR')`
- Moeda via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`
- Permite ES/EN entrarem sem refactor (Fase pós-MVP)

## 10. Inputs específicos

- **CPF**: input com mask `000.000.000-00`, validação dígito verificador, `inputMode="numeric"`
- **Telefone E.164**: input com country code default `+55`, máscara visual `(11) 99999-9999`
- **Data**: native `<input type="date">` em desktop; bottom sheet picker em mobile
- **Money (cents)**: input formatado, armazenado em cents

## 11. Checklist por release

Antes de marcar P0 como pronto, validar em cada tela:
- [ ] Tab order faz sentido visual
- [ ] Foco visível em todo elemento focável
- [ ] Atalhos documentados funcionam
- [ ] Screen reader anuncia mudanças críticas
- [ ] Reduce-motion respeitado
- [ ] Contraste AA validado
- [ ] Modal trap-focus + Esc
- [ ] Forms com `<label>` + erro acessível
- [ ] Imagens com `alt` descritivo (mídia em mensagens: alt = filename + tipo)
- [ ] axe-core passa sem `critical` ou `serious`

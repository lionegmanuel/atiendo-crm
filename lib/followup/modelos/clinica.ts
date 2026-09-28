/**
 * OS QUATRO FOLLOW-UPS DE UMA CLÍNICA — consulta, exame, cirurgia e falta.
 *
 * São as quatro vezes em que um paciente some no meio do caminho, e cada uma
 * tem um relógio próprio: quem parou de responder no meio da marcação volta em
 * dias; quem está decidindo uma cirurgia volta em semanas, e cobrar esse em
 * dias é o jeito mais rápido de virar bloqueio. Por isso são quatro modelos e
 * não um com prazos configuráveis: o prazo É o modelo.
 *
 * ⚠️ TRÊS REGRAS QUE OS TEXTOS OBEDECEM, E QUE NÃO SÃO ESTILO:
 *
 * 1. **Nenhum texto nomeia doença, exame, especialidade ou procedimento.**
 *    "o exame que o médico pediu", nunca o nome do exame. Dado de saúde é dado
 *    pessoal SENSÍVEL (LGPD art. 11), e a mensagem aparece na tela de bloqueio
 *    do celular, às vezes lida por outra pessoa. O modo `text` do nó de ação não interpola nada
 *    — não há como um campo da ficha vazar para dentro da mensagem, e
 *    `modelos.test.ts` reprova texto com `{{` para que continue assim.
 * 2. **Nenhum texto promete horário, preço ou prazo clínico.** "posso ver os
 *    horários", nunca "tenho quinta às 14h": a mensagem é escrita hoje e enviada
 *    daqui a três semanas, e a agenda não é consultada para montá-la.
 * 3. **Nenhum texto nomeia a clínica.** Uma imagem serve todas as marcas
 *    (doutrina de marca própria); o nome do remetente já vai no canal.
 *
 * ⚠️ `cancel_on_reply: true` NOS QUATRO, e é a decisão de produto mais
 * importante deste arquivo. Respondeu qualquer coisa — "oi", "quem é?", "pode
 * ser quinta" — a inscrição é CANCELADA (`outcome='replied'`) e a conversa volta
 * para quem atende, agente ou humano. O contrário (o fluxo seguir roteando por
 * palavra-chave) põe um robô falando por cima de um paciente que acabou de
 * responder uma pergunta de saúde. Quem marca a consulta é o atendimento, que
 * tem a agenda na mão; o follow-up só existe para o silêncio.
 */
import type { ModeloDeFollowup } from "./tipos";
import { montarEscada } from "./escada";

const MIN_MS = 60_000;
const DIA_MS = 86_400_000;

/** Quem responde um follow-up está falando com o atendimento, não com o fluxo. */
const O_ATENDIMENTO_ASSUME = "O paciente respondeu — quem segue a conversa é o atendimento.";

export const MODELOS_DE_CLINICA: readonly ModeloDeFollowup[] = [
  {
    id: "clinica-consulta-retomada",
    nicho: "clinica",
    nome: "Consulta · retomar quem sumiu na marcação",
    jornada: "Consulta",
    resumo:
      "O paciente perguntou sobre consulta, a conversa parou antes de marcar e ninguém voltou nela.",
    oQueDispara: "Um dia inteiro sem o paciente responder, com a marcação em aberto.",
    pedeEtapa: false,
    // `pause`: atendente assumiu a conversa, o follow-up espera. Não cancela —
    // se o atendimento não fechar a marcação, a escada continua de onde parou.
    handoffPolicy: "pause",
    gatilho: () => ({
      kind: "silence",
      params: { threshold_minutes: 24 * 60 },
      cancel_on_reply: true,
    }),
    grafo: montarEscada({
      prazoDeRespostaMs: 2 * DIA_MS,
      sim: { rotulo: "Quer marcar", padrao: "quero" },
      notaDeResposta: O_ATENDIMENTO_ASSUME,
      toques: [
        {
          rotulo: "Retoma a marcação",
          texto:
            "Oi! Ficamos de acertar o horário da sua consulta e a conversa parou por aqui. Quer que eu veja o que ainda está livre?",
        },
        {
          esperaAntesMs: 2 * DIA_MS,
          rotulo: "Pergunta o período",
          texto:
            "Passando de novo por aqui 🙂 Se ainda quiser marcar, me diz só o melhor período para você — manhã ou tarde — que eu procuro um horário.",
        },
        {
          esperaAntesMs: 4 * DIA_MS,
          rotulo: "Último toque",
          texto:
            "Esta é a última vez que eu apareço sobre isso. Se quiser retomar a marcação, é só me responder a qualquer momento. Se preferir deixar para mais para a frente, tudo bem também.",
        },
      ],
    }),
  },

  {
    id: "clinica-exame-marcar",
    nicho: "clinica",
    nome: "Exame · marcar o exame que foi pedido",
    jornada: "Exame",
    resumo:
      "Saiu o pedido de exame e o paciente ainda não marcou. O fluxo cobra por duas semanas e sai de cena.",
    oQueDispara: "O negócio entrar na etapa do funil que você escolher.",
    pedeEtapa: true,
    handoffPolicy: "pause",
    gatilho: ({ stageId }) => ({
      kind: "stage_change",
      params: { stage_id: stageId! },
      cancel_on_reply: true,
    }),
    grafo: montarEscada({
      prazoDeRespostaMs: 3 * DIA_MS,
      sim: { rotulo: "Quer marcar", padrao: "quero" },
      notaDeResposta: O_ATENDIMENTO_ASSUME,
      toques: [
        {
          // Um dia de espera, e não zero: a etapa quase sempre muda DURANTE a
          // conversa, e mandar na mesma hora é falar por cima de quem atende.
          esperaAntesMs: DIA_MS,
          rotulo: "Oferece marcar",
          texto:
            "Oi! Sobre o exame que foi pedido: quer que eu veja os horários para você? Me responde aqui que eu organizo.",
        },
        {
          esperaAntesMs: 3 * DIA_MS,
          rotulo: "Pergunta o período",
          texto:
            "Ainda dá para marcar o seu exame. Me diz o período que funciona melhor — manhã ou tarde — e eu procuro uma data.",
        },
        {
          esperaAntesMs: 5 * DIA_MS,
          rotulo: "Encerra e libera",
          texto:
            "Último lembrete sobre o exame 🙂 Se quiser marcar, me responde que eu vejo uma data. E se você já tiver feito em outro lugar, me avisa que eu encerro por aqui.",
        },
      ],
    }),
  },

  {
    id: "clinica-cirurgia-decisao",
    nicho: "clinica",
    nome: "Cirurgia · acompanhar a decisão",
    jornada: "Cirurgia",
    resumo:
      "Quem foi avaliado e não marcou não desistiu: está decidindo. O fluxo acompanha por quase três meses, sem pressionar.",
    oQueDispara: "O negócio entrar na etapa do funil que você escolher.",
    pedeEtapa: true,
    // `pause` também aqui: a decisão de uma cirurgia passa por conversa com
    // médico e família, e essa conversa é sempre humana. O fluxo espera.
    handoffPolicy: "pause",
    gatilho: ({ stageId }) => ({
      kind: "stage_change",
      params: { stage_id: stageId! },
      cancel_on_reply: true,
    }),
    grafo: montarEscada({
      prazoDeRespostaMs: 5 * DIA_MS,
      sim: { rotulo: "Quer retomar", padrao: "quero" },
      notaDeResposta: O_ATENDIMENTO_ASSUME,
      toques: [
        {
          esperaAntesMs: 3 * DIA_MS,
          rotulo: "Abre para dúvidas",
          texto:
            "Oi! Sei que essa decisão não é simples e não tem pressa nenhuma da nossa parte. Ficou alguma dúvida do que foi conversado na consulta? Pode perguntar por aqui.",
        },
        {
          esperaAntesMs: 10 * DIA_MS,
          rotulo: "Oferece rever condições",
          texto:
            "Passando para saber como você está pensando. Se quiser rever as condições, o preparo ou as datas possíveis, me chama que eu explico tudo de novo com calma.",
        },
        {
          esperaAntesMs: 21 * DIA_MS,
          rotulo: "Convida a retomar",
          texto:
            "Faz um tempo que a gente não conversa sobre o seu caso. Se quiser retomar, me responde aqui que eu vejo uma data com a equipe.",
        },
        {
          esperaAntesMs: 30 * DIA_MS,
          rotulo: "Deixa a porta aberta",
          texto:
            "Esta é a minha última mensagem sobre isso — não quero incomodar. Se em algum momento você quiser retomar, é só me escrever: o seu histórico continua com a gente.",
        },
      ],
    }),
  },

  {
    id: "clinica-falta-remarcar",
    nicho: "clinica",
    nome: "Falta · remarcar quem não veio",
    jornada: "Falta",
    resumo:
      "A falta foi confirmada na agenda e o horário ficou vago. O fluxo oferece outra data em vez de deixar o paciente sumir.",
    oQueDispara: "Alguém confirmar na agenda que o paciente não compareceu.",
    pedeEtapa: false,
    handoffPolicy: "pause",
    gatilho: () => ({ kind: "appointment_no_show", cancel_on_reply: true }),
    grafo: montarEscada({
      prazoDeRespostaMs: 2 * DIA_MS,
      sim: { rotulo: "Quer remarcar", padrao: "remarcar" },
      notaDeResposta: O_ATENDIMENTO_ASSUME,
      toques: [
        {
          // Duas horas, não na mesma hora: a confirmação da falta costuma ser
          // registrada logo depois do horário, e o paciente pode estar a
          // caminho, preso no trânsito ou resolvendo o que o fez faltar.
          esperaAntesMs: 120 * MIN_MS,
          rotulo: "Oferece outra data",
          texto:
            "Oi! Vi que a gente não conseguiu se encontrar no horário de hoje. Acontece 🙂 Quer que eu veja outra data para você?",
        },
        {
          esperaAntesMs: 2 * DIA_MS,
          rotulo: "Pede dia e período",
          texto:
            "Consigo encaixar você em outro horário. Me diz o dia da semana e o período que funcionam melhor para você.",
        },
        {
          esperaAntesMs: 5 * DIA_MS,
          rotulo: "Encerra o assunto",
          texto:
            "Se ainda quiser remarcar, é só me responder. Depois desta eu paro de lembrar, para não encher a sua caixa de mensagem 🙂",
        },
      ],
    }),
  },
];

/**
 * OS QUADROS PRONTOS, POR TIPO DE NEGÓCIO.
 *
 * Existem por duas razões, e a segunda é a que importa mais:
 *
 * 1. São o PLANO B. Quando a chave de IA não está no lugar, não tem saldo, ou o
 *    provedor devolve algo que não vira funil, o passo continua entregando um
 *    quadro que faz sentido — em vez de devolver a pessoa ao funil de
 *    e-commerce que o gatilho semeou. Falhar fechado na ação, aberto na
 *    informação: a tela diz que a sugestão não veio e mostra os prontos.
 *
 * 2. São a RÉGUA. É contra estes exemplos que a sugestão da IA é pedida e
 *    comparada. Sem um alvo concreto, "sugira um funil" devolve cinco colunas
 *    com nomes de manual de vendas ("Prospecção", "MQL", "Fundo de funil") que
 *    não são o que o dono de uma clínica chama as coisas.
 *
 * ⚠️ TODA ETAPA CARREGA O PASSO. Um pacote que só desse os nomes trocaria um
 * quadro errado por um quadro certo e igualmente parado — ver o cabeçalho de
 * `proposta-de-funil.ts` para a medição.
 */
import type { PropostaDeFunil } from "@/lib/onboarding/proposta-de-funil";

export interface PacoteDeFunil {
  id: string;
  /**
   * Como o dono reconhece o próprio negócio nesta lista. Não é o nome do nicho
   * no material de marketing ("vertical de saúde") — é o que ele responderia se
   * alguém perguntasse o que ele faz.
   */
  comoSeApresenta: string;
  proposta: PropostaDeFunil;
}

export const PACOTES: readonly PacoteDeFunil[] = [
  {
    id: "clinica",
    comoSeApresenta: "Clínica, consultório ou salão",
    proposta: {
      nome: "Agendamentos",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o caso", passo: "qualifying" },
        { nome: "Quer agendar", passo: "qualified" },
        { nome: "Escolhendo horário", passo: "negotiating" },
        { nome: "Consulta marcada", passo: "won" },
        { nome: "Não vai marcar", passo: "lost" },
      ],
    },
  },
  {
    id: "imobiliaria",
    comoSeApresenta: "Imobiliária ou corretor",
    proposta: {
      nome: "Interessados",
      etapas: [
        { nome: "Novo interessado", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o que procura", passo: "qualifying" },
        { nome: "Sei o que oferecer", passo: "qualified" },
        { nome: "Visitando imóveis", passo: "negotiating" },
        { nome: "Fechou negócio", passo: "won" },
        { nome: "Desistiu", passo: "lost" },
      ],
    },
  },
  {
    id: "servicos",
    comoSeApresenta: "Serviços, agência ou obra",
    proposta: {
      nome: "Orçamentos",
      etapas: [
        { nome: "Pedido novo", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o projeto", passo: "qualifying" },
        { nome: "Orçamento enviado", passo: "qualified" },
        { nome: "Negociando", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
  },
  {
    id: "curso",
    comoSeApresenta: "Curso, mentoria ou infoproduto",
    proposta: {
      nome: "Matrículas",
      etapas: [
        { nome: "Novo interessado", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Tirando dúvidas", passo: "qualifying" },
        { nome: "Quer entrar", passo: "qualified" },
        { nome: "Fechando condições", passo: "negotiating" },
        { nome: "Matriculado", passo: "won" },
        { nome: "Desistiu", passo: "lost" },
      ],
    },
  },
  {
    id: "loja",
    comoSeApresenta: "Loja — online ou de rua",
    proposta: {
      nome: "Vendas",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Escolhendo o produto", passo: "qualifying" },
        { nome: "Vai levar", passo: "qualified" },
        { nome: "Aguardando pagamento", passo: "negotiating" },
        { nome: "Pedido pago", passo: "won" },
        { nome: "Não comprou", passo: "lost" },
      ],
    },
  },
  {
    id: "generico",
    // Último de propósito: quem não se reconhece em nenhum dos outros já leu
    // todos antes de chegar aqui.
    comoSeApresenta: "Outro tipo de negócio",
    proposta: {
      nome: "Clientes",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo a necessidade", passo: "qualifying" },
        { nome: "Proposta enviada", passo: "qualified" },
        { nome: "Negociando", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
  },
] as const;

/**
 * O pacote de último recurso.
 *
 * Existe como CONSTANTE e não como `PACOTES[0]` porque quem chama precisa de uma
 * garantia de que sempre há um: um índice fixo numa lista editável é a promessa
 * que se quebra na primeira reordenação, e o desfecho seria uma tela de
 * onboarding com `undefined` no lugar do quadro.
 */
export const PACOTE_PADRAO: PacoteDeFunil =
  PACOTES.find((p) => p.id === "generico") ??
  (() => {
    throw new Error("PACOTES sem o pacote genérico — ele é o último recurso do passo do funil");
  })();

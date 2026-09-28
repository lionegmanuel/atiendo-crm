/**
 * Curated PT-BR first-name lookup for the conversation RAG anonymizer.
 *
 * Lowercase ASCII-and-accented entries (≥200). Used only inside the anonymizer
 * to mask tokens that match. Excludes polysemous words (e.g. "rosa", "flor",
 * "neve") that double as common nouns to avoid false positives in product /
 * policy chatter.
 *
 * If you add an entry, keep it lowercase and consider whether the word ever
 * appears as a non-name in PT-BR conversation. When in doubt, leave it out —
 * false negatives in this set are preferable to false positives that scrub
 * meaningful product context.
 */

export const FIRST_NAMES_PT_BR: ReadonlySet<string> = new Set<string>([
  // Top masculino
  "joão", "joao", "jose", "josé", "antonio", "antônio", "francisco", "carlos",
  "paulo", "pedro", "lucas", "luiz", "luis", "luís", "marcos", "gabriel",
  "rafael", "daniel", "marcelo", "bruno", "eduardo", "felipe", "rodrigo",
  "manoel", "ricardo", "mateus", "matheus", "leonardo", "andre", "andré",
  "sergio", "sérgio", "marcio", "márcio", "vinicius", "vinícius", "thiago",
  "tiago", "alex", "alexandre", "igor", "vitor", "victor", "gustavo", "hugo",
  "miguel", "arthur", "bernardo", "heitor", "davi", "davih", "theo", "lorenzo",
  "ravi", "noah", "samuel", "henrique", "enzo", "joaquim", "guilherme",
  "fernando", "roberto", "renato", "robson", "edson", "edinaldo", "elias",
  "evandro", "fabio", "fábio", "fabricio", "fabrício", "ivan", "jackson",
  "jonas", "jorge", "juliano", "julio", "júlio", "leandro", "lucio", "lúcio",
  "marcelo", "moacir", "nathan", "natanael", "nilson", "nelson", "olavo",
  "oscar", "otavio", "otávio", "pablo", "raul", "regis", "régis", "renan",
  "ronaldo", "rubens", "saulo", "sebastiao", "sebastião", "silvio", "sílvio",
  "tadeu", "tales", "tarcisio", "tarcísio", "ubirajara", "valter", "wagner",
  "waldir", "valdir", "wallace", "washington", "wesley", "wilson", "yuri",
  "agnaldo", "agostinho", "aldo", "alfredo", "almir", "amaro", "amilton",
  "anderson", "antonella", "ari", "arnaldo", "augusto", "ayrton", "benedito",
  "bento", "caio", "celso", "cesar", "césar", "cicero", "cícero", "claudio",
  "cláudio", "cleber", "clovis", "clóvis", "cristiano", "diego", "dilson",
  "domingos", "edmilson", "egidio", "egídio", "elieser", "emanuel", "ezequiel",
  "fagner", "fausto", "fernando", "geraldo", "gilberto", "giovanni", "haroldo",
  "helio", "hélio", "heraldo", "hermes", "iago", "ismael", "israel", "ivanildo",
  "jadir", "jairo", "joel", "jonatan", "jonathan", "joserlandio", "judas",
  "junior", "júnior", "juvenal", "kaique", "kaio", "lazaro", "lázaro", "levi",
  "lourival", "luan", "marcelinho", "mauricio", "maurício", "mauro", "moises",
  "moisés", "murilo", "nivaldo", "noel", "norberto", "odair", "orlando",
  "oswaldo", "patrick", "raimundo", "raphael", "renato", "ricardo", "romario",
  "romário", "ronaldinho", "saulo", "severino", "talisson", "tomas", "tomás",
  "ulisses", "valdemar", "valmir", "wendel", "wendell", "yago",

  // Top feminino
  "ana", "maria", "francisca", "antonia", "antônia", "adriana", "juliana",
  "marcia", "márcia", "fernanda", "patricia", "patrícia", "aline", "sandra",
  "camila", "amanda", "bruna", "jessica", "jéssica", "leticia", "letícia",
  "julia", "júlia", "luciana", "isabela", "isabella", "sofia", "sophia",
  "helena", "alice", "valentina", "laura", "manuela", "beatriz", "mariana",
  "antonella", "cecilia", "cecília", "alicia", "alícia", "livia", "lívia",
  "melissa", "esther", "lara", "agatha", "ágatha", "eloah", "yasmin", "rebeca",
  "evelyn", "giovanna", "larissa", "jade", "gabriela", "simone", "claudia",
  "cláudia", "regina", "rita", "monica", "mônica", "vera", "lucia", "lúcia",
  "elaine", "eliana", "elisabete", "elisangela", "elisângela", "eliane",
  "fabiana", "flavia", "flávia", "francineide", "geni", "graziela", "ines",
  "inês", "ivone", "joana", "joelma", "josefa", "katia", "kátia", "laercia",
  "lais", "laís", "leila", "lourdes", "lucineide", "magda", "marcela",
  "marlene", "marta", "marília", "marilia", "marilene", "michelle", "milena",
  "naiara", "natalia", "natália", "neide", "nilza", "noemi", "noemia", "olga",
  "paloma", "priscila", "raquel", "raissa", "raíssa", "renata", "roberta",
  "rosangela", "rosângela", "rute", "salete", "sara", "selma", "silvana",
  "silvia", "sílvia", "solange", "sonia", "sônia", "stella", "suzana", "suzane",
  "talita", "tania", "tânia", "tatiana", "telma", "terezinha", "thais", "thaís",
  "valeria", "valéria", "vanessa", "vania", "vânia", "vera", "viviane",
  "wanda", "wilma", "zelia", "zélia", "zilda",
]);

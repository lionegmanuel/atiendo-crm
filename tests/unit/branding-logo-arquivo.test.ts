import { describe, expect, it } from "vitest";

import {
  BUCKET_DE_LOGOS,
  caminhoBateComPrefixo,
  caminhoNovoDoLogo,
  FORMA_DO_NOME_DO_LOGO,
  logoDaCamada,
  PREFIXO_DA_INSTALACAO,
  prefixoDaOrganizacao,
  TAMANHO_MAXIMO_DO_LOGO,
  urlPublicaDoLogo,
} from "@/lib/branding/logo";
import { extensaoDe, farejarTipo, pareceSvg, podeApagar } from "@/lib/branding/logo-arquivo";

/**
 * O QUE ENTRA NO BUCKET DE LOGOS, E O QUE PODE SER APAGADO DE DENTRO DELE.
 *
 * Três propriedades, e nenhuma delas tem outro lugar onde possa ser medida:
 *
 *   1. **O tipo sai dos BYTES.** As duas defesas "de tipo" que o repositório já
 *      tinha — `file.type` em `app/api/v1/channels/partner/templates/media/
 *      route.ts:62` e `allowed_mime_types` do bucket — leem o MESMO campo, que é
 *      o `Content-Type` escolhido por quem sobe. Um teste de rota não separaria
 *      as duas coisas; aqui a função recebe bytes e não tem como saber o que o
 *      cliente disse.
 *   2. **SVG é recusado ANTES do farejador**, para a pessoa receber a frase que
 *      explica o problema dela em vez de "tipo não suportado".
 *   3. **O prefixo é asseverado na hora de APAGAR.** É a propriedade cuja falha
 *      é destrutiva e silenciosa: sem ela, um admin de tenant grava como logo
 *      dele o `platform/...` que qualquer pessoa lê no HTML da tela de login e,
 *      na troca seguinte, o `service_role` apaga o logo da instalação inteira.
 *
 * ── O que este arquivo NÃO cobre, declarado ──────────────────────────────────
 *
 * A ORDEM das verificações dentro da rota (tamanho antes de ler bytes, SVG antes
 * do farejador, gravar antes de apagar) não é medida aqui — testar N caminhos não
 * prova precedência. Ela vive em `tests/invariants/marca-logo.test.ts` (o lado do
 * banco) e em `tests/e2e/marca-logo.spec.ts` (o lado da tela).
 */

/** Um PNG mínimo: só a assinatura importa para o farejador. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
/** JPEG: SOI + o primeiro marcador (`E0` = JFIF). */
const JPEG_JFIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
/** JPEG de câmera: `E1` = EXIF. O quarto byte VARIA e não pode ser fixado. */
const JPEG_EXIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x12, 0x34]);

function bytesDe(texto: string): Uint8Array {
  return new Uint8Array([...texto].map((c) => c.charCodeAt(0)));
}

const ORG = "11111111-1111-4111-8111-111111111111";
const NOME = "22222222-2222-4222-8222-222222222222.png";

describe("farejarTipo — o tipo sai dos bytes, nunca do que o cliente diz", () => {
  it("reconhece PNG e as duas variantes de JPEG", () => {
    expect(farejarTipo(PNG)).toBe("image/png");
    expect(farejarTipo(JPEG_JFIF)).toBe("image/jpeg");
    // Se a assinatura fosse fixada em 4 bytes (`FF D8 FF E0`), este caso
    // recusaria JPEG legítimo de câmera — e o sintoma seria "o site não aceita
    // minha foto", sem nada no log.
    expect(farejarTipo(JPEG_EXIF)).toBe("image/jpeg");
  });

  it("recusa o que NÃO é PNG nem JPEG, inclusive o que só finge ser", () => {
    // GIF, PDF, ZIP (docx/xlsx), WEBP e um SOI truncado — este último é o caso
    // que dois bytes de assinatura deixariam passar.
    expect(farejarTipo(bytesDe("GIF89a"))).toBeNull();
    expect(farejarTipo(bytesDe("%PDF-1.7"))).toBeNull();
    expect(farejarTipo(bytesDe("PK"))).toBeNull();
    expect(farejarTipo(bytesDe("RIFF____WEBPVP8 "))).toBeNull();
    expect(farejarTipo(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(farejarTipo(new Uint8Array())).toBeNull();
  });

  it("um PNG renomeado para .jpg continua sendo PNG (o nome não decide nada)", () => {
    // O caminho gravado sai daqui, não da extensão que veio no multipart.
    expect(extensaoDe(farejarTipo(PNG)!)).toBe("png");
    expect(extensaoDe(farejarTipo(JPEG_JFIF)!)).toBe("jpg");
  });
});

describe("pareceSvg — a recusa que tem frase própria", () => {
  it("pega SVG cru, com declaração XML, com DOCTYPE e com BOM antes", () => {
    expect(pareceSvg(bytesDe('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
    expect(pareceSvg(bytesDe('<?xml version="1.0"?><svg><script>alert(1)</script></svg>'))).toBe(
      true,
    );
    expect(pareceSvg(bytesDe('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">'))).toBe(true);
    expect(pareceSvg(bytesDe("﻿   \n<svg />"))).toBe(true);
    // Maiúsculas e espaço depois do `<` — as duas grafias que um editor produz.
    expect(pareceSvg(bytesDe("< SVG >"))).toBe(true);
  });

  it("NÃO confunde imagem de verdade com XML", () => {
    // O falso positivo aqui recusaria um PNG legítimo com uma frase sobre SVG —
    // a pessoa procuraria o defeito no arquivo errado.
    expect(pareceSvg(PNG)).toBe(false);
    expect(pareceSvg(JPEG_JFIF)).toBe(false);
  });

  it("um SVG com 2 KB de comentário antes da tag ainda é pego", () => {
    // A janela de farejamento é de 1 KB; a tag raiz depois disso ESCAPA daqui —
    // e é por isso que `pareceSvg` não é a defesa, só a mensagem. Este caso
    // congela o desfecho: escapou da frase, mas NÃO entra no bucket.
    const longo = bytesDe(`<!--${"x".repeat(2048)}--><svg/>`);
    expect(pareceSvg(longo)).toBe(false);
    expect(farejarTipo(longo)).toBeNull();
  });
});

describe("caminhoBateComPrefixo / podeApagar — o prefixo asseverado", () => {
  const prefixo = prefixoDaOrganizacao(ORG);

  it("aceita o caminho do próprio escopo", () => {
    expect(caminhoBateComPrefixo(`${prefixo}${NOME}`, prefixo)).toBe(true);
    expect(caminhoBateComPrefixo(`platform/${NOME}`, PREFIXO_DA_INSTALACAO)).toBe(true);
    expect(podeApagar(`${prefixo}${NOME}`, prefixo)).toBe(true);
  });

  it("RECUSA o caminho de outro escopo — é o ataque, e ele é destrutivo", () => {
    // O admin de um tenant lê a URL do logo da plataforma no HTML público, grava
    // esse ponteiro como o dele e sobe outro arquivo: sem esta recusa, a rota
    // (service_role) apaga o logo da instalação inteira.
    expect(podeApagar(`platform/${NOME}`, prefixo)).toBe(false);
    expect(podeApagar(`33333333-3333-4333-8333-333333333333/${NOME}`, prefixo)).toBe(false);
    // E o contrário também: a instalação não apaga arquivo de tenant.
    expect(podeApagar(`${prefixo}${NOME}`, PREFIXO_DA_INSTALACAO)).toBe(false);
  });

  it("RECUSA travessia de diretório e prefixo que é só o começo do texto", () => {
    expect(podeApagar(`${prefixo}../platform/${NOME}`, prefixo)).toBe(false);
    expect(podeApagar(`platform/../${prefixo}${NOME}`, PREFIXO_DA_INSTALACAO)).toBe(false);
    // `platform-outro/` começa com `platform` e NÃO está sob `platform/`. É por
    // isso que o prefixo termina em barra e a função cobra isso.
    expect(caminhoBateComPrefixo(`platform-outro/${NOME}`, PREFIXO_DA_INSTALACAO)).toBe(false);
    expect(caminhoBateComPrefixo(`platform/${NOME}`, "platform")).toBe(false);
  });

  it("RECUSA nome fora da forma — extensão, subpasta e uuid inventado", () => {
    expect(podeApagar(`platform/x.png`, PREFIXO_DA_INSTALACAO)).toBe(false);
    expect(podeApagar(`platform/${NOME.replace(".png", ".svg")}`, PREFIXO_DA_INSTALACAO)).toBe(
      false,
    );
    expect(podeApagar(`platform/sub/${NOME}`, PREFIXO_DA_INSTALACAO)).toBe(false);
    expect(podeApagar(`platform/${NOME}.png`, PREFIXO_DA_INSTALACAO)).toBe(false);
  });

  it("caminho vazio ou ausente NÃO é apagável (não há nada a apagar)", () => {
    expect(podeApagar(null, PREFIXO_DA_INSTALACAO)).toBe(false);
    expect(podeApagar(undefined, PREFIXO_DA_INSTALACAO)).toBe(false);
    expect(podeApagar("   ", PREFIXO_DA_INSTALACAO)).toBe(false);
  });

  it("o caminho que a rota GERA passa na própria asserção (guarda de vacuidade)", () => {
    // Sem este caso, todas as recusas acima poderiam estar certas por a função
    // recusar TUDO — e o produto nunca conseguiria apagar o arquivo anterior.
    for (const prefixoTestado of [PREFIXO_DA_INSTALACAO, prefixo]) {
      for (const ext of ["png", "jpg"] as const) {
        const gerado = caminhoNovoDoLogo(prefixoTestado, ext);
        expect(podeApagar(gerado, prefixoTestado), gerado).toBe(true);
        expect(FORMA_DO_NOME_DO_LOGO.test(gerado.slice(prefixoTestado.length)), gerado).toBe(true);
      }
    }
  });
});

describe("urlPublicaDoLogo / logoDaCamada — o que a camada mostra", () => {
  it("monta a URL pública do bucket, normalizando barra sobrando", () => {
    const esperada = `https://p.supabase.co/storage/v1/object/public/${BUCKET_DE_LOGOS}/platform/${NOME}`;
    expect(urlPublicaDoLogo(`platform/${NOME}`, "https://p.supabase.co")).toBe(esperada);
    // Barra no fim é grafia legítima do `.env` do operador, e sem a normalização
    // produziria `//storage`.
    expect(urlPublicaDoLogo(`platform/${NOME}`, "https://p.supabase.co/")).toBe(esperada);
  });

  it("o ARQUIVO subido vence a URL colada, dentro da mesma camada", () => {
    expect(logoDaCamada(`platform/${NOME}`, "https://cdn/antigo.png", "https://p.co")).toBe(
      `https://p.co/storage/v1/object/public/${BUCKET_DE_LOGOS}/platform/${NOME}`,
    );
  });

  it("sem arquivo, a URL colada continua valendo — é a rede de rollback", () => {
    expect(logoDaCamada(null, "https://cdn/antigo.png", "https://p.co")).toBe(
      "https://cdn/antigo.png",
    );
    expect(logoDaCamada("   ", "https://cdn/antigo.png", "https://p.co")).toBe(
      "https://cdn/antigo.png",
    );
  });

  it("sem base do Storage, o caminho NÃO vira URL relativa — desce para a camada de baixo", () => {
    // Uma URL relativa faria o `<img>` pedir `/storage/v1/...` ao próprio app e
    // receber HTML de 404 — logo quebrado em vez de logo ausente.
    expect(logoDaCamada(`platform/${NOME}`, null, "")).toBeNull();
    expect(logoDaCamada(`platform/${NOME}`, "https://cdn/antigo.png", "")).toBe(
      "https://cdn/antigo.png",
    );
  });

  it("nada configurado é `null`, e não string vazia", () => {
    expect(logoDaCamada(null, null, "https://p.co")).toBeNull();
    expect(logoDaCamada(undefined, "  ", "https://p.co")).toBeNull();
  });
});

describe("os números que o código e o banco compartilham", () => {
  it("o teto de tamanho é o mesmo do `file_size_limit` do bucket", () => {
    // 524288 é o literal do `insert into storage.buckets` da migration 0158. Dois
    // tetos diferentes fariam a rota recusar com 413 um arquivo que o bucket
    // aceitaria — ou, pior, o contrário: a rota aceita, o Storage recusa, e o
    // erro que chega à tela é "erro ao subir o logo".
    expect(TAMANHO_MAXIMO_DO_LOGO).toBe(524288);
  });

  it("o bucket não carrega a marca do produto no nome", () => {
    // `tests/unit/branding.test.ts` varre `/deskcomm/i` em 5 raízes de código.
    // O nome do bucket também vai para a URL pública, que o cliente do
    // revendedor vê.
    expect(BUCKET_DE_LOGOS).not.toMatch(/deskcomm/i);
  });
});

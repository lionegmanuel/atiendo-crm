/**
 * Leitura de reference de skill instalável (Fase 2 do épico harness — Task 6).
 * Uma reference é um arquivo do PACOTE da skill (manifest, migration 0068) que não
 * cabe no corpo (>200 linhas — regra 9): o modelo pede sob demanda via a tool
 * read_skill_reference (inbound-turn.ts). Duas invariantes de segurança, ambas
 * validadas ANTES de tocar storage:
 *   1. só lê references de skills CASADAS neste turno (matchedSkills, fechado no
 *      closure do run) — pedir uma skill que não casou nunca vaza conteúdo dela;
 *   2. o ref_path pedido precisa estar no MANIFESTO da skill como kind:'reference'
 *      — path fora do manifesto (ou kind:'asset') é rejeitado antes do download.
 * Erros são sempre de ENSINO ({ ok:false, error }), nunca throw (convenção do run).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoadedSkill } from './skills';

const SKILL_ASSETS_BUCKET = 'skill-assets';

interface ManifestEntry {
  path: string;
  kind: 'reference' | 'asset';
}

function referenceEntries(manifest: readonly unknown[]): ManifestEntry[] {
  return manifest.filter(
    (m): m is ManifestEntry =>
      m !== null &&
      typeof m === 'object' &&
      typeof (m as ManifestEntry).path === 'string' &&
      (m as ManifestEntry).kind === 'reference',
  );
}

/** Gate de disponibilidade da tool (inbound-turn.ts): só oferece quando há o que ler. */
export function skillHasReferences(skill: LoadedSkill): boolean {
  return referenceEntries(skill.manifest).length > 0;
}

export type ReadSkillReferenceResult =
  | { ok: true; skill_name: string; ref_path: string; content: string }
  | { ok: false; error: { code: string; message: string } };

/**
 * `matchedSkills` é SEMPRE skillMatch.matched do turno corrente (closure de
 * inbound-turn.ts) — nunca todas as skills carregadas, por isso pedir uma skill
 * que não casou (mesmo que exista no tenant) devolve skill_not_active.
 */
export async function readSkillReference(
  deps: { admin: SupabaseClient },
  input: { organizationId: string; matchedSkills: readonly LoadedSkill[]; skillName: string; refPath: string },
): Promise<ReadSkillReferenceResult> {
  const skill = input.matchedSkills.find((s) => s.name === input.skillName);
  if (skill === undefined) {
    return {
      ok: false,
      error: {
        code: 'skill_not_active',
        message: `a skill '${input.skillName}' não está ativa neste turno — só é possível ler references de skills já casadas.`,
      },
    };
  }
  const entry = referenceEntries(skill.manifest).find((e) => e.path === input.refPath);
  if (entry === undefined) {
    return {
      ok: false,
      error: {
        code: 'reference_not_found',
        message: `'${input.refPath}' não é uma reference conhecida da skill '${input.skillName}' — confira o caminho exato do manifesto.`,
      },
    };
  }
  const objectPath = `${input.organizationId}/${skill.name}/${skill.versionId}/${input.refPath}`;
  const { data, error } = await deps.admin.storage.from(SKILL_ASSETS_BUCKET).download(objectPath);
  if (error || data === null) {
    return {
      ok: false,
      error: {
        code: 'reference_download_failed',
        message: 'a reference existe no manifesto mas não foi possível lê-la agora — siga sem ela ou tente de novo.',
      },
    };
  }
  return { ok: true, skill_name: skill.name, ref_path: input.refPath, content: await data.text() };
}

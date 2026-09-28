/**
 * Import writer de skill instalável (Fase 2 do épico harness — spec 2026-07-23).
 * `importSkillPackage`: sobe o pacote já parseado (Task 3) pro storage + cria a
 * `skill_version` com manifest + ponteiro da org. `installPlatformSkill`: fork-on-
 * install — copia uma skill do catálogo de plataforma pro catálogo da org.
 *
 * organization_id é SEMPRE o parâmetro do chamador (fonte confiável — cookie/JWT
 * resolvido antes desta função), NUNCA um campo do pkg: `ParsedSkillPackage` não tem
 * organization_id, e mesmo que um pacote adulterado carregasse um, esta função nunca
 * olha pra dentro do pkg em busca de tenant.
 */
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';

import { insertSkillVersion, setSkillPointer, type SkillMatcher } from '../../agent-engine/agent/skills';
import type { ParsedSkillPackage } from './package';

const SKILL_ASSETS_BUCKET = 'skill-assets';

/**
 * Ordem importa: insere a `skill_version` PRIMEIRO (o path de storage precisa do
 * versionId), depois sobe cada arquivo, só então move o ponteiro — a versão só fica
 * visível ao runtime (loadSkills) depois que todo o conteúdo já está no bucket. Upload
 * falho limpa os arquivos já subidos e lança; a versão órfã fica no banco (inofensiva —
 * nenhum ponteiro aponta pra ela), só logada para investigação.
 */
export async function importSkillPackage(
  deps: { db: pg.Pool; admin: SupabaseClient },
  input: { organizationId: string; pkg: ParsedSkillPackage; createdBy: string | null },
): Promise<{ versionId: string; name: string }> {
  const { organizationId, pkg } = input;

  const version = await insertSkillVersion(deps.db, {
    tenantId: organizationId,
    name: pkg.name,
    description: pkg.description,
    body: pkg.body,
    matcher: pkg.matcher,
    manifest: pkg.files.map((f) => f.entry),
  });

  const uploaded: string[] = [];
  for (const f of pkg.files) {
    const objectPath = `${organizationId}/${pkg.name}/${version.id}/${f.path}`;
    const { error } = await deps.admin.storage
      .from(SKILL_ASSETS_BUCKET)
      .upload(objectPath, Buffer.from(f.bytes), { upsert: false });
    if (error) {
      if (uploaded.length > 0) {
        await deps.admin.storage.from(SKILL_ASSETS_BUCKET).remove(uploaded);
      }
      console.error(
        `[install-skill] upload falhou (${objectPath}): ${error.message} — versão órfã ${version.id} fica no banco, ponteiro não move`,
      );
      throw new Error(`falha ao subir arquivo do pacote de skill: ${f.path}`);
    }
    uploaded.push(objectPath);
  }

  await setSkillPointer(deps.db, { tenantId: organizationId, name: pkg.name, versionId: version.id });
  return { versionId: version.id, name: pkg.name };
}

interface PlatformSkillRow {
  id: string;
  name: string;
  description: string;
  body: string;
  matcher: SkillMatcher;
  manifest: unknown[];
}

/**
 * Fork-on-install: copia a `skill_version` de PLATAFORMA (organization_id null,
 * resolvida pelo ponteiro de catálogo) pra uma versão nova da org, com
 * `forked_from_version_id` apontando pra origem — a partir daqui a cópia da org é
 * independente (editar/desinstalar não afeta o catálogo de plataforma nem outras orgs).
 */
export async function installPlatformSkill(
  deps: { db: pg.Pool },
  input: { organizationId: string; name: string; createdBy: string | null },
): Promise<{ versionId: string }> {
  const { rows } = await deps.db.query<PlatformSkillRow>(
    `select v.id, v.name, v.description, v.body, v.matcher, v.manifest
     from skill_pointers p
     join skill_versions v on v.id = p.version_id
     where p.organization_id is null and p.name = $1`,
    [input.name],
  );
  const platform = rows[0];
  if (platform === undefined) {
    throw new Error(`skill de plataforma '${input.name}' não encontrada no catálogo — nada para instalar`);
  }

  const version = await insertSkillVersion(deps.db, {
    tenantId: input.organizationId,
    name: platform.name,
    description: platform.description,
    body: platform.body,
    matcher: platform.matcher,
    manifest: platform.manifest,
    forkedFromVersionId: platform.id,
  });

  await setSkillPointer(deps.db, { tenantId: input.organizationId, name: platform.name, versionId: version.id });
  return { versionId: version.id };
}

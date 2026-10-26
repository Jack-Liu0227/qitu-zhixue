import { sql } from 'drizzle-orm';
import type { Database } from '@qitu/database';
import type { AdminTeamTemplateReference, AdminTeamTemplateUsage } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';

export async function readTeamTemplateUsage(
  db: Database | AuditTransaction, teamId: string, updatedAt: Date,
): Promise<AdminTeamTemplateUsage> {
  const result = await db.execute<AdminTeamTemplateReference & Record<string, unknown>>(sql`
    WITH team_bindings AS (
      SELECT b.id, b.template_version_id, b.status,
        (SELECT count(*)::int FROM project_binding_snapshots p WHERE p.binding_id=b.id) AS project_count
      FROM pbl_template_team_bindings b
      WHERE EXISTS (SELECT 1 FROM jsonb_each(b.team_snapshots) frozen WHERE frozen.value->>'teamId'=${teamId})
    )
    SELECT t.id AS "templateId", t.title AS "templateTitle", t.status AS "templateStatus",
      v.id AS "templateVersionId", v.version, v.status AS "versionStatus",
      coalesce(v.content->>'linkedTeamId'=${teamId}, false) AS "linkedInTemplate",
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'status', b.status, 'projectCount', b.project_count) ORDER BY b.id)
        FROM team_bindings b WHERE b.template_version_id=v.id), '[]'::jsonb) AS bindings
    FROM project_template_versions v JOIN project_templates t ON t.id=v.template_id
    WHERE v.content->>'linkedTeamId'=${teamId}
      OR EXISTS (SELECT 1 FROM team_bindings b WHERE b.template_version_id=v.id)
    ORDER BY t.title, t.id, v.created_at DESC, v.id
  `);
  const templates = result.rows;
  return {
    teamId, teamUpdatedAt: updatedAt.toISOString(), templates,
    templateCount: new Set(templates.map(item => item.templateId)).size,
    bindingCount: templates.reduce((sum, item) => sum + item.bindings.length, 0),
    projectCount: templates.reduce((sum, item) => sum + item.bindings.reduce((count, binding) => count + binding.projectCount, 0), 0),
  };
}

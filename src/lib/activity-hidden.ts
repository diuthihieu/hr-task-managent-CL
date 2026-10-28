import { Prisma } from "@prisma/client";

/**
 * SQL condition on activity_logs `a`: the row is about something inside one of
 * `projectIds` (the entity itself, or the task / objective / page it belongs to).
 * Same entity-to-project mapping as the project history route. Rows whose entity
 * was hard-deleted no longer match and stay visible.
 */
export function activityInProjects(projectIds: string[]): Prisma.Sql {
  const ids = Prisma.sql`${projectIds}::uuid[]`;
  return Prisma.sql`(
    (a.entity_type = 'project' AND a.entity_id = ANY(${ids}))
    OR (a.entity_type = 'task' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = a.entity_id AND t.project_id = ANY(${ids})))
    OR (a.entity_type = 'comment' AND EXISTS (SELECT 1 FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = a.entity_id AND t.project_id = ANY(${ids})))
    OR (a.entity_type = 'attachment' AND EXISTS (SELECT 1 FROM attachments f JOIN tasks t ON t.id = f.task_id WHERE f.id = a.entity_id AND t.project_id = ANY(${ids})))
    OR (a.entity_type = 'view' AND EXISTS (SELECT 1 FROM views v WHERE v.id = a.entity_id AND v.project_id = ANY(${ids})))
    OR (a.entity_type = 'custom_field' AND EXISTS (SELECT 1 FROM custom_fields f WHERE f.id = a.entity_id AND f.project_id = ANY(${ids})))
    OR (a.entity_type = 'category' AND EXISTS (SELECT 1 FROM categories c WHERE c.id = a.entity_id AND c.project_id = ANY(${ids})))
    OR (a.entity_type = 'objective' AND EXISTS (SELECT 1 FROM objectives o WHERE o.id = a.entity_id AND o.project_id = ANY(${ids})))
    OR (a.entity_type = 'key_result' AND EXISTS (SELECT 1 FROM key_results k JOIN objectives o ON o.id = k.objective_id WHERE k.id = a.entity_id AND o.project_id = ANY(${ids})))
    OR (a.entity_type = 'agent_run' AND EXISTS (SELECT 1 FROM agent_runs r LEFT JOIN tasks t ON t.id = r.task_id WHERE r.id = a.entity_id AND (r.project_id = ANY(${ids}) OR t.project_id = ANY(${ids}))))
    OR (a.entity_type = 'wiki_page' AND EXISTS (SELECT 1 FROM wiki_pages p WHERE p.id = a.entity_id AND p.source_project_ids && ${ids}))
    OR (a.entity_type = 'decision' AND EXISTS (
      SELECT 1 FROM decisions d
      LEFT JOIN tasks t ON t.id = d.task_id
      LEFT JOIN objectives o ON o.id = d.objective_id
      LEFT JOIN wiki_pages p ON p.id = d.wiki_page_id
      WHERE d.id = a.entity_id AND (d.project_id = ANY(${ids}) OR t.project_id = ANY(${ids}) OR o.project_id = ANY(${ids}) OR p.source_project_ids && ${ids})
    ))
  )`;
}

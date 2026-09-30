-- Wiki pages remember which projects' data they quote, so people hidden from
-- a project can't read it through a wiki page (UI, search or AI answers).
ALTER TABLE "wiki_pages" ADD COLUMN "source_project_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- Backfill existing pages with the same rule the app applies on save
-- (src/lib/wiki-sources.ts): a project is a source when its name appears as a
-- whole word, or one of its task titles (8+ characters) appears, in the page
-- title, body text or comments.
WITH page_text AS (
  SELECT wp.id, wp.workspace_id,
    lower(
      coalesce(wp.title, '') || ' ' ||
      replace(replace(replace(replace(replace(replace(regexp_replace(coalesce(wp.content, ''), '<[^>]+>', ' ', 'g'), '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&') || ' ' ||
      coalesce((SELECT string_agg(c.body, ' ') FROM wiki_comments c WHERE c.wiki_page_id = wp.id AND c.deleted_at IS NULL), '')
    ) AS txt
  FROM wiki_pages wp
),
hits AS (
  SELECT pt.id AS page_id, p.id AS project_id
  FROM page_text pt
  JOIN projects p ON p.workspace_id = pt.workspace_id AND p.deleted_at IS NULL
  WHERE (length(trim(p.name)) >= 2
         AND pt.txt ~ ('(^|[^[:alnum:]])' || regexp_replace(lower(trim(p.name)), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]])'))
     OR EXISTS (
       SELECT 1 FROM tasks t
       WHERE t.project_id = p.id AND t.deleted_at IS NULL AND length(trim(t.title)) >= 8
         AND position(lower(trim(t.title)) IN pt.txt) > 0
     )
)
UPDATE wiki_pages wp
SET source_project_ids = sub.ids
FROM (SELECT page_id, array_agg(DISTINCT project_id) AS ids FROM hits GROUP BY page_id) sub
WHERE wp.id = sub.page_id;

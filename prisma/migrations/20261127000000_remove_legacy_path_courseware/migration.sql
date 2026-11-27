BEGIN;

CREATE TEMP TABLE legacy_path_courseware ON COMMIT DROP AS
SELECT r."id", r."sessionId"
FROM "Resource" r
WHERE r."type" = 'ppt' AND r."sourceAgent" = 'ppt'
  AND (
    r."sessionId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "PathNodeResource" link WHERE link."resourceId" = r."id")
    OR EXISTS (
      SELECT 1 FROM "LearningPath" p
      CROSS JOIN LATERAL jsonb_array_elements(p."nodes") node
      WHERE p."userId" = r."userId"
        AND node.value->'resources' @> jsonb_build_array(jsonb_build_object('resourceId', r."id"))
    )
  );

UPDATE "LearningPath" p
SET "nodes" = (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN jsonb_typeof(node.value->'resources') = 'array'
        THEN jsonb_set(node.value, '{resources}', (
          SELECT COALESCE(jsonb_agg(ref.value ORDER BY ref.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(node.value->'resources') WITH ORDINALITY AS ref
          WHERE NOT EXISTS (SELECT 1 FROM legacy_path_courseware c WHERE c."id" = ref.value->>'resourceId')
        ))
        ELSE node.value
      END ORDER BY node.ordinality
    ), '[]'::jsonb)
    FROM jsonb_array_elements(p."nodes") WITH ORDINALITY AS node
  ),
  "revision" = p."revision" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(p."nodes") AS node
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(node.value->'resources') = 'array' THEN node.value->'resources' ELSE '[]'::jsonb END
  ) AS ref
  JOIN legacy_path_courseware c ON c."id" = ref.value->>'resourceId'
);

UPDATE "dt_sessions" s
SET "revision" = s."revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE s."deleted_at" IS NULL AND EXISTS (
  SELECT 1 FROM legacy_path_courseware c WHERE c."sessionId" = s."id"
);

DELETE FROM "PathNodeResource" link
USING legacy_path_courseware c WHERE link."resourceId" = c."id";

UPDATE "Resource" r
SET "deletedAt" = COALESCE(r."deletedAt", CURRENT_TIMESTAMP),
  "metadata" = NULL, "content" = '', "updatedAt" = CURRENT_TIMESTAMP, "revision" = r."revision" + 1
FROM legacy_path_courseware c WHERE r."id" = c."id";

COMMIT;

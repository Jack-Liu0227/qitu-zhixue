-- Only for a disposable/empty database. Production rollback keeps knowledge data
-- and restores the previous application release instead of dropping these tables.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM knowledge_bases) OR EXISTS(SELECT 1 FROM platform_configuration_revisions) THEN
    RAISE EXCEPTION 'KNOWLEDGE_DATA_PRESENT: restore application code; do not drop persisted knowledge';
  END IF;
END $$;
DROP TABLE knowledge_engine_checks,knowledge_job_events,knowledge_jobs,knowledge_index_versions,knowledge_base_members,project_knowledge_bindings,knowledge_bases,platform_configuration_revisions;
COMMIT;

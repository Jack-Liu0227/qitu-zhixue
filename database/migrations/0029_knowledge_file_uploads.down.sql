DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM knowledge_file_originals LIMIT 1) THEN
    RAISE EXCEPTION 'Original documents exist; keep this table during application rollback';
  END IF;
END $$;
DROP TABLE knowledge_file_originals;

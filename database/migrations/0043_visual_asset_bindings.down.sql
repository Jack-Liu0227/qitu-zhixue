-- Refuse destructive rollback while administrators have stored selections.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM visual_bindings) THEN
    RAISE EXCEPTION 'visual_bindings contains selections; export and review before rollback';
  END IF;
END $$;
DROP TABLE visual_bindings;

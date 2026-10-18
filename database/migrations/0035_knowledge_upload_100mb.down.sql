-- Refuse rollback while files above 10 MiB exist; never delete original files.
ALTER TABLE knowledge_file_originals
  DROP CONSTRAINT knowledge_file_originals_byte_size_check,
  ADD CONSTRAINT knowledge_file_originals_byte_size_check
    CHECK (byte_size > 0 AND byte_size <= 10485760);

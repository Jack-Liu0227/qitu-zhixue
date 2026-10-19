-- Keep the resolved template lesson title, without assigning new semantics to old plans.
ALTER TABLE learning_sessions ADD COLUMN title text;

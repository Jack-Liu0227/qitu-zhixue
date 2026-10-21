CREATE TABLE student_project_lists (
  student_user_id text PRIMARY KEY REFERENCES users(id),
  current_project_id text REFERENCES projects(id),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE TABLE student_project_display (
  student_user_id text NOT NULL REFERENCES users(id),
  project_id text NOT NULL REFERENCES projects(id),
  collected_at timestamptz,
  PRIMARY KEY (student_user_id, project_id)
);
CREATE INDEX projects_student_created_id_idx ON projects(student_user_id, created_at DESC, id DESC);

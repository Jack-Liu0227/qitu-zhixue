# Historical MCP catalog restoration

The Tools & MCP workbench reads the server registry. The former UI-only entries
`groksearch`, `chrome-devtools`, `aionui-browser`, and `fetch` are restored there
with their 16 historical child tool definitions.

These definitions have source `legacy_manifest`; they are display metadata,
not discovered MCP tools or executable handlers. The UI labels their origin.
The registry reports actual connection state. New entries start disabled and
`not_configured`, without invented endpoints or credentials. Existing service
settings, assistant bindings, knowledge engines and model bindings are retained.

After building the API, run `tooling/restore-mcp-catalog.cjs` with an explicit
`QITU_RESTORE_DATABASE` (local PostgreSQL peer authentication) or `DATABASE_URL`.
The runner takes the platform configuration advisory lock, adds only missing
entries, creates an audited configuration revision, and is safe to rerun.
Back up the current configuration revision and runtime registry before running.

Validate the four rows, all 16 expandable input schemas, JSON save/reload,
authorization, actual status in the matrix, and the existing knowledge engine
tree at desktop and mobile widths. The manifest does not establish working MCP
connections; administrators must configure real services separately.

Rollback the application using the previous persistent release. The added
disabled catalog rows are compatible with that release. Avoid restoring a
whole configuration backup after subsequent administrator changes; remove only
these additions through a new audited revision if their removal is necessary.

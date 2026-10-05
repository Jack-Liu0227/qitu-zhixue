console.error('Schema generation is disabled: this repository uses reviewed manual migrations in database/migrations/. Use `pnpm --filter @qitu/database migrate` after review.');
process.exit(1);

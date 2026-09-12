# Migration history recovery and release admission

Use this when `prisma migrate deploy` or `prisma migrate status` reports missing or divergent `_prisma_migrations`, particularly while the live schema still matches `schema.prisma`. A matching schema proves only table, column, and index shape. It cannot prove a data-only backfill ran. Keep the current serving release in place until the checks below are complete.

## Before touching migration history

1. Identify the exact release commit, generated Prisma Client version, migration directory, `APP_MODE`, and resolved database **host and database name**. Confirm the target is the intended environment. Do not print the database URL or credentials into a ticket or log.
2. Take a restorable database backup and test a restore into an isolated database. Record the backup time, restore test, checksum, and operator. A snapshot that has never been restored is not sufficient evidence.
3. Pause concurrent schema changes. Save a read-only inventory of every committed migration name and SHA-256 of its `migration.sql`, and of the live `_prisma_migrations` rows (`migration_name`, `checksum`, `started_at`, `finished_at`, `rolled_back_at`, `logs`). Treat a missing table as an empty history, not as proof of an empty schema.
4. Run the guarded, read-only checks from the release artifact: `prisma migrate status`, `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`, and `node scripts/check-migration-data.mjs`, each through `scripts/with-db-url.mjs`. Record exit codes and output. The data checker covers the known catalogue baseline invariant only; a pass does not certify other migrations.

## Review the effects of each migration

Read every migration SQL file in order and compare its intended schema **and data** effects with the restored backup and current database. Give individual attention to branch stock and attribution, order and payment links, shift approvals, normalized phones, and product catalogue version-1 snapshots. Compare counts and representative records with pre-migration evidence where available. A plausible current value is not proof of a historical value; do not reconstruct unknown history from current rows.

Classify each migration as verified applied, verified absent and safe to apply through normal deployment, or unresolved. Record the supporting query/backup evidence for each classification. Stop on any unresolved migration, checksum mismatch, schema drift, failed read-only data check, or non-restorable backup. Do not reset the database, replay the whole SQL directory, edit `_prisma_migrations` by hand, or mark migrations applied solely because schema parity passed.

Only after a migration's effects are individually verified may the operator plan `prisma migrate resolve --applied <migration_name>` for that single migration. Review the exact command and target, execute once through the guarded database URL path, then rerun status, schema diff, and the relevant data checks before moving to the next migration. A migration verified absent must be handled by an explicit migration plan, never marked applied. Keep the evidence and command/output record with the release.

## Admission and promotion

`backend/scripts/start-production.mjs` attempts deploy, checks status, compares live schema, and checks the known catalogue data invariant when history is unhealthy. Schema drift or a failed data check blocks the new process. With matching schema and a passing known data check, anomalous history logs `MIGRATION_DATA_REVIEW_REQUIRED`; that warning is **not** a recovered-history declaration. Promotion requires the per-migration review above, a generated Prisma Client built from the same release schema, current CI checks, and the authenticated acceptance checks in `URGENT_TODO.md`.

For a local reproduction, `RUN_DISPOSABLE_MIGRATION_REPRO=1 node backend/scripts/reproduce-migration-data.mjs` creates and drops a random loopback test database. It is an automated negative-path check, not an operator repair command.

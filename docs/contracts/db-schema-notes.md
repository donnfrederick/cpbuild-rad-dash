# Database schema notes (rad-dash)

High-level notes for **Prisma** models in `prisma/schema.prisma`: important relations, nullable columns, indexes, and migration caveats.

When you change the schema or add migrations, update this file in the same PR.

## Conventions

- Production uses PostgreSQL via Prisma.
- Call out breaking changes for existing data (backfills, defaults).

## Models

_Add per-domain notes as the schema grows._

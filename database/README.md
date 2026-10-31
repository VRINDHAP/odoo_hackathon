# Database — Subscription Management System (Brightloop)

## 1. Purpose
This folder contains the complete technical specification, schema definitions, migration pipeline, indexing strategies, summary tables, seed generation scripts, Docker Compose environments, CI migration validations, and backup/restore procedures for the Subscription Management System [PDF 1, 3, 5, 11, 14, 15].

## 2. Owner
- **Lead Database Engineer**: Sooraj

## 3. Technology Stack
- **Database Engine**: PostgreSQL 16+ (or MySQL 8+) relational database (Primary + Read Replica architecture) [PDF 3]
- **Connection Pooling**: PgBouncer (transaction pooling mode) [PDF 11]
- **Migration Framework**: Alembic (Python) or Goose/Flyway SQL migrations [PDF 14, 15]
- **Cache & Message Broker**: Redis 7+ [PDF 3]
- **Orchestration**: Docker Compose [PDF 14]
- **Backup & Disaster Recovery**: `pg_dump` / WAL-G with automated test restores [PDF 15]

## 3.1 Hackathon Database Mandate (Relational SQL Only)
- **Strictly Relational**: The platform must use PostgreSQL 16+ (or MySQL 8+) with strict relational schema enforcement, foreign key constraints, composite unique indexes, and ACID multi-table transactions [PDF 3, 5, 7.2].
- **NoSQL / BaaS Strictly Forbidden**: MongoDB, Firebase (Firestore / Realtime DB), CouchDB, DynamoDB, or cloud BaaS platforms are completely prohibited. Multi-table financial invoicing requires atomic relational consistency that document databases cannot natively guarantee.
- **Zero Heavy Cloud Dependencies**: All database containers (Postgres, Redis, PgBouncer) run locally via Docker Compose, eliminating any reliance on external cloud databases.

## 4. How to Run
```bash
# Navigate to database workspace
cd database

# Start PostgreSQL primary, Redis, and PgBouncer
docker-compose up -d

# Verify database health
docker-compose ps

# Run database migrations
alembic upgrade head

# Seed realistic demo data
python scripts/seed_demo.py

# Seed high-volume performance test data (50k subscriptions, 500k invoices)
python scripts/seed_large_volume.py

# Run index query plan verifications (EXPLAIN ANALYZE)
python scripts/verify_indexes.py

# Run backup and restore verification test
bash scripts/backup_and_restore_test.sh
```

## 5. Folder Rules & Exclusive Migration Rights
- **Sole Migration Authority**: ONLY the `/database` folder and developer Sooraj creates and edits database migrations. The backend and frontend teams NEVER create, edit, or commit migration scripts [PDF Prompt Rules].
- **Schema Conventions**:
  - Primary Keys: UUID or bigint [PDF 5].
  - Audit Timestamps: `created_at`, `updated_at`, `created_by` on every entity [PDF 5].
  - Soft Delete: `deleted_at` where historical retention matters (`customers`, `products`, `plans`, `discount_rules`) [PDF 5, 16].
  - Financial Money Type: Strictly `NUMERIC(14,2)` (never float) [PDF 5].
  - Currency Code: Document currency code stored on transaction tables [PDF 5].
  - Indexing: Every foreign key column MUST be indexed [PDF 5].
- **No Double-Billing Hard Guard**: Invariant constraint `UNIQUE(subscription_id, period_start, period_end)` on the `invoices` table must never be removed or disabled [PDF 5.9].

## 6. Team Dependencies
- **Backend Team (`/backend`)**:
  - Consumes the database schema, relational constraints, and connection pooling parameters. Nandana and Vrindha define ORM models matching Sooraj's migrations [PDF 3, 5].
- **Frontend Team (`/frontend`)**:
  - Relies on database query performance (< 200 ms query execution, keyset pagination, summary tables) to ensure client page loads remain strictly under 2.0 seconds [PDF 1, 11].

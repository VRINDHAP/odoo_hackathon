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

## 3.2 Hackathon Evaluation Criteria & Highest Priorities (Sooraj - Database Lead)
> **CRITICAL JUDGING NOTE**: Hackathon judges place the **highest evaluation weight** on database design, relational schema integrity, and setup excellence.

Judges score the database layer across these key pillars:
1. **Database Design & Schema Setup (Highest Weight)**:
   - Proper normalization (3NF) across 15 relational tables with explicit primary keys and foreign keys [PDF 5].
   - Exact numeric typing: `NUMERIC(14,2)` for financial fields, `NUMERIC(14,4)` for tax rates, zero floating-point arithmetic [PDF 5].
   - Hard database constraints: `UNIQUE(subscription_id, period_start, period_end)` anti-double-billing guard, `UNIQUE(product_id, attribute, value)`, `UNIQUE(discount_id, invoice_id)` [PDF 5.3, 5.8, 5.9].
   - 100% indexing on all foreign key columns [PDF 5].
   - Clean Alembic migration scripts supporting forward (`alembic upgrade head`) and rollback (`alembic downgrade -1`) [PDF 14, 15].
2. **Performance & Scalability**:
   - Partial index optimization: `CREATE INDEX idx_invoices_overdue_partial ON invoices (status, due_date) WHERE status='confirmed' AND balance>0` [PDF 5.11].
   - Composite indexes for batch scanning: `idx_subscriptions_status_billing_date` on `(status, next_billing_date)` [PDF 5.11].
   - PgBouncer transaction-mode connection pooling supporting 500 concurrent connections [PDF 11].
   - Benchmark proof: `EXPLAIN ANALYZE` scripts proving sub-10ms queries over 50,000 subscriptions and 500,000 invoices [PDF 11, 15].
3. **Real-Time & Dynamic Data Optimization**:
   - Summary tables (`daily_revenue_summary`, `subscription_snapshot_daily`) updated dynamically via stored procedures so dashboard aggregation reads hundreds of rows instead of scanning millions [PDF 11].
4. **Robustness & Disaster Recovery**:
   - Automated Docker Compose health checks and volume persistence [PDF 14].
   - Validated backup and restore script with zero data loss [PDF 15].
5. **Coding Standards & SQL Modularity**:
   - Clean, standardized SQL DDL scripts, lowercase naming, explicit constraints, and comprehensive migration versioning [PDF 5, 14].

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

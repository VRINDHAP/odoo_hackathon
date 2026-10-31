#!/bin/bash
set -euo pipefail

CONTAINER="database-postgres-1"
DB_USER="brightloop_user"
SOURCE_DB="brightloop_db"
RESTORE_DB="brightloop_restore_test"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
DUMP_FILE="$BACKUP_DIR/brightloop_$(date +%Y%m%d_%H%M%S).dump"

mkdir -p "$BACKUP_DIR"

echo "Checking restore database..."
EXISTS=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$RESTORE_DB'")

if [ "$EXISTS" = "1" ]; then
    echo "Error: $RESTORE_DB already exists. Remove it manually before retrying."
    exit 1
fi

get_counts() {
    docker exec "$CONTAINER" psql -X -qAt -U "$DB_USER" -d "$1" <<'SQL'
SELECT format(
    'SELECT %L || ''|'' || count(*) FROM %I.%I;',
    table_name, table_schema, table_name
)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec
SQL
}

echo "Recording original table counts..."
get_counts "$SOURCE_DB" | sort > /tmp/brightloop_before.txt

echo "Creating database backup..."
docker exec "$CONTAINER" pg_dump \
    -U "$DB_USER" -d "$SOURCE_DB" -Fc > "$DUMP_FILE"

echo "Creating temporary restore database..."
docker exec "$CONTAINER" createdb -U "$DB_USER" "$RESTORE_DB"

echo "Restoring backup..."
docker exec -i "$CONTAINER" pg_restore \
    -U "$DB_USER" -d "$RESTORE_DB" \
    --no-owner --no-privileges --exit-on-error < "$DUMP_FILE"

echo "Comparing table row counts..."
get_counts "$RESTORE_DB" | sort > /tmp/brightloop_after.txt

if diff -u /tmp/brightloop_before.txt /tmp/brightloop_after.txt; then
    echo "SUCCESS: All table row counts match."
    docker exec "$CONTAINER" dropdb -U "$DB_USER" "$RESTORE_DB"
    echo "Temporary database removed."
    echo "Backup saved at: $DUMP_FILE"
else
    echo "FAILED: Row counts differ. Restore database retained for inspection."
    exit 1
fi

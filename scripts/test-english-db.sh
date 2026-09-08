#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Tests use rollback transactions and only the dedicated English local container.
container="${ENGLISH_TEST_DB_CONTAINER:-supabase_db_english-learning-lab}"
if [[ "$container" != supabase_db_english-learning-lab* ]]; then
  printf '%s\n' 'Refusing a container outside the isolated English test stack.' >&2
  exit 1
fi
for test_file in supabase/tests/*.sql; do
  printf 'Running %s\n' "$test_file"
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < "$test_file"
done

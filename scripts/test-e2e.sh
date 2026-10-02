#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS rezeptdatenbank_e2e; CREATE DATABASE rezeptdatenbank_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON rezeptdatenbank_e2e.* TO '\''rezeptdatenbank'\''@'\''%'\'';"'
python3 - <<'PY'
from pathlib import Path
import os
lines=Path('.env').read_text().splitlines()
lines=[line.rsplit('/',1)[0]+'/rezeptdatenbank_e2e' if line.startswith('DATABASE_URL=') else 'APP_ORIGIN=http://rezeptdatenbank.test:8081' if line.startswith('APP_ORIGIN=') else line for line in lines]
Path('.env.e2e').write_text('\n'.join(lines)+'\n');os.chmod('.env.e2e',0o600)
PY
cleanup() { docker rm -f rezeptdatenbank-e2e >/dev/null 2>&1 || true; rm -f .env.e2e; }
trap cleanup EXIT
docker run -d --name rezeptdatenbank-e2e --network rezeptdatenbank_default --env-file .env.e2e -e PUBLIC_CATALOG_ENABLED=true -e COOKIDOO_ENABLED=true -e COOKIDOO_ALLOW_HTTP=false -p 127.0.0.1:8081:3000 rezeptdatenbank:0.8.0 >/dev/null
for attempt in $(seq 1 30); do if curl -fsS http://127.0.0.1:8081/api/v1/health/ready >/dev/null 2>&1; then break; fi; sleep 1; done
# Each workflow gets a fresh in-memory rate-limit budget, while its database
# remains available for later workflows. This also keeps screenshots per file.
if [ "$#" -eq 0 ]; then
 set -- tests/e2e/foundation.spec.ts
 for candidate in tests/e2e/*.spec.ts; do
  if [ "$candidate" != tests/e2e/foundation.spec.ts ]; then set -- "$@" "$candidate"; fi
 done
fi
for spec in "$@"; do
  npx playwright test "$spec" --output="test-results/$(basename "$spec" .spec.ts)"
  docker restart rezeptdatenbank-e2e >/dev/null
  for attempt in $(seq 1 30); do if curl -fsS http://127.0.0.1:8081/api/v1/health/ready >/dev/null 2>&1; then break; fi; sleep 1; done
done

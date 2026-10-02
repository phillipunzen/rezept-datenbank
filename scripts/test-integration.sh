#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Only the explicitly named disposable test database is reset.
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec -T mariadb sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS rezeptdatenbank_test; CREATE DATABASE rezeptdatenbank_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON rezeptdatenbank_test.* TO '\''rezeptdatenbank'\''@'\''%'\'';"'
python3 - <<'PY'
from pathlib import Path
import os
lines=Path('.env').read_text().splitlines()
lines=[line.rsplit('/',1)[0]+'/rezeptdatenbank_test' if line.startswith('DATABASE_URL=') else line for line in lines]
Path('.env.test').write_text('\n'.join(lines)+'\n');os.chmod('.env.test',0o600)
PY
trap 'rm -f .env.test' EXIT
docker run --rm --network rezeptdatenbank_default --env-file .env.test -v "$PWD:/app" -w /app node:22.22.2-bookworm-slim sh -c 'apt-get update -qq && apt-get install -y -qq openssl >/dev/null && node_modules/.bin/prisma migrate deploy && npm run test && npm run test:integration'
rm -f .env.test

# Entwicklung und Tests

Der normale Betrieb verwendet eine vorhandene MariaDB und startet mit `docker compose up -d --build` nur die App. Die folgende Datenbank ist ausdrücklich optional und ausschließlich für die Entwicklung gedacht.

## Separater Entwicklungs-Checkout

In einem eigenen Checkout `.env.development.example` nach `.env` kopieren, auf 0600 setzen und Datenbankpasswörter sowie Einrichtungscode ersetzen. Das Passwort in `DATABASE_URL` muss zum `MARIADB_PASSWORD` passen und URL-encodiert sein; Root-Passwort separat wählen. Einrichtungscode beispielsweise mit `openssl rand -hex 32` erzeugen. Bestehende Produktionskonfiguration nicht überschreiben.

```bash
cp .env.development.example .env
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Nur dieser ausdrückliche Start ergänzt einen separaten MariaDB-Service mit persistentem Datenvolume. Der Datenbankport wird nicht auf dem Host veröffentlicht. Der App-Container enthält auch dabei keinen Datenbankserver. Andere Projekte auf demselben Host benötigen eigene Compose-Projektnamen, Ports und Volumes.

## Prüfungen

Mit Node 22, npm und für Browserprüfungen Chromium:

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
./scripts/test-integration.sh
./scripts/test-e2e.sh
```

Die Docker-Testskripte erwarten das oben beschriebene Entwicklungsprofil und den standardmäßigen Compose-Projektnamen `rezeptdatenbank`. Sie verwenden ausschließlich die ausdrücklich benannten Datenbanken `rezeptdatenbank_test` und `rezeptdatenbank_e2e`. Jeder API-Workflow erhält isolierte Daten; Browserprüfungen laufen in einem temporären App-Container auf 127.0.0.1:8081. Das Offline-Szenario markiert nur seinen Testorigin als sicheren Browserkontext.

SQL-/Restore-Prüfungen verwenden ebenfalls ausschließlich isolierte Testdatenbanken und ein separates Uploadvolume. Einzelheiten stehen in [Backup/Restore](BACKUP.md) und [Prüfnachweise](VALIDATION.md). Zugangsdaten, Uploads, Screenshots und Testartefakte gehören nicht in Git.

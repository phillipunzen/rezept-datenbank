# Docker-Image und externe MariaDB

## Betrieb mit fertigem Image

Image: `ghcr.io/phillipunzen/rezept-datenbank:latest`, Plattform: **linux/amd64**. Die normale `docker-compose.yml` verwendet dieses Image ohne lokalen Build und enthält ausschließlich den Service `app` sowie das Uploadvolume. Die Verbindung zu deiner vorhandenen MariaDB kommt aus `DATABASE_URL`.

```dotenv
APP_IMAGE=ghcr.io/phillipunzen/rezept-datenbank:latest
DATABASE_URL=mysql://rezeptdatenbank:URL_ENCODED_PASSWORD@db.example.internal:3306/rezeptdatenbank
APP_ORIGIN=http://SERVER_IP:8080
APP_PORT=8080
INITIAL_SETUP_TOKEN=YOUR_RANDOM_SETUP_TOKEN_AT_LEAST_32_CHARACTERS
COOKIE_SECURE=false
TRUST_PROXY=false
```

Datenbank und Benutzer zuerst auf dem eigenen MariaDB-Server anlegen. Sonderzeichen in Benutzer/Passwort URL-encodieren. Für MariaDB direkt auf dem Docker-Host kann `host.docker.internal` verwendet werden; deren Listener und Firewall müssen Verbindungen aus Docker erlauben. Vollständige Anleitung: [README](../README.md#installation).

```bash
docker compose pull app
docker compose up -d
docker compose ps
```

Die App enthält keinen MariaDB-Server. Migrationen werden beim Start gegen die externe Datenbank angewendet. Uploads bleiben im separaten persistenten Volume. Eine geänderte DATABASE_URL kopiert keine bestehenden Daten.

## Automatische Veröffentlichung

[GitHub Actions: Docker image](https://github.com/phillipunzen/rezept-datenbank/actions/workflows/docker-image.yml) baut das Image bei relevanten Änderungen auf `main`, Git-Tags `v*` oder manuell über **Run workflow**. Pull Requests bauen und prüfen das Image, veröffentlichen es aber nicht.

Vor dem Upload startet der Workflow das gebaute Image gegen eine separat laufende, ausschließlich temporäre CI-MariaDB. Migrationen, Readiness, Weboberfläche, OIDC-Aktivierung über Environment und die Abwesenheit eines Datenbankservers im App-Image werden geprüft. Der OIDC-Konfigurationstest verwendet ausschließlich Testwerte; es werden keine echten Provider-Zugangsdaten im Image gespeichert. Die Testdatenbank gehört nicht zur Installations-Compose-Datei.

OIDC funktioniert im gleichen Image; eine eigene Authentik-Variante ist nicht erforderlich. `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_LABEL` und `OIDC_REGISTRATION_ENABLED` werden zur Laufzeit über `.env` gesetzt. [Authentik einrichten](OIDC_AUTHENTIK.md).

Der Workflow verwendet den automatisch von GitHub bereitgestellten `GITHUB_TOKEN` mit `packages: write`; zusätzliche Registry-Secrets sind für diesen Build nicht nötig. Action-Versionen sind auf Commit-SHAs festgelegt. Das Image wird mit Repository-/Versionsmetadaten verknüpft. [GitHub: Docker-Images veröffentlichen](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

Tags:

- `latest`: letzter erfolgreicher Build von `main`.
- `sha-<vollständige Commit-SHA>`: Build eines konkreten Git-Stands.
- `0.8.0` beispielsweise: entsteht, wenn ein Git-Tag `v0.8.0` gebaut wird. Solche Versions-Tags existieren erst nach diesem Release-Build.

Für einen reproduzierbaren Betrieb `APP_IMAGE` auf den Digest aus der Actions-Zusammenfassung setzen, zum Beispiel `ghcr.io/phillipunzen/rezept-datenbank@sha256:…`.

## Image-Zugriff

Das Package dieses Repositories ist öffentlich: `docker compose pull app` funktioniert ohne GitHub-Anmeldung (am 09.10.2026 geprüft).

GitHub legt ein neues Container-Package zunächst **privat** an. Für anonymes `docker compose pull` stellt der Repository-Eigentümer nach der ersten Veröffentlichung unter **Packages → rezept-datenbank → Package settings → Change visibility** das Package auf **Public**. Ein öffentliches Repository allein macht das Package nicht öffentlich. [GitHub: Registry-Zugriff und Sichtbarkeit](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Für ein privates Package stattdessen am Zielserver anmelden:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

Als Passwort einen GitHub Personal Access Token **classic** mit `read:packages` und Zugriff auf das Package verwenden. Token nur am Login-Prompt eingeben, nicht in `.env`, Git oder Compose speichern. Danach `docker compose pull app` ausführen.

## Lokaler Build

Mit vollständigem Quellcode-Checkout:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Dieser Override verwendet das lokale Image `rezeptdatenbank:0.8.0` und weiterhin eine eigene MariaDB. `docker-compose.dev.yml` ist ausschließlich der separate Entwicklungs-/Testbetrieb mit optionaler Testdatenbank; siehe [DEVELOPMENT.md](DEVELOPMENT.md).

# Rezeptdatenbank

Eine selbst gehostete Rezeptverwaltung für Haushalte: Rezepte sammeln, importieren, planen und gemeinsam kochen. Die Oberfläche unterstützt Deutsch und Englisch sowie System-, Hell- und Dunkelmodus.

Das fertige Docker-Image wird unter **`ghcr.io/phillipunzen/rezept-datenbank:latest`** bereitgestellt (Linux/amd64).

Die App benötigt eine **eigene MariaDB**. Der normale Docker-Compose-Start betreibt ausschließlich den App-Container. Die Datenbankverbindung wird über `DATABASE_URL` konfiguriert; im App-Image läuft kein MariaDB-Server. Bilder und Importdateien liegen in einem eigenen persistenten Uploadvolume.

## Funktionen

- Rezepte mit Zutaten, Gruppen, skalierten Mengen, geordneten Schritten, Bildern, Tags, Kategorien, Nährwerten und Allergenen. Favoriten, Bewertungen, Suche, Druck, Duplizieren, Versionshistorie und Papierkorb.
- Website-Link-Import aus JSON-LD/Microdata mit Bild und bearbeitbarer Vorschau. JSON-Import/Export sowie Tandoor-Default-ZIP mit Vorschau, Hintergrundimport und Ergebnisbericht.
- Haushalte mit Rollen, Einladungen und gezielten Freigaben für private Rezepte. Gemeinsame Rezeptbücher, Tages-/Wochenplanung und Einkaufslisten mit Mengenaggregation und Konfliktprüfung.
- Kochmodus mit großen Schritten, Timern, Vollbild und Wake Lock. Persönliche Kochhistorie, bestätigte TM6-Parameter und eigener Geräteexport; keine direkte Gerätesteuerung.
- Öffentlicher Rezeptkatalog ohne Anmeldung unter `/entdecken` und widerrufbare Rezeptlinks mit QR-Code und Recipe-JSON-LD.
- Optionaler SMTP-Passwortreset, OIDC-Anmeldung, Profilbild, Kontensperren und Aktivitätenprotokoll.
- Verschlüsselte Offline-Küche für ausgewählte Rezepte, Wochenplan und Einkaufslisten. Offline-Funktionen und Wake Lock benötigen HTTPS oder localhost.
- Optionaler experimenteller Cookidoo-Einkaufslistenabgleich mit ausdrücklicher Aktivierung und Konfliktentscheidungen. Er verwendet eine inoffizielle Schnittstelle; ein Test mit einem echten Cookidoo-Konto steht noch aus. [Details](docs/COOKIDOO_SYNC.md).

## Öffentliche Rezepte

Rezept-Ersteller können unter **Öffentlich sichtbar → Öffentlich veröffentlichen** einzelne Rezepte freigeben. Besucher finden sie ohne Anmeldung unter `/entdecken` und sehen Zutaten, Schritte und Bilder. Spätere Rezeptänderungen sind ebenfalls öffentlich sichtbar.

Quellenname, Quell-URL, Nährwertquelle, persönliche Notizen und Kontodaten bleiben aus öffentlichen Ansichten und API-Antworten ausgeschlossen. Intern gespeicherte Quellen bleiben erhalten. Selbst geschriebene Rezepttexte werden nicht automatisch redigiert.

Neue und bestehende Rezepte sind zunächst unveröffentlicht. Widerruf, Papierkorb, Sichtbarkeitswechsel oder Haushaltsaustritt nehmen eine Veröffentlichung zurück. Wiederherstellen veröffentlicht nicht erneut. Katalog und unaufgelistete Linkfreigaben werden unabhängig verwaltet. Mit `PUBLIC_CATALOG_ENABLED=false` lässt sich der gesamte Katalog abschalten.

## API und Entwicklung

- API-Dokumentation: `/api/v1/docs`, OpenAPI: `/api/v1/docs/json`.
- Liveness: `/api/v1/health/live`, Datenbank-Readiness: `/api/v1/health/ready`.
- Versions-/Installationsstatus: `/api/v1/system`.

Schreibende Anfragen benötigen `Origin: <APP_ORIGIN>` und eine passende Session; veraltete Änderungen liefern HTTP 409. Das Backend ist nur innerhalb des App-Containers erreichbar. Node und Python für den optionalen Cookidoo-Adapter sind im Docker-Image enthalten.

Hinweise zum lokalen Entwickeln und zur ausdrücklich optionalen Testdatenbank: [Entwicklung](docs/DEVELOPMENT.md). Für die normale Installation ist diese Entwicklungsdatenbank nicht erforderlich.

[Architektur](docs/ARCHITECTURE.md) · [Datenmodell](docs/DATABASE.md) · [Tandoor](docs/TANDOOR_IMPORT.md) · [Thermomix](docs/THERMOMIX.md) · [Cookidoo](docs/COOKIDOO_SYNC.md) · [Sicherheit](docs/SECURITY.md) · [Backup/Restore](docs/BACKUP.md) · [Prüfnachweise](docs/VALIDATION.md)

## Installation

### 1. Voraussetzungen

- Ein Server mit Docker Engine und dem Docker-Compose-Plugin (`docker compose`).
- `curl` zum Herunterladen der Compose-Datei und Konfiguration; alternativ Git zum Klonen des Repositories.
- Linux/amd64 für das vorgefertigte Image.
- Eine vorhandene MariaDB, die vom App-Container aus erreichbar ist. Mit MariaDB 11.8 getestet.
- Eine eigene Datenbank und ein Benutzer mit Rechten auf diese Datenbank. Beim Start führt die App automatisch versionierte Migrationen aus; dafür benötigt der Benutzer auch Rechte zum Anlegen und Ändern der Tabellen.
- Optional ein eigener Reverseproxy für HTTPS.

Die App kann auf einem anderen Server als die Datenbank laufen. Die Datenbank darf auch direkt auf dem Docker-Host installiert sein. Ein MariaDB-Container ist für die Installation nicht nötig.

### 2. Datenbank vorbereiten

Auf deinem MariaDB-Server mit einem administrativen DB-Konto ausführen; Passwort durch einen eigenen Wert ersetzen:

```sql
CREATE DATABASE rezeptdatenbank
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'rezeptdatenbank'@'%' IDENTIFIED BY 'CHANGE_ME_TO_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON rezeptdatenbank.* TO 'rezeptdatenbank'@'%';
```

Der Benutzer erhält Rechte auf die App-Datenbank, keine globalen Administrationsrechte. Du kannst `%` durch den passenden zugelassenen Quellhost ersetzen. MariaDB muss Verbindungen aus dem App-Netz zulassen; Listener, Benutzer-Hostregel und Firewall entsprechend konfigurieren. [MariaDB: CREATE USER](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/create-user).

### 3. Compose-Datei und Konfiguration herunterladen

```bash
mkdir rezept-datenbank
cd rezept-datenbank
curl -fL https://raw.githubusercontent.com/phillipunzen/rezept-datenbank/main/docker-compose.yml -o docker-compose.yml
curl -fL https://raw.githubusercontent.com/phillipunzen/rezept-datenbank/main/.env.example -o .env
chmod 600 .env
```

Der Installationspfad ist frei wählbar. Erzeuge anschließend einen Einrichtungscode, beispielsweise mit:

```bash
openssl rand -hex 32
```

### 4. Environment konfigurieren

Öffne `.env`, ersetze die Platzhalter und trage den erzeugten Einrichtungscode ein:

```dotenv
APP_IMAGE=ghcr.io/phillipunzen/rezept-datenbank:latest
DATABASE_URL=mysql://rezeptdatenbank:URL_ENCODED_PASSWORD@db.example.internal:3306/rezeptdatenbank
APP_ORIGIN=http://localhost:8080
APP_PORT=8080
APP_BIND_ADDRESS=0.0.0.0
INITIAL_SETUP_TOKEN=PASTE_YOUR_GENERATED_SETUP_TOKEN_HERE
COOKIE_SECURE=false
TRUST_PROXY=false
REGISTRATION_ENABLED=false
PUBLIC_CATALOG_ENABLED=true
```

`DATABASE_URL` verwendet auch für MariaDB das Schema `mysql://`. Benutzername und Passwort müssen URL-encodiert sein: beispielsweise `@` als `%40`, `#` als `%23` und `$` als `%24`. Bei entfernten Datenbanken trägst du deren tatsächlichen DNS-Namen oder IP-Adresse ein; für DB-TLS siehe die [Prisma-Verbindungsparameter](https://www.prisma.io/docs/orm/v6/overview/databases/mysql#connection-details).

**MariaDB direkt auf demselben Server:** Verwende in `DATABASE_URL` den Hostnamen `host.docker.internal`, zum Beispiel:

```dotenv
DATABASE_URL=mysql://rezeptdatenbank:URL_ENCODED_PASSWORD@host.docker.internal:3306/rezeptdatenbank
```

Die Compose-Datei stellt die Hostzuordnung bereit. `localhost` innerhalb des Containers bezeichnet den App-Container. Eine MariaDB, die auf dem Host ausschließlich an `127.0.0.1` lauscht, ist dadurch noch nicht erreichbar; sie muss auch auf der passenden, aus Docker erreichbaren Hostadresse lauschen. Bei Docker Desktop steht `host.docker.internal` ebenfalls für den Host. [Docker: Hostzuordnung](https://docs.docker.com/reference/cli/docker/container/run/#add-host).

`APP_ORIGIN` muss exakt der Adresse entsprechen, unter der du die App im Browser öffnest. Für einen Server mit IP und Port beispielsweise `http://SERVER_IP:8080`; `localhost` passt nur beim Zugriff auf dem eigenen Rechner. Für HTTPS die Einstellungen im nächsten Abschnitt verwenden.

`APP_PORT` bestimmt den Port auf dem Docker-Host. `APP_BIND_ADDRESS=127.0.0.1` beschränkt den Zugriff auf den Host, etwa für einen dort laufenden Reverseproxy; `0.0.0.0` erlaubt Verbindungen über dessen Netzwerkschnittstellen.

### 5. App starten

```bash
docker compose pull app
docker compose up -d
docker compose ps
```

Dieser Befehl startet **nur den Service `app`**. Es gibt in der normalen Compose-Datei keinen Datenbank-Service, kein Datenbankvolume und keine Abhängigkeit von einem MariaDB-Container. Du kannst die Services vorab prüfen:

```bash
docker compose config --services
# Ausgabe: app
```

`docker compose pull` lädt das fertige Image; Node, Python und ein lokaler Quellcode-Build werden für die Installation nicht benötigt. Beim App-Start werden Migrationen gegen deine konfigurierte MariaDB ausgeführt. Bei einer nicht erreichbaren Datenbank startet die App nicht erfolgreich; es wird keine Ersatzdatenbank angelegt.

Status und Startfehler prüfen:

```bash
docker compose logs --tail=100 app
curl -f http://localhost:8080/api/v1/health/ready
```

Adresse und Port gegebenenfalls anpassen. Eine erfolgreiche Readiness-Antwort enthält `"database":"connected"`.

Wenn GHCR beim Download `denied` meldet, siehe [Image-Zugriff und Veröffentlichung](docs/DOCKER_IMAGE.md). Für ein öffentliches Package ist keine Anmeldung erforderlich; ein privates Package benötigt eine GitHub-Anmeldung am Registry.

### 6. Erstes Konto einrichten

Öffne `APP_ORIGIN` im Browser. Bei einer leeren Datenbank erscheint die Ersteinrichtung. Trage den Einrichtungscode aus `.env` ein und lege dein Administratorkonto sowie den ersten Haushalt an.

Die Einrichtung ist einmalig. Eine bestehende Installation verwendet ihre bisherigen Konten und Daten weiter. Öffentliche Registrierung bleibt standardmäßig deaktiviert; weitere Personen können über Haushaltseinladungen hinzukommen.

### 7. HTTPS und optionale Dienste

Für einen eigenen Reverseproxy `.env` anpassen:

```dotenv
APP_ORIGIN=https://rezepte.example.de
COOKIE_SECURE=true
TRUST_PROXY=true
COOKIDOO_ALLOW_HTTP=false
```

Danach den App-Container neu erstellen:

```bash
docker compose up -d --no-build --force-recreate app
```

Der Reverseproxy leitet an den App-Port weiter und übergibt Host, `X-Forwarded-Proto` und `X-Forwarded-For`. Für Tandoor-Archive sollte er Uploads bis 65 MiB erlauben. API, angemeldete Seiten und widerrufbare Rezeptansichten nicht zwischenspeichern. `TRUST_PROXY=true` setzt eine kontrollierte Proxy-Anbindung voraus.

Weitere Einstellungen stehen in `.env.example`:

| Funktion | Environment |
| --- | --- |
| Öffentlicher Katalog | `PUBLIC_CATALOG_ENABLED` |
| Öffentliche Registrierung | `REGISTRATION_ENABLED` |
| Passwortreset per E-Mail | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| OIDC-Anmeldung | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, optional `OIDC_CLIENT_SECRET`, `OIDC_LABEL`, `OIDC_REGISTRATION_ENABLED` |
| Cookidoo-Einkaufslisten | `COOKIDOO_ENABLED`, `COOKIDOO_ALLOW_HTTP`, optional `COOKIDOO_ENCRYPTION_KEY` |

Authentik Schritt für Schritt einrichten: [OIDC mit Authentik](docs/OIDC_AUTHENTIK.md). Der Anmeldebutton erscheint automatisch, sobald `OIDC_ISSUER` und `OIDC_CLIENT_ID` gesetzt sind. Bestehende Konten können unter Einstellungen → „Anmeldekonto verknüpfen“ verbunden werden.

Ohne SMTP-Konfiguration ist der E-Mail-Passwortreset deaktiviert. Einladungen werden als Links weitergegeben. OIDC benötigt einen HTTPS-Issuer; die Callback-Adresse ist `APP_ORIGIN/api/v1/auth/oidc/callback`.

Cookidoo ist optional und experimentell. Das Passwort wird nicht gespeichert. Ohne expliziten Verschlüsselungsschlüssel erzeugt die App eine private Schlüsseldatei im Uploadvolume; diese muss mitgesichert werden. HTTP-Anmeldung lässt sich für Entwicklung ausdrücklich mit `COOKIDOO_ALLOW_HTTP=true` freigeben, für HTTPS bleibt der Wert `false`. Eigene Rezeptlinks und Geräteexporte sind keine nachgewiesenen Cookidoo-Rezeptimportformate.

### 8. Aktualisieren, sichern oder Datenbank wechseln

Vor einem Update Datenbank, vollständiges Uploadvolume, private Konfiguration und bisherigen Image-/Versionsstand sichern. Die Uploads enthalten Bilder, Importarchive und gegebenenfalls den Cookidoo-Schlüssel. [Backup und Restore](docs/BACKUP.md).

```bash
docker compose pull app
docker compose up -d
```

Bei einem Wechsel der MariaDB zuerst App-Schreibzugriffe stoppen, die Datenbank sichern und den Dump in die neue dedizierte Datenbank einspielen. Uploads und Verschlüsselungsschlüssel erhalten. Danach `DATABASE_URL` ändern und den App-Container neu erstellen. Eine andere URL kopiert keine vorhandenen Daten.

Für einen festen Versionsstand lässt sich `APP_IMAGE` auf einen veröffentlichten `sha-…`-Tag oder einen Image-Digest (`ghcr.io/phillipunzen/rezept-datenbank@sha256:…`) setzen. `latest` folgt dem letzten erfolgreich geprüften Build von `main`. Versions-Tags entstehen bei Git-Tags wie `v0.8.0`. [Image-Build und Tags](docs/DOCKER_IMAGE.md).

Das persistente Volume `rezeptdatenbank_uploads` bleibt bei einem normalen Containerwechsel erhalten. `docker compose down -v` entfernt dieses Volume und damit die Uploads.

### Optional: Image selbst bauen

Für einen eigenen Build das vollständige Repository klonen, `.env` konfigurieren und den Build-Override verwenden:

```bash
git clone https://github.com/phillipunzen/rezept-datenbank.git
cd rezept-datenbank
cp .env.example .env
# DATABASE_URL, APP_ORIGIN und INITIAL_SETUP_TOKEN anpassen.
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Auch dieser Start benötigt eine eigene MariaDB und ergänzt keinen Datenbank-Service. Die ausdrücklich optionale Entwicklungsdatenbank steht separat in [DEVELOPMENT.md](docs/DEVELOPMENT.md).

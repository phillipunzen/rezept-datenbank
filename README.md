# Rezeptbuch

Selbst gehostete Rezept-App für Einzelpersonen und Haushalte: Rezepte sammeln und importieren, Wochenplan, gemeinsame Einkaufslisten (mit Home-Assistant-Abgleich), Kochmodus mit Thermomix-Angaben, Vorratsschrank, öffentliche Rezepte – als installierbare PWA für Smartphone, Tablet und Desktop, auf Deutsch und Englisch, hell/dunkel/System.

## Start mit Docker

Voraussetzung: eine erreichbare **MariaDB** (im App-Container läuft keine Datenbank).

```sql
CREATE DATABASE rezeptbuch CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'rezeptbuch'@'%' IDENTIFIED BY 'ein-sicheres-passwort';
GRANT ALL ON rezeptbuch.* TO 'rezeptbuch'@'%';
```

```bash
cp .env.example .env    # APP_URL, APP_SECRET und DB_* ausfüllen
docker compose up -d
```

`docker-compose.yml` lädt das fertige Image `ghcr.io/phillipunzen/rezept-datenbank:latest`, das GitHub Actions bei jedem Push auf `main` baut, gegen eine MariaDB testet und veröffentlicht (zusätzlich `sha-…`- und bei Tags `vX.Y.Z`-Tags; eine feste Version über `APP_IMAGE` in `.env` wählen). Selbst bauen: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

Die App läuft dann auf Port `HOST_PORT` (Standard 3000). Tabellen werden beim Start automatisch angelegt/aktualisiert. Hochgeladene Bilder liegen in `./data`. Das erste registrierte Konto (oder `ADMIN_EMAIL`/`ADMIN_PASSWORD`) wird Administrator.

Für HTTPS einen Reverse Proxy (Traefik, Caddy, nginx …) davorsetzen – Service Worker, Kamera, „Bildschirm anlassen“ und Installation als App funktionieren nur über HTTPS. Bei nginx für `/api/events` das Buffering abschalten (Server-Sent Events für Echtzeit-Aktualisierungen).

## Anmeldung über Authentik

In Authentik einen OAuth2/OpenID-Provider anlegen, Redirect-URI `https://<APP_URL>/api/auth/oidc/callback`, dann `OIDC_ISSUER` (z. B. `https://auth.example.org/application/o/rezeptbuch/`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` setzen. Unter *Administration → Anmeldung* steuerst du, ob neue Konten lokal und/oder über Authentik entstehen dürfen. Optional macht `OIDC_ADMIN_GROUP` Mitglieder einer Authentik-Gruppe zu Administratoren.

## Integrationen – was geht und was nicht

| Wunsch | Umsetzung |
|---|---|
| Zentrale Claude-Verbindung für alle | Admin hinterlegt unter *Administration → KI-Verbindung* einen API-Schlüssel aus der [Claude Console](https://console.anthropic.com). Er wird verschlüsselt gespeichert; Benutzer sehen ihn nie. |
| …per OAuth mit vorhandenem Claude-Abo | **Nicht möglich:** Anthropic erlaubt die OAuth-Anmeldung mit Pro/Max-Abos nur in eigenen Anwendungen (Claude.ai, Claude Code), nicht in Drittanwendungen. Daher API-Schlüssel – nutzungsbasiert abgerechnet. |
| Keine automatischen Zusatzkosten | KI-Anfragen nur auf ausdrücklichen Klick („Rezept erkennen“, „Mit KI auslesen“), keine Wiederholungen, keine Hintergrundanfragen. Monats- und Tageslimits einstellbar; Schlüsselprüfung nutzt die kostenlose Models-API. Ist das Limit oder Guthaben erschöpft, erscheint eine verständliche Meldung. |
| Home Assistant | *Administration → Home Assistant*: URL + langlebiges Token. In jeder Einkaufsliste lassen sich `todo.*`-Listen verknüpfen. Abgleich in beide Richtungen (sofort nach lokalen Änderungen, sonst alle 30 s): Neues hier → HA; in HA abgehakt/entfernt/neu → hier. |
| Cookidoo-Einkaufsliste | Vorwerk hat keine offizielle API. Über die **Cookidoo-Integration von Home Assistant** erscheint die Cookidoo-Liste als `todo.cookidoo_…` und kann wie oben verknüpft werden. |
| Rezepte auf den Thermomix „schieben“ | **Nicht möglich** ohne offizielle Schnittstelle. Thermomix-Schritte (Zeit, Temperatur, Stufe, Linkslauf, Modus) lassen sich unter „Für Thermomix vorbereiten“ pflegen und werden im Kochmodus groß angezeigt, inkl. Timer. |
| Tandoor | Import über Tandoor-API (Adresse + API-Token, wird nicht gespeichert) mit Vorschau, Duplikaterkennung, Fortschritt und Bericht; zusätzlich Tandoor-Export-ZIPs. |

## Entwicklung

```bash
cd server && npm install && npm run dev     # API auf PORT (Standard 3000), DB_* per Umgebung
cd web && npm install && npm run dev        # Vite auf 5190, leitet /api auf localhost:3990 weiter (vite.config.js anpassen)
```

Aufbau: `server/` – Node 20, Express, Knex/mysql2, Migrationen in `server/src/db/migrations.js`. `web/` – React 18 + Vite, PWA via `vite-plugin-pwa`, Offline-Cache/Warteschlange in `web/src/lib/api.js`, Übersetzungen in `web/src/lib/en.js` (deutscher Text = Schlüssel).

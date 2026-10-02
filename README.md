# Rezeptdatenbank

Version **0.8.0** · Selbst gehostete Rezept-App unter `/opt/rezeptdatenbank` auf SRV-DEV01. Entwicklungsinstanz: **http://192.168.10.70:8080**. Die normale Compose-Datei betreibt nur die App; eine externe MariaDB wird über Environment konfiguriert. Das optionale Entwicklungsprofil ergänzt einen separaten MariaDB-Container mit persistentem Volume.

## Funktionen

- Studio-Oberfläche in Deutsch/Englisch; System-, Hell- und Dunkelmodus, Smartphone-Navigation und vollständige Rezeptansichten.
- Strukturierte Zutaten und Gruppen, skalierte Mengen, sortierbare Schritte mit Zutatenbezug, bis zu acht Bilder, Tags, Kategorien, Favoriten, Bewertungen, Nährwerte und Allergene. Suche, Zutaten-/Bewertungs-/Gerätefilter, Druck, Duplizieren, Versionshistorie mit Wiederherstellung und Papierkorb.
- Website-Link-Import aus JSON-LD/Microdata mit Rezeptbild und bearbeitbarer Vorschau. JSON-Austausch einschließlich Bildern und bestätigten Geräteparametern. Tandoor-Default-ZIP mit Vorschau, Hintergrundaufträgen, Pause/Abbruch/Wiederaufnahme und Bericht pro Rezept.
- Haushalte, Rollen und Einladungen; private Rezepte mit gezielten Lese-/Bearbeitungsfreigaben. Auch Administratoren umgehen diese Rechte nicht. Mehrere gemeinsame Rezeptbücher je Rezept.
- Tages-/Wochenplan, vier Mahlzeiten und Portionen; gemeinsame Einkaufslisten manuell, aus Rezepten oder dem Plan. Exakte Mengenaggregation, Bearbeiten, Löschen, Häkchen und Konfliktprüfung. Persönliche Kochhistorie und Dashboard mit Tagesplan/Favoriten/Zufallsrezept.
- Kochansicht mit großen Schritten, Zutaten und mehreren Timern, echtem Browser-Vollbild und Wake Lock mit Fallback. Bestätigter TM6-Parametereditor, eigener Geräteexport und Thermomix-Kochansicht. Keine direkte Gerätesteuerung.
- Öffentlicher durchsuchbarer Rezeptkatalog ohne Anmeldung unter `/entdecken`, mit bewusster Freigabe je Rezept und widerrufbarer Veröffentlichung. Quellenangaben bleiben intern; öffentliche Ansichten/JSON enthalten keine Quellen, persönlichen Notizen oder Kontodaten.
- Widerrufbare öffentliche Rezeptlinks mit Ablauf und QR-Code; serverseitiges Recipe-JSON-LD. Keine Quellenangaben oder persönlichen Notizen/Bewertungen in öffentlichen Ansichten.
- Optionaler SMTP-Passwortreset, OIDC mit PKCE und expliziter Kontoverknüpfung, Profilbild, Kontensperren und Aktivitäten/Audit.
- Verschlüsselte Offline-Küche mit eigener Passphrase: bis zu 30 ausgewählte Rezepte samt Bildern, aktueller Wochenplan, Einkaufslisten und konfliktbewusster Synchronisierung von Häkchen. Suche und bevorzugte Favoritenauswahl. **Browser-Offline-Nutzung erfordert HTTPS oder localhost.**
- Optionaler **experimenteller Cookidoo-Einkaufslistenabgleich**: persönliche Verbindung zu einer gemeinsamen Liste, lesende Vorschau, ausdrückliche Aktivierung, regelmäßiger beidseitiger Abgleich, Pause und Konfliktentscheidungen. Freie Einträge unterstützen Erstellen/Ändern/Abhaken/Löschen; Rezeptzutaten nur Abhaken. Inoffizielle Schnittstelle; noch kein Test mit einem echten Benutzerkonto. Details: [Cookidoo](docs/COOKIDOO_SYNC.md).

## Betrieb über Environment

```dotenv
DATABASE_URL=mysql://appuser:URL_ENCODED_PASSWORD@db.example.internal:3306/rezeptdatenbank
APP_ORIGIN=http://192.168.10.70:8080
APP_PORT=8080
APP_BIND_ADDRESS=0.0.0.0
COOKIE_SECURE=false
TRUST_PROXY=false
INITIAL_SETUP_TOKEN=YOUR_RANDOM_64_HEX_CHARACTERS
REGISTRATION_ENABLED=false
PUBLIC_CATALOG_ENABLED=true
COOKIDOO_ENABLED=true
COOKIDOO_ALLOW_HTTP=false
```

Dedizierte DB und Benutzer vorher anlegen. Zugangsdaten in der URL encodieren; für DB-TLS Prisma-Verbindungsparameter und CA-Mount verwenden. Die App führt beim Start versionierte Migrationen aus. Keine Datenbank und kein SQLite-Ersatz innerhalb der App. Bei einer neuen Installation `.env.example` kopieren, `.env` auf 0600 setzen und den Einrichtungscode mit `openssl rand -hex 32` erzeugen. Vorhandene Installation weiterverwenden; kein erneuter Bootstrap. Private Zugangsinformationen stehen in `access.txt` (0600).

```bash
cd /opt/rezeptdatenbank
docker compose up -d --build
```

Aktuelles Entwicklungsprofil:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Nur die App veröffentlicht einen Port. Projekt und Volumes heißen `rezeptdatenbank`, `rezeptdatenbank_uploads` und im Entwicklungsprofil `rezeptdatenbank_mariadb_data`. Weitere Projekte bleiben unabhängig. Uploadvolume enthält Rezept-/Profilbilder, Importarchive und gegebenenfalls den separaten Cookidoo-Verschlüsselungsschlüssel.

### Eigener Reverseproxy

Der Benutzer betreibt den Reverseproxy selbst. Kein eingebauter TLS-Server oder festgelegter Domainname nötig. Nach dessen Einrichtung ändern:

```dotenv
APP_ORIGIN=https://rezepte.example.de
COOKIE_SECURE=true
TRUST_PROXY=true
COOKIDOO_ALLOW_HTTP=false
```

Danach den App-Container neu erstellen. Proxy leitet Host, X-Forwarded-Proto und X-Forwarded-For weiter und erlaubt Archivuploads bis 65 MiB. `APP_ORIGIN` muss der Browseradresse exakt entsprechen, einschließlich Schema und gegebenenfalls Port. API und angemeldete Seiten nicht cachen. `TRUST_PROXY=true` nur bei kontrollierter vorgeschalteter Infrastruktur verwenden; App-Bindadresse passend zur Proxy-Anbindung wählen. Offline/Wake Lock werden erst im sicheren Browserkontext verfügbar; Environment kann diese Browserbedingung nicht ersetzen.

Cookidoo-Anmeldung über Entwicklungs-HTTP kann ausdrücklich mit `COOKIDOO_ALLOW_HTTP=true` zugelassen werden. Das Formular zeigt die unverschlüsselte Strecke Browser–App und verlangt eine zusätzliche Bestätigung. Der App–Cookidoo-Verkehr erfolgt weiterhin über HTTPS. Für Betrieb hinter HTTPS den Entwicklungswert wieder deaktivieren.

### Externe Datenbank später umstellen

1. App-Schreibzugriffe stoppen und DB, vollständiges Uploadvolume sowie private Konfiguration sichern.
2. Dump in eine dedizierte externe MariaDB einspielen. Uploadvolume und Cookidoo-Schlüssel erhalten.
3. Nur `DATABASE_URL` und erforderliche DB-TLS-Mounts ändern, dann die normale Compose-Datei verwenden.
4. `docker compose up -d --no-build --force-recreate app`; Readiness, Anmeldung und Rezepte prüfen.
5. Erst nach erfolgreicher Prüfung den Entwicklungs-DB-Service stoppen; Datenvolume für Rückfall behalten.

Eine geänderte URL kopiert keine Daten. `down -v` löscht persistente Daten. Anleitung und erprobter Restore: [Backup](docs/BACKUP.md).

### Optionale Dienste

SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Ohne SMTP_HOST ist E-Mail-Reset deaktiviert. Einladungen werden als Links weitergegeben; kein automatischer Einladungsmailversand.

OIDC: `OIDC_ISSUER` (HTTPS), `OIDC_CLIENT_ID`, optional `OIDC_CLIENT_SECRET`, `OIDC_LABEL`, `OIDC_REGISTRATION_ENABLED`. Callback: `APP_ORIGIN/api/v1/auth/oidc/callback`. Gleiche E-Mail verknüpft bestehende Konten nicht automatisch; angemeldet explizit verbinden. SMTP/OIDC sind auf der Entwicklungsinstanz noch nicht konfiguriert.

Cookidoo: `COOKIDOO_ENABLED`, `COOKIDOO_ALLOW_HTTP`, optional `COOKIDOO_ENCRYPTION_KEY` (64 Hexzeichen). Ohne expliziten Schlüssel wird einmalig eine private Schlüsseldatei im Uploadvolume erzeugt. Anmeldung erfolgt im Einkaufslistenformular; Passwort wird nicht gespeichert. Eigene öffentliche Rezeptlinks und Geräte-JSON sind **keine nachgewiesenen Cookidoo-Rezeptimportformate**.

## Öffentliche Rezepte

`/entdecken` kann ohne Login geöffnet werden; auf der Anmeldeseite führt „Rezepte entdecken“ dorthin. Der Rezept-Ersteller öffnet ein Rezept und wählt unter **Öffentlich sichtbar → Öffentlich veröffentlichen** die bewusste Freigabe. Zutaten, Schritte und Bilder sowie spätere Rezeptänderungen sind öffentlich sichtbar. Quellenname, Quell-URL und Nährwertquelle bleiben intern gespeichert und fehlen auch in öffentlichen API-/JSON-LD-Antworten. Angaben im selbst geschriebenen Rezepttext werden nicht automatisch entfernt.

Bestehende und neue Rezepte sind zunächst unveröffentlicht. **Veröffentlichung zurücknehmen** entfernt das Rezept aus dem Katalog und sperrt öffentliche Bildabrufe. Papierkorb, Sichtbarkeitswechsel oder Haushaltsaustritt nehmen die Veröffentlichung ebenfalls zurück; Wiederherstellen veröffentlicht nicht erneut. Unaufgelistete Linkfreigabe und Katalogveröffentlichung sind unabhängig. Mit `PUBLIC_CATALOG_ENABLED=false` und Neuerstellen des Containers wird der gesamte Katalog abgeschaltet; bestehende Linkfreigaben bleiben separat verwaltbar. Compose aktiviert den Katalog standardmäßig, direkter Backend-Start nur mit expliziter Variable. Der aktuelle LAN-Zugang ist von erreichbaren Geräten nutzbar; Internetzugriff hängt vom eigenen Reverseproxy ab.

## API und Entwicklung

Swagger: `/api/v1/docs`, OpenAPI: `/api/v1/docs/json`. Health: `/api/v1/health/live`, `/api/v1/health/ready`; Version/Installationsstatus: `/api/v1/system`. Schreibende Requests brauchen `Origin: <APP_ORIGIN>`, JSON bzw. die dokumentierten Multipart-Endpunkte; HttpOnly-Session authentifiziert den Benutzer. Bei Paralleländerungen HTTP 409. Backend nur intern auf 127.0.0.1:3001, Next auf Containerport 3000.

Node **22**, Docker/Compose; Python **3.13** mit gepinntem `cookidoo-api==0.18.4` ist für den optionalen Adapter bereits im App-Image. Keine zusätzliche SSH-/Hostinstallation nötig. npm-Lockfile sowie Docker-Basisimages sind festgehalten.

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
./scripts/test-integration.sh
./scripts/test-e2e.sh
```

API-Prüfungen isolieren jeden Workflow in `rezeptdatenbank_test`. Browserprüfungen nutzen `rezeptdatenbank_e2e`, einen temporären Container auf 127.0.0.1:8081 und Chromium. Beide Skripte setzen ausschließlich benannte Testdatenbanken zurück. Der Offline-Test markiert nur seinen Testorigin explizit als sicher; normale LAN-HTTP-Prüfungen testen den echten unsicheren Browserkontext. Artefakte und Secrets werden nicht eingecheckt.

[Architektur](docs/ARCHITECTURE.md) · [Datenmodell](docs/DATABASE.md) · [Tandoor](docs/TANDOOR_IMPORT.md) · [Thermomix](docs/THERMOMIX.md) · [Cookidoo](docs/COOKIDOO_SYNC.md) · [Sicherheit](docs/SECURITY.md) · [Status](docs/IMPLEMENTATION_STATUS.md) · [Prüfnachweise](docs/VALIDATION.md)

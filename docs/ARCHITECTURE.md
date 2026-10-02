# Architekturentscheidung – 01.10.2026

## Umfang dieser Iteration
Die ursprünglichen Etappen sind in Version 0.8 umgesetzt: Verwaltung, Sharing, Import, Planung, Koch-/Gerätemodus, Konten und Offline-Küche. Der ausdrücklich gewünschte Cookidoo-Einkaufslistenadapter ist als optionale inoffizielle Integration ergänzt. Version 0.8 erweitert die App um einen öffentlichen Rezeptkatalog mit ausdrücklicher Freigabe. Aktueller Stand und Grenzen stehen in IMPLEMENTATION_STATUS.md/COOKIDOO_SYNC.md.

## Stack und Komponenten
Next.js 16 / React / TypeScript strict für UI und PWA; komponentenbezogenes CSS mit Designvariablen für die überschaubare erste Oberfläche (Tailwind bei Bedarf später); Fastify 5 als schlankes, modular gegliedertes REST-Backend statt NestJS. JSON-Schemas dienen Eingabevalidierung und OpenAPI. Prisma 6.19 als gepinnte Version mit bewährtem MySQL-Connector für MariaDB; ein Wechsel auf Prisma 7 benötigt eine eigene Adapter-/Migrationsevaluation. Node 22 im Container, MariaDB 11.8 für Entwicklung. Abhängigkeiten und Lockfile werden festgehalten.

Ein Docker-App-Service betreibt Next auf Port 3000 und Fastify nur intern auf 127.0.0.1:3001. Next leitet /api/v1 an Fastify weiter. Ein kleiner Prozess-Supervisor beendet beide Prozesse beim Ausfall eines Prozesses. Hintergrundaufgaben laufen zunächst im Backend (Session-Bereinigung), Importjobs und Cookidoo-Aufträge über DB-basierte Queues mit Lease, Wiederaufnahme und begrenzter Parallelität. Kein Redis im Grundgerüst.

## Datenbank und Betrieb
Der normale Compose-Start enthält ausschließlich die App und benötigt DATABASE_URL zu einer externen MariaDB. docker-compose.dev.yml ergänzt optional einen separaten MariaDB-Service ohne veröffentlichten Port. Die App enthält weder DB-Server noch SQLite-Fallback. Ein Wechsel des DB-Hosts erfordert nur Konfigurationsänderung und Neustart, aber kopiert keine Daten: Backup/Restore separat durchführen.

Migrationslauf beim Start, Liveness und DB-Readiness getrennt. Upload-Verzeichnis als Volume /app/uploads, alle Konfiguration über Environment. Nur APP_PORT wird extern veröffentlicht. HTTPS und Zertifikate übernimmt der Reverse Proxy. APP_ORIGIN, COOKIE_SECURE und TRUST_PROXY müssen passend gesetzt werden; TRUST_PROXY nur bei kontrolliertem Proxy aktivieren.

## Projektstruktur
- src/app: Next-Seiten und Manifest
- src/components: interaktive UI
- server/routes: Auth, System, Haushalt
- server/services: Authentifizierung und Berechtigungen
- server/lib: Konfiguration, DB, Schemas
- prisma: Schema und versionierte SQL-Migrationen
- tests: Business- und API-Tests
- scripts: Prozessstart und Betriebswerkzeuge
- shared: gemeinsame Rezepttypen, Dezimal-/Portionslogik und Einheitenmodell
- docs: Architektur, Datenmodell, Import, Geräte, Sicherheit, Roadmap

## Quellen
- https://nextjs.org/docs/app/getting-started/installation
- https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- https://docs.prisma.io/docs/orm/v6/overview/databases/mysql
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

Die Dokumentation bestätigt MariaDB-Unterstützung über provider=mysql. PWA benötigt Manifest, Icons und für Service Worker/Installation einen sicheren Kontext. HTTP auf einer LAN-IP erlaubt das UI, aber keinen vollständigen PWA-Betrieb. Offline-Fachdaten liegen verschlüsselt in einer separaten Offline-Oberfläche; keine privaten API-Antworten im globalen Cache.

## Erweiterung Planung/Sammlungen/Kochhistorie (02.10.2026)

Rezeptbücher, Plan und Einkaufslisten gehören bestehenden Haushalten und verwenden dieselbe Haushaltssperre wie Rollenänderungen. Jeder neue Schreibvorgang prüft die aktuelle Mitgliedschaft in der Transaktion; VIEWER liest. Rezeptbezüge werden zusätzlich durch bestehende private Freigaben gefiltert. Einkaufslisten speichern bewusst gemeinsam sichtbare Zutaten, weshalb Übernahme aus privaten Rezepten eine ausdrückliche Bestätigung verlangt. Einkaufsmengen werden mit Festkommaarithmetik normalisiert (g/kg, ml/l), andere Einheiten bleiben getrennt. Listenrevision schützt alle Eintragsänderungen; Polling liest Änderungen anderer Geräte und überschreibt keine laufende Bearbeitung.

Kochhistorie gehört dem angemeldeten Benutzer. Auch Leser dürfen eigene Abschlüsse speichern, solange sie das Rezept sehen können. Ein clientseitiger Vorgangsschlüssel mit eindeutiger Kombination Benutzer/Schlüssel verhindert doppelte Einträge bei Wiederholungen. Titel/Bilder werden aus weiterhin zugänglichen Rezepten gelesen, nicht als öffentlich sichtbarer Snapshot dupliziert. Neue Tabellen sind additiv; bestehende Rezeptdaten und Versionssnapshots unverändert.

## Entwicklungs-Upgrades und überprüfbare Sicherungen

Vor jedem Live-Upgrade erstellt scripts/backup.py eine konsistente Sicherung bei gestoppter App: SQL, Upload-Volume, .env, Image-ID sowie Konten- und Datenprüfsummen. Zielverzeichnis muss neu sein. Die Datenbank bleibt erreichbar; Restore-/Migrationstests erfolgen ausschließlich in rezeptdatenbank_upgrade. Der Standard-Compose enthält weiterhin keine Datenbank und verwendet DATABASE_URL. Sicherungen enthalten Secrets, bleiben lokal im ignorierten Verzeichnis mit Modus 0700/0600.

Die Planungsmodule dokumentieren ihre Rückgabefelder über explizite OpenAPI-Schemas; DTOs geben keine internen Ersteller-/Haushalt-IDs als unnötige Nebenfelder zurück. Das Dashboard liest die eigene Historie und aktuelle, zugängliche Planung; Favoriten und Zufallsauswahl verwenden denselben Berechtigungsfilter wie die Rezeptliste.

## Dateiimporte, Rezeptstände und Geräte

Tandoor-Default-ZIP wird als dateibasierter, persistenter Auftrag verarbeitet: sichere Vorschau ohne Rezeptschreibzugriff, ausdrücklicher Start, Ergebnis pro Rezept. Die originale ZIP-Datei liegt unter dem bestehenden privaten Uploadvolume, nicht in einem flüchtigen Containerverzeichnis. MariaDB speichert Auftrag, Lease und Einzelresultate. Ein kleiner Worker im Backend verarbeitet sequentiell, prüft Rechte vor jedem Rezept und setzt abgebrochene Aufträge über ablaufende Leases fort. Keine Redis-Abhängigkeit. Eine Haushalts-/Inhaltskennung verhindert doppelte Rezepte auch bei erneutem Hochladen; geänderte Rezepte werden als neue Inhalte behandelt und überschreiben keine lokalen Bearbeitungen. Gemeinsame Rezept-Locks und Importkennungen werden in derselben Transaktion geschrieben.

ZIP wird nicht ins Dateisystem extrahiert. Beide Ebenen benötigen Grenzen für Einträge, tatsächliche entpackte Bytes, Verhältnis und Dateinamen. Einzelne fehlerhafte recipe.json-Datensätze werden im Report ausgewiesen, ohne gültige Nachbarn zu verwerfen. Default exportiert keine Favoriten/Bewertungen/Kochbücher; Zielbuch und Sichtbarkeit wählt der Benutzer. JSON-Eigenformat erhält eine explizite Formatversion und wird mit den bestehenden Rezept-Validierungsregeln geprüft; Bilder werden als begrenzte WebP-Nutzdaten exportiert/importiert.

Änderungshistorie nutzt bereits vorhandene RecipeVersion-Snapshots. Wiederherstellen erzeugt eine neue Revision und behält die aktuelle Sichtbarkeit/Haushaltszuordnung; Änderungen an Freigaben sind davon getrennt. Klonen erstellt neue Bilddateien, um spätere Bildlöschungen nicht zwischen Rezepten zu koppeln.

Geräteparameter liegen in DeviceRecipeData hinter einem Adapter und bleiben vom allgemeinen Schrittmodell getrennt. Ein Datensatz ist an den Inhaltsstand der Schritte gebunden; nach einer Text-/Zutatenänderung werden alte Parameter nicht unbemerkt als aktuelle Kochanleitung gezeigt. Der Konvertereditor übernimmt zunächst bekannte Zeiten und zeigt offene Werte; manuelle Bestätigung ist erforderlich. Eigene Geräteexporte sind keine behaupteten Cookidoo-Importformate und steuern kein Gerät.

Zusätzliche Rezeptdaten werden additiv angelegt: RecipeNutrition (optionale Dezimalwerte mit Bezugsgröße), RecipeAllergen (explizite Angaben, keine Diagnose/Ableitung), RecipeStepIngredient (FK-Verknüpfungen innerhalb desselben Rezepts) und DeviceRecipeData. Der allgemeine Editor erhält diese Felder, Bestandsrezepte bleiben unverändert. Öffentliche Links speichern nur Tokenhashes und werden ausschließlich vom Rezept-Ersteller erstellt/widerrufen. Der öffentliche DTO enthält bewusst keine persönlichen Notizen, Bewertungen, Haushalts-/Benutzerdaten oder Historie. Jeder Abruf prüft Ablauf, Widerruf, Papierkorb und aktuelle Haushaltsmitgliedschaft des Freigebers.

## Konten und Offline-Betrieb (0.6)

Passwortreset speichert nur Token-Hashes, begrenzt die Gültigkeit auf 20 Minuten und widerruft bei Erfolg alle Sitzungen. SMTP ist optional über Environment konfiguriert; ohne SMTP wird kein Zustellversprechen angezeigt. OIDC verwendet Authorization Code mit PKCE, State, Nonce und einer browsergebundenen, kurzlebigen DB-Transaktion. Identitäten werden über Issuer/Subject verknüpft; bestehende Konten werden niemals allein aufgrund einer E-Mail-Adresse automatisch verbunden. Registrierung über OIDC bleibt explizit steuerbar.

Kontosperre, Profilbild, Reset und OIDC liegen in separaten Tabellen. Administrative Änderungen sperren den Bootstrap-Datensatz zum Schutz des letzten aktiven Administrators. Aktivitäten speichern Aktionen, Objekt-IDs und Zeitpunkte, keine Rezepttexte, Token, Passwörter oder URLs. Globale Administratorrechte umgehen keine privaten Rezeptrechte.

Offline-Daten werden nur nach Aktivierung lokal gespeichert, mit einer eigenen Offline-Passphrase verschlüsselt. Der Service Worker speichert ausschließlich die öffentliche Offline-Oberfläche und statische Dateien. Rezepte, Bilder, Woche und Einkaufslisten liegen verschlüsselt in IndexedDB; Schlüssel bleiben im Speicher und werden beim Sperren/Abmelden verworfen. Einkaufslisten-Häkchen werden als lokale Änderungen mit der ursprünglichen Listenrevision gehalten. Synchronisierung prüft Konto und aktuelle Revision; Konflikte verlangen eine bewusste Entscheidung. HTTPS bzw. localhost ist Voraussetzung für Service Worker/WebCrypto. Die HTTP-LAN-Instanz zeigt diesen Zustand ehrlich an.

## Cookidoo-Einkaufslisten (Nutzerwunsch 02.10.2026)

Die offizielle Hilfe beschreibt Teilen und geräteinternen Abgleich, jedoch wurde keine öffentliche Entwickler-Schnittstelle belegt. Die bestehende MIT-Bibliothek `cookidoo-api` 0.18.4 bietet OAuth/PKCE-Anmeldung, Refresh-Token und Einkaufslistenoperationen. Sie wird als klar gekennzeichneter inoffizieller Adapter eingebunden, ohne eigene vermutete Vorwerk-Endpunkte. Python läuft nur als begrenzter Unterprozess über stdin/stdout; es gibt keinen weiteren offenen Port. Anmeldung zunächst lesend, Aktivierung des beidseitigen Abgleichs erst ausdrücklich im Formular.

Eine persönliche Verbindung verweist auf genau eine gemeinsame Einkaufsliste. Der Nutzer bestätigt, dass Cookidoo-Inhalte im Haushalt sichtbar werden. Passwörter werden nicht gespeichert; OAuth-Token werden mit AES-GCM verschlüsselt, der Schlüssel liegt separat im Uploadvolume (0600) oder im Environment. Anmeldung verlangt standardmäßig HTTPS; COOKIDOO_ALLOW_HTTP=true ist die ausdrückliche Entwicklungsoption mit sichtbarer Formularbestätigung. Globale Administration erhält keinen Zugriff auf Verbindungstoken.

Drei-Wege-Abgleich mit gespeicherten Werten beider Seiten: unabhängige Änderungen zusammenführen, gleichzeitige Text-/Löschänderungen als Konflikt ausgeben. Freie Cookidoo-Einträge lassen sich hinzufügen, ändern, abhaken und löschen. An Rezepten hängende Zutaten lassen sich einzeln nur abhaken; Mengen-/Namensänderungen oder Einzel-Löschung verlangen eine ausdrückliche Konfliktentscheidung statt Entfernen des kompletten Cookidoo-Rezepts. Identitäten werden über IDs verfolgt; Erstabgleich verknüpft nur eindeutig identische Einträge.

Vor jedem externen Schreibzugriff wird eine Absicht gespeichert. Bei unterbrochenem/unklarem Ergebnis wird zuerst erneut gelesen und vorhandene IDs abgeglichen; ein Erstellen wird niemals blind wiederholt. Fremde gleichzeitige Änderungen werden unmittelbar vor dem Schreiben überprüft. Da die interne API kein belegtes atomisches ETag-Verfahren bietet, kann kein atomarer Abgleich mit parallel bedienter Cookidoo-App garantiert werden. Ein echter Konto-Test bleibt erforderlich; Offline-/Fake-Tests belegen nur unseren Adaptervertrag und Abgleichalgorithmus.

## Öffentlicher Rezeptkatalog (0.8)

`/entdecken` ist ein anonymer, durchsuchbarer Katalog hinter `PUBLIC_CATALOG_ENABLED`. Eine separate RecipePublication-Tabelle speichert ausschließlich ausdrückliche Freigaben durch den Rezept-Ersteller. Neue und vorhandene Rezepte sind zunächst unveröffentlicht. Veröffentlichungen besitzen eine eigene Revision; Freigabe prüft zusätzlich den aktuellen Inhaltsstand unter derselben Haushalt-/Rezeptsperre wie Bearbeitungen. Öffentlich wird der aktuelle Rezeptstand gezeigt. Widerruf, Papierkorb, Sichtbarkeitswechsel und Austritt nehmen die Veröffentlichung zurück; Wiederherstellen/Wiedereintritt veröffentlicht nicht automatisch erneut.

Jeder anonyme Abruf einschließlich Bilder prüft Freigabe, Papierkorb, aktives Herausgeberkonto und Mitgliedschaft im genau zugehörigen Haushalt. Separate DTOs erlauben nur Rezeptinhalt, Zutaten, Schritte, Bilder und sachliche Metadaten. Quellenname, Quell-URL und Nährwertquelle fehlen bereits in JSON/JSON-LD; ebenso persönliche Notizen, Benutzer-/Haushaltsdaten und interne Geräteparameter. Dasselbe Quellenfilter gilt für bestehende unaufgelistete Freigabelinks. Interne Daten bleiben unverändert. Öffentliche Seiten/Antworten sind dynamisch und nicht im Offline-Cache.

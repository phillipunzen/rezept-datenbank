# Phase 3 – Rezeptverwaltung

Die bestehende Instanz ist eingerichtet. Vor der Migration werden ihre Konto-/Haushaltsdaten gesichert. Eine neue additive Migration ergänzt fachliche Tabellen; bestehende Accounts, Sessions und HouseholdMember werden nicht geändert.

## Entscheidungen
Rezepte gehören in dieser Phase einem Haushalt. OWNER/ADMIN/EDITOR dürfen schreiben, VIEWER lesen und persönliche Favoriten/Bewertungen setzen. Jeder Zugriff – einschließlich Bilder und Metadaten – prüft die Mitgliedschaft. Private Rezepte und benutzerspezifische Freigaben folgen Phase 4.

Relational: Recipe, Ingredient, Unit, RecipeIngredientGroup, RecipeIngredient, RecipeStep, RecipeImage, Tag/RecipeTag, Category/RecipeCategory, Favorite, Rating und RecipeVersion. Mengen Decimal(12,4); UI überträgt Dezimalstrings, Skalierung berechnet ausschließlich die Anzeige. Änderungen ersetzen geordnete Zutaten/Schritte innerhalb einer Transaktion; eine Revisionsnummer verhindert das unbemerkte Überschreiben paralleler Änderungen. Vorherige Rezeptstände als unveränderliche Versionensnapshots. Löschen erfolgt über deletedAt, Wiederherstellung bleibt möglich.

Bei ursprünglicher Phase-3-Auslieferung: Bildimport ausschließlich als authentifizierter Multipart-Upload, maximal 8 MiB und 25 Megapixel, JPEG/PNG/WebP. Dekodieren und Re-Encodieren mit Sharp nach WebP entfernt aktive Inhalte und Metadaten; keine SVGs, keine fremden Bild-URLs, keine SSRF. Dateien im vorhandenen Uploadvolume, zufällige Dateinamen; Bildabruf prüft Rezeptberechtigung. Maximal acht Bilder je Rezept. Bildänderungen sind separat von der Textrevision und ändern deren Revisionsnummer, damit Clients einen aktuellen Stand laden müssen.

UI: echte Rezeptliste mit Suche/Filtern, mobile Detailansicht, Portionenskalierung, Zutaten mit Gruppen, sortierbare Schritte und Zutaten (Drag & Drop plus barrierefreie Auf/Ab-Buttons), Rezepteditor, Bilder, Tags/Kategorien, Favoriten/Bewertung, Papierkorb und Druckansicht. Kein vorgetäuschter Import oder Gerätetransfer.

## Prüfungen vor Aktualisierung
Migration auf bestehender DB-Kopie, Business-Tests für Dezimal-/Portionslogik, API-Tests für Fremdhaushaltszugriff, Viewer-Schreibschutz, parallele Updates, Soft Delete/Restore und Bildvalidierung. Browserworkflow Erstellen/Bearbeiten/Suche/Skalierung/Upload in separater E2E-DB. Docker-Build und Readiness nach Update, unveränderte Account-/Sessionanzahlen prüfen.

## Nebenläufigkeit und MariaDB 11.8
Ein echter Test mit zwei gleichzeitigen Updates lieferte unter dem Datenbankstandard REPEATABLE READ den MariaDB-Fehler 1020 statt des erwarteten fachlichen Konflikts. Schreibtransaktionen verwenden deshalb READ COMMITTED und sperren die zugriffsgeprüfte Rezeptzeile vor dem Lesen mit SELECT … FOR UPDATE. Die Revisionsbedingung bleibt zusätzlich bestehen: genau ein Update gewinnt, das andere erhält HTTP 409. Soft Delete und Bildänderungen verwenden denselben Sperrmechanismus. Lesende Detailabfragen verwenden einen zusammenhängenden REPEATABLE-READ-Snapshot. Keine Änderung der globalen DB-Konfiguration nötig, auch bei externer MariaDB.

Quellen:
- https://mariadb.com/docs/server/reference/error-codes/mariadb-error-codes-1000-to-1099/e1020
- https://github.com/mariadb-corporation/mariadb-docs/blob/main/server/server-management/install-and-upgrade-mariadb/upgrading/upgrading-from-to-specific-versions/upgrading-from-mariadb-11-4-to-mariadb-11-8.md
- https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions

## Ergänzung: Website-Link-Import
Auf Nutzerwunsch wurde der URL-Import mit Rezeptbild vorgezogen. Implementierung, Netzwerkgrenzen, Vorschau und Speicherung sind in [URL_IMPORT.md](URL_IMPORT.md) beschrieben. Der vorherige Stand ohne Remote-Bildabrufe ist damit erweitert. Keine Datenbankmigration erforderlich.

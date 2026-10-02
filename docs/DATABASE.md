# Relationales Datenmodell · 0.8.0

MariaDB/InnoDB, utf8mb4, CUID-Schlüssel, UTC, Fremdschlüssel und Indizes; Prisma provider=mysql. Normale App benötigt externe DATABASE_URL, optionale Entwicklungsdatenbank separat. Kein SQLite-Fallback. Mengen Decimal(12,4), aggregierte Einkaufsmengen Decimal(20,4); Berechnung mit Festkommaarithmetik.

## Konto und Zugriff

User, Session (nur tokenHash/Ablauf), Household, HouseholdMember mit OWNER/ADMIN/EDITOR/VIEWER, Singleton BootstrapLock. Haushaltsrevision und Row Locks schützen Mitgliedschaftsmutationen. HouseholdInvitation mit E-Mail/Rolle/gehashtem Token/Ablauf/Annahme/Widerruf. RecipeGrant mit VIEW/EDIT für private Rezepte; ein globaler Administrator erhält dadurch keine Sonderrechte.

AccountStatus speichert Sperre; ProfileAvatar Dateischlüssel. PasswordReset gehashter Einmaltoken; OidcIdentity eindeutig issuer/subject mit binärer Kollation, OidcAttempt kurzlebiger State-/Browserhash/Verifier/Nonce. AuditEvent enthält Aktion/Akteur/Zeit/Status ohne Payloads, Aufbewahrung 90 Tage.

## Rezepte

Recipe mit Haushalt, Ersteller, Sichtbarkeit HOUSEHOLD/PRIVATE, Metadaten, Revision und deletedAt. RecipeIngredientGroup/RecipeIngredient sowie haushaltsbezogene normalisierte Ingredient/Unit; RecipeStep und RecipeStepIngredient für geordnete Schritt-/Zutatenbezüge. RecipeImage private zufällige Storage-Keys. Tags/Kategorien m:n, Favorite/Rating pro Benutzer/Rezept. RecipeNutrition mit expliziter Bezugsgröße/Quelle und RecipeAllergen für Benutzerangaben.

RecipeVersion unveränderliche Snapshots, maximal 100 aktuelle Stände, Restore erzeugt neue Revision und erhält aktuelle Rechte/Bilder. DeviceRecipeData JSON mit Adapter-/Schemaversion, Bestätigung und common-content-Hash; allgemeiner RecipeStep bleibt geräteunabhängig.

## Planung und Import

Cookbook/CookbookRecipe m:n, MealPlanEntry Haushalt/Datum/Mahlzeit/Portionen/Rezept/Revision. ShoppingList/ShoppingListItem mit gemeinsamer Revision, normalisierten Mengen, mergeKey/Notiz/Häkchen. Neue Synchronisation erhöht dieselbe Listenrevision, damit normale und Offline-Clients Konflikte erkennen. CookingHistory gehört Benutzer und ist über userId/requestKey idempotent.

ImportJob mit persistentem Archivschlüssel, Status/Lease/Fortschritt, ImportResult je Rezept mit Warnungen/Fehlern, ImportReceipt zur wiederholbaren Inhaltszuordnung ohne Überschreiben lokaler Änderungen. ShareLink mit gehashtem Token, Ablauf und Widerruf; Zugriff hängt weiter von Rezept/Erstellerrechten ab.

## Öffentlicher Katalog

RecipePublication: recipeId als Primärschlüssel/FK, publisherId als Benutzer-FK, publishedAt (NULL bei Widerruf), eigene Revision. Keine Kopie von Rezeptdaten; neues Modell additiv ohne Änderung vorhandener Tabellenzeilen. Freigabe ausschließlich durch Ersteller; öffentliche Queries prüfen aktuellen Haushalt, aktives Konto, Papierkorb und publisherId=creatorId. Listensuche nutzt parameterisierte SQL-Abfragen und explizite DTOs.

## Cookidoo

CookidooConnection gehört eindeutig einem Benutzer und einer Einkaufsliste, zusätzlich Haushalts-FK. Verschlüsselte Sitzungstoken, Region/Konto-E-Mail, Pause, persistenter manueller Auftrag, Revision, nächster/letzter Abgleich, Worker-Lease, Bericht und unklare Schreibabsicht. CookidooItemLink verbindet lokale Eintrags-ID und Remote-Key samt beiden Baselines; Remote-Key binär kollationiert. Lokale FK onDelete SetNull erhält die Zuordnung nach lokalem Löschen, um Remote-Löschung/Änderungskonflikte zu erkennen. Verbindung löschen entfernt Zuordnungen/Token, keine Einkaufsdaten auf beiden Seiten. Schlüssel separat im Volume/Environment, nicht in der DB.

## Migrationen und Isolation

Alle fachlichen Queries prüfen Haushaltsmitgliedschaft, bei privaten Rezepten Ersteller oder Freigabe. Mutationen sperren Haushalt vor Rezept/Liste und prüfen Rechte erneut. API-Revisionen schützen vor veralteten Änderungen; keine unkontrollierte Last-write-wins-Synchronisierung.

Versionierte SQL-Migrationen über `prisma migrate deploy`, kein `db push` im Betrieb. MariaDB-DDL ist nicht vollständig transaktional: Backup und Test in einer isolierten DB vor Live-Upgrade. Migrationen 0.4/0.5/0.6/0.7/0.8 ergänzen Tabellen/FKs additiv; Tabellenprüfsummen und kompletter Restore sichern vorhandene Daten/Bilder ab. Migrationsrechte ausschließlich auf der dedizierten App-DB.

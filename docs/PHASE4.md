# Phase 4 – Haushalte, Einladungen, private Rezepte

Version 0.3.0. Bestehende Konten/Sitzungen/Mitgliedschaften/Rezeptdaten bleiben erhalten; neue Spalte Recipe.visibility hat Default HOUSEHOLD. Migration fügt Household.revision, HouseholdInvitation, RecipeGrant und Indizes hinzu. Standardbetrieb weiterhin mit externer MariaDB über DATABASE_URL; keine Datenbank im App-Container.

## Bedienung
Unter Haushalte & Mitglieder den Haushalt wählen, anlegen oder umbenennen. Mitgliederrollen ändern und Mitglieder entfernen. Der letzte Eigentümer bleibt geschützt. Einladen mit E-Mail und Rolle, danach den einmalig sichtbaren Link kopieren und selbst weitergeben. Kopieren funktioniert bei LAN-HTTP über Markieren als Fallback. Link sieben Tage gültig, einmal verwendbar. Bestehendes Konto anmelden und explizit annehmen, oder Konto mit mindestens zwölf Zeichen Passwort über Einladung erstellen. Die eingeladene E-Mail ist fest gebunden. Einladungen können widerrufen werden. Allgemeine Registrierung bleibt konfigurierbar und standardmäßig geschlossen.

Neue Rezepte sind Haushaltsrezepte. Im Editor Sichtbarkeit Privat wählen. Anschließend in der Detailansicht unter Rezept freigeben pro Mitglied Kein Zugriff/Lesen/Bearbeiten wählen und speichern. Nur der Ersteller kann Freigaben oder Sichtbarkeit ändern. Ein EDIT-Empfänger kann Inhalte/Bilder bearbeiten und Papierkorb verwenden, ohne Freigaben zu verwalten. VIEWER kann höchstens lesen. Haushalts- und globale Administratoren erhalten keinen Sonderzugriff auf private Rezepte.

## Regeln
- OWNER: alle Mitgliederrollen; ADMIN: nur EDITOR/VIEWER; EDITOR/VIEWER: Mitgliederliste ohne E-Mail-Adressen, keine Verwaltung.
- Maximal 20 Haushalte je Konto, 100 Mitglieder je Haushalt und 50 aktive Einladungen.
- Austritt/Entfernung: Zugriff auf alle Haushaltsrezepte einschließlich eigener privater Rezepte entfällt. Empfängerfreigaben werden gelöscht; Wiedereintritt braucht eine Einladung.
- Herabstufung auf VIEWER: EDIT-Freigaben werden VIEW, eine spätere Beförderung stellt sie nicht automatisch wieder her.
- Rollenwechsel/Entfernung widerrufen offene Einladungen dieses Mitglieds.
- Privat → Haushalt entfernt explizite Freigaben; späteres Privat-Schalten stellt diese nicht wieder her.
- Veraltete Revisionen liefern 409. In der Oberfläche neu laden; kein stilles Überschreiben.

## API
Haushalte GET/POST /households, GET/PATCH /households/:id. Rollen PATCH /households/:id/members/:userId, Entfernen DELETE mit revision-Query, Austritt POST /households/:id/leave mit revision. Einladung POST /households/:id/invitations mit email/role/revision, Widerruf DELETE /households/:id/invitations/:invitationId mit revision. POST /household-invitations/preview, /accept, /register verwenden token im JSON. Private Freigaben GET/PUT /recipes/:id/access; PUT enthält revision und vollständige grants-Liste mit userId/permission VIEW oder EDIT. Rezeptvisibility ist optional für ältere Clients; bei PATCH bleibt sie ohne Angabe erhalten. Alle Pfade unter /api/v1, Swagger verfügbar.

## Grenzen
Einladungslinks werden manuell geteilt, SMTP und E-Mail-Verifikation fehlen. Freigaben gelten nur innerhalb eines Haushalts, keine öffentliche Rezeptseite. Inhalte, die bereits gelesen/heruntergeladen wurden, können durch Widerruf nicht zurückgeholt werden. Tandoor-Archivimport, Planung und Geräteintegration bleiben nächste Iterationen.

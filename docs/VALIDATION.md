# Verifikation – 01.10.2026

Auf SRV-DEV01 unter /opt/rezeptdatenbank geprüft:

- TypeScript strict: erfolgreich.
- Docker-Produktionsbuild mit Node 22: erfolgreich.
- Prisma-Migration auf frischen, getrennten MariaDB-Testdatenbanken: erfolgreich.
- Drei Business-Tests: Password-Hashing mit Salt, Tokenvergleich und externe MariaDB-/HTTPS-Konfiguration: erfolgreich.
- API-Integrationstest: echter MariaDB-Zugriff, Setup-Code/CSRF/Validierung, einmalige Einrichtung, Login, gehashte Sessiontokens, HttpOnly/SameSite, Haushaltsisolation, Profil/Sprache, Passwortwechsel mit Tokenwiderruf, Logout, deaktivierte Registrierung und abgelaufene Sessions: erfolgreich.
- Chromium-E2E: Admin-Einrichtung über UI, Dashboard mit DB-Status, Profil/Sprache speichern, Logout, Smartphone-Login bei 390px und mobile Navigation: erfolgreich. Kein horizontales Overflow bei dieser Breite.
- Browserprüfung fand und behob unklare Formfeldnamen für Hilfstexte/Sprachauswahl sowie die bei kurzen Desktopfenstern unerreichbaren Sidebar-Einstellungen.
- npm audit --omit=dev: keine bekannten Funde zum Prüfzeitpunkt.
- Readiness über LAN-IP: HTTP 200, database=connected. Swagger/OpenAPI JSON und PWA-Icon: HTTP 200.
- Standard-Compose enthält nur app; Entwicklungs-Override ergänzt mariadb ohne veröffentlichten DB-Port.
- Gleicher App-Build wurde über Environment auf die separate E2E-Datenbank umgestellt; keine DB-Adresse im Frontendbuild.
- Stand bei Auslieferung von Phase 2: Die Entwicklungsinstanz war uninitialisiert (setupRequired=true), sodass der Nutzer seinen eigenen Admin beim ersten Öffnen anlegt. Testkonten existieren ausschließlich in Testdatenbanken.

Noch nicht verifiziert: externer kundeneigener MariaDB-Server (keine Zugangsdaten vorhanden), HTTPS/Reverse Proxy/PWA-Installation auf realem iPad, vollständiger Restore mit Rezeptbildern, Cookidoo-Kompatibilität einer eigenen Rezept-URL, konkrete Tandoor-Exportfixtures. Diese Punkte sind in den entsprechenden Dokumenten und der Roadmap festgehalten.

## Phase 3 – Version 0.2.0

- TypeScript und Docker-Produktionsbuild erfolgreich; npm audit --omit=dev ohne bekannte Funde.
- Zwei Migrationen auf frischer Test-DB erfolgreich.
- Fünf Business-Tests, einschließlich exakter Decimal-Portionsskalierung und Einheiten-Dimensionen, erfolgreich.
- Zwei API-Workflows erfolgreich: Authentifizierung plus vollständiger Rezeptlebenszyklus. Testet fremden Haushalt, VIEWER-Schreibschutz, Quellen-/Mengenvalidierung, Zutaten-/Schritt-Reihenfolge, Suche/Zeitenfilter, persönliche Favoriten, Bewertungsgrenzen, Revisionskonflikte mit zwei echten parallelen Requests, Bildtyp-Spoofing/SVG-Ablehnung, Überschreitung des 8-MiB-Uploadlimits, autorisierten Bildabruf, Datei-Löschung und Soft Delete/Restore.
- Zwei Chromium-Workflows erfolgreich: Grundgerüst plus Rezept-Erstellung, Dezimal-Eingabe, Sortierung, Portionenskalierung, Bild-Upload, Favorit/Bewertung, Bearbeiten, Zutatensuche, mobile Detailansicht und Papierkorb/Restore. Tests ausschließlich in rezeptdatenbank_e2e.
- Vor Migration Sicherung der echten Instanz nach backups/pre-phase3. Sicherung in rezeptdatenbank_upgrade restauriert; additive Phase-3-Migration erfolgreich, 1 Benutzer, 1 Haushalt, 1 Sitzung erhalten.
- Nach dem finalen Deployment stimmen Benutzer, Haushalte, Mitgliedschaften und Sitzungen einschließlich ihrer Felder exakt mit dem gesicherten Stand vor dem Update überein (SHA-256-Vergleich). Einrichtung bleibt abgeschlossen; Readiness und Weboberfläche über die LAN-Adresse liefern HTTP 200. OpenAPI dokumentiert das Multipart-Dateifeld für Rezeptbilder.
- Die Recipe-API steht zusätzlich in Swagger; fachliche Offline-Synchronisierung und öffentliches Sharing sind weiterhin nicht implementiert.

## Korrektur: Rezepteditor über LAN-HTTP

- Absturz beim Anlegen über einen HTTP-Host außerhalb von localhost reproduziert: `TypeError: crypto.randomUUID is not a function`. Die bisherigen Browserprüfungen auf localhost hatten diese API verfügbar und erkannten den Fehler deshalb nicht.
- Editor-Zeilen verwenden jetzt lokale, stabile Kennungen mit getrennten Präfixen für vorhandene und neu eingefügte Zeilen. Kein Browser-Crypto-Aufruf; Kennungen werden nicht als Datenbank-IDs gespeichert.
- E2E-Origin ist jetzt `http://rezeptdatenbank.test:8081`, im Browser auf 127.0.0.1 aufgelöst; Container bleibt ausschließlich lokal erreichbar. Der Test bestätigt `isSecureContext=false` und fehlendes `crypto.randomUUID`.
- Vor der Korrektur schlug der Rezept-Browsertest beim Öffnen des Editors fehl. Mit Korrektur bestehen beide Browserworkflows, einschließlich Anlegen, Hinzufügen/Sortieren von Zutaten und Schritten, Speichern, Bearbeiten, Bildern und mobiler Ansicht, ohne JavaScript-Seitenfehler.
- TypeScript-Prüfung und Docker-Produktionsbuild erfolgreich.
- Korrigiertes, getestetes Image auf der Entwicklungsinstanz gestartet; Weboberfläche und Readiness über LAN liefern HTTP 200. Benutzer, Haushalte, Mitgliedschaften und Sitzungen entsprechen exakt dem unmittelbar vor dem Deployment gesicherten Stand.

## Website-Link-Import einschließlich Bild

- Zehn Business-/Netzwerk-Tests und beide MariaDB-API-Workflows erfolgreich. Zusätzliche Prüfungen: JSON-LD/@graph/@id/Microdata, Brüche/Dezimalmengen/unklare Verpackungsangaben, HTML als Text, echte WebP-Bildvorschau, fehlendes/gesperrtes Bild, öffentliche IP-Bereiche, DNS-Pinning, private/gemischte DNS-Antworten, private Weiterleitung und komprimierte Antwort über Größenlimit.
- Die zugriffsgeprüfte Vorschau schreibt keine Rezeptzeile. Anonyme Nutzer, Fremdhaushalte und VIEWER werden vor Netzwerkabruf abgewiesen.
- Drei Chromium-Workflows auf nicht sicherem HTTP-Origin erfolgreich: bestehendes Grundgerüst, Rezeptverwaltung und Website-Import. Neue mobile Prüfung: URL-Fehler, Entwurf, editierbare Zutaten, sichtbares Bild, tatsächliche Rezept-/Bildspeicherung sowie Bild-Retry nach simuliertem Uploadfehler. Vorschau im Browsertest synthetisch; API-Speicherung und Uploads laufen gegen die echte E2E-DB.
- Manueller Abruf je eines Rezeptes von Chefkoch und Einfach Backen mit tatsächlichen Bilddownloads erfolgreich (keine Daten in der echten App-DB gespeichert).
- TypeScript, Docker-Produktionsbuild und npm audit --omit=dev erfolgreich; keine bekannte Audit-Funde zum Prüfzeitpunkt. Keine Datenbankmigration erforderlich.
- Echte Rezept-/Bildabrufe auch im Node-22-App-Container erfolgreich. Nach Deployment liefern Readiness und System HTTP 200; Import-Vorschau steht im Live-OpenAPI. Benutzer, Haushalte, Mitgliedschaften und Sitzungen stimmen exakt mit dem Stand unmittelbar vor dem Update überein.

## Phase 4 – Version 0.3.0 (01.10.2026)

- TypeScript, Docker-Produktionsbuild und npm audit --omit=dev erfolgreich, keine gemeldeten Schwachstellen.
- Drei Migrationen auf frischer MariaDB-Testdatenbank erfolgreich. Zehn Unit-Tests und vier API-Workflows erfolgreich: bestehende Auth/Rezeptverwaltung plus Haushalte/Einladungen und private Freigaben.
- Neue API-Prüfungen: Rolleneskalation/globaler Admin ohne Sonderzugriff, Schutz letzter OWNER mit parallelen Rollenwechseln, veraltete Revision, Widerruf/Ablauf, Token nur gehasht, E-Mail-Bindung, Einladung bei geschlossener Registrierung, einmalige Annahme mit paralleler Registrierung. Private Rezepte fehlen für Unberechtigte auch in Suche/Metadaten/Bildabruf. VIEW/EDIT, Erstellerkontrolle, Herabstufung und Mitgliedsentfernung geprüft. Eine während des Haushalts-Locks wartende Bearbeitung prüft nach Entzug die Berechtigung erneut und liefert 403.
- Vier Chromium-Workflows auf unsicherem HTTP-Origin erfolgreich: Grundgerüst, Haushalte/Freigaben, Rezeptverwaltung, Website-Link-Import. Zwei getrennte Browserkonten testen Einladung/Kontoanlage, Haushaltsanlage/Umbenennung, privaten Bildabruf, Lesefreigabe, Bearbeitungsfreigabe, Herabstufung und Entfernen. Mobile Breite 390 px ohne horizontalen Überlauf, keine Browser-Ausnahmen. Kopier-Fallback für Einladungslink ohne HTTPS geprüft. Ausschließlich rezeptdatenbank_e2e verwendet.
- Vor Live-Update App kurz gestoppt, SQL/Uploads/Environment sowie Konten-/Datenprüfsummen privat unter backups/pre-phase4 gesichert. SQL in die separate rezeptdatenbank_upgrade restauriert. Sharing-Migration angewendet und alle ursprünglichen Tabelleninhalte per SHA-256 verglichen: 1 Benutzer, 1 Sitzung, 1 Haushalt/Mitgliedschaft, 1 Rezept mit 9 Zutaten, 5 Schritten, 1 Bildreferenz erhalten. Bestehende Rezepte bleiben HOUSEHOLD.
- Nach Deployment stimmen sämtliche bestehenden Konten-, Haushalts-, Sitzungs- und Rezeptdaten mit dem unmittelbar vorher gesicherten Stand überein. Web UI und Readiness über http://192.168.10.70:8080 HTTP 200; System meldet Version 0.3.0, Phase 4, setupRequired=false, registrationEnabled=false. Live-OpenAPI enthält Haushalts-, Einladungs- und Freigaberouten.
- Externe Datenbank bleibt über DATABASE_URL konfigurierbar; aktuelle Entwicklungs-DB weiterhin eigener MariaDB-Container ohne veröffentlichten DB-Port. SMTP-Versand, öffentliche Rezeptfreigabe und fachliche Offline-Synchronisierung sind nicht Teil dieser Iteration.

## Studio-Oberfläche – Version 0.3.1 (01.10.2026)

- Kompakte Navigation, direkte Rezeptübersicht nach Anmeldung, Bildkarten und seitliche Rezeptdetails am Desktop. Unter 1101 px öffnet sich das ausgewählte Rezept als eigene Ansicht. Zutaten lassen sich vorübergehend abhaken; Druck bleibt ohne diese Markierungen.
- Darstellung System/Hell/Dunkel oben rechts und in Einstellungen. System ist Standard und reagiert auf laufende Browser-/Betriebssystemwechsel. Manuelle Auswahl bleibt pro Browser gespeichert und synchronisiert sich zwischen Tabs. Vor dem ersten Rendern wird die Präferenz angewendet. Auch ohne verfügbaren localStorage funktionieren Login und automatische Darstellung.
- TypeScript strict und Docker-Produktionsbuild erfolgreich. Keine neuen Abhängigkeiten und keine Datenbankmigration.
- Sechs Chromium-Prüfungen erfolgreich: Grundgerüst, Haushalte/Freigaben, Rezeptverwaltung, Website-Import mit Bild sowie zwei Theme-Prüfungen. Letztere prüfen automatischen Wechsel, manuelles Überschreiben, Neuladen, Einstellungen, Tab-Synchronisierung, nicht verfügbaren Browser-Speicher, mobile Breite 390 px, Desktop mit Sammlung/Details und Druck. Keine JavaScript-Seitenfehler und kein horizontaler Überlauf bei den geprüften Ansichten. Screenshots der hellen Sammlung, dunklen Detailansicht und mobilen Oberfläche kontrolliert.
- Der vollständige Browserlauf nutzt weiterhin ausschließlich rezeptdatenbank_e2e. Zwischen Testdateien wird der Testcontainer neu gestartet, damit getrennte Workflows nicht dasselbe minutenweise Rate-Limit aufbrauchen. Produktionslimits bleiben unverändert; Testdaten bleiben für die folgenden Workflows erhalten.
- Vor Deployment SQL, Uploads, Environment, vorheriger App-Image-Digest und Datenprüfsummen privat unter backups/pre-studio gesichert. Nach Deployment stimmen Konten-/Rezeptdaten, Rezeptbilddateien und Environment mit dem gesicherten Stand überein.
- Live-Weboberfläche und Readiness über http://192.168.10.70:8080 liefern HTTP 200. System meldet Version 0.3.1, Phase 4, setupRequired=false und registrationEnabled=false. Die ausgelieferte HTML-Seite enthält die frühzeitige Anwendung des Browser-Themes. DATABASE_URL bleibt die Konfiguration für externe Datenbanken.


## Rezept als eigene Seite – Version 0.3.2 (02.10.2026)

- Rezeptdetails nutzen die gesamte Inhaltsfläche auf Desktop und Smartphone. Die Sammlung wird während der Detailansicht ausgeblendet; „Zurück zu den Rezepten“ stellt sie mit den bisherigen Filtern wieder her. Zutaten und Zubereitung stehen bei ausreichend breitem Bildschirm nebeneinander. Der schmale, separat scrollende Detailbereich entfällt.
- Während der Detailansicht erfolgen keine zusätzlichen Abrufe der ausgeblendeten Sammlung. Darstellung System/Hell/Dunkel bleibt erhalten. Keine neue Abhängigkeit und keine Datenbankmigration.
- TypeScript strict, Docker-Produktionsbuild und alle sechs Chromium-Workflows erfolgreich. Die aktualisierte Darstellungsprüfung bestätigt gleiche Breite von Rezeptdetails und Inhaltsfläche am Desktop, ausgeblendete Sammlung auf Desktop/Smartphone, Druck und Rückkehr zur Sammlung; Screenshot der breiten Detailansicht kontrolliert.
- Sicherung vor Live-Update unter backups/pre-fullpage. Konten-/Rezeptprüfsummen, Rezeptbilddateien und Environment nach Deployment unverändert. Weboberfläche und Readiness über die LAN-Adresse liefern HTTP 200; System meldet Version 0.3.2 bei weiterhin abgeschlossener Einrichtung.

## Geführter Kochmodus – Version 0.3.3 (02.10.2026)

- Neuer sichtbarer Button „Kochvorgang starten“ in geöffneten, nicht gelöschten Rezepten mit Schritten, auch für Leser. Der modale Kochmodus füllt das Browserfenster, sperrt die Hintergrundoberfläche und übernimmt gewählte Portionen. Große Schritttexte, Vor/Zurück, Fortschritt, Zutaten zum Abhaken und Abschlussansicht. Theme und Sprache werden übernommen.
- Schritttimer mit hinterlegter Dauer: Start, Pause, Fortsetzen und Zurücksetzen. Mehrere Timer laufen unabhängig weiter und können über ihre Übersicht ausgewählt werden. Absolute Endzeit statt tickweise verringerter Restzeit; Pause bewahrt Millisekunden. Rückfrage vor Schließen/Abschluss mit laufenden Timern, Browserwarnung vor Neuladen/Verlassen. Zustand gilt für die geöffnete Ansicht; kein Datenbankschreibzugriff, keine persistente Kochhistorie, kein akustischer/Systemalarm oder Gerätesteuerung.
- TypeScript strict und Docker-Produktionsbuild erfolgreich; keine neuen Abhängigkeiten oder Migrationen. Alle sieben Chromium-Workflows erfolgreich, einschließlich der bisherigen Rezept-/Import-/Sharing-/Theme-Funktionen.
- Neuer Browserworkflow nutzt echte E2E-Rezeptdaten und kontrollierte Browserzeit: vollständige Fensterfläche, Mengen für sechs statt vier Portionen, Häkchen beim Schrittwechsel, Pause über einen Zeitsprung, Weiterlaufen zweier Timer, Ablauf beim anderen Schritt, Reset, abgebrochener Reload, abgebrochenes Schließen, Abschluss, Fokus zurück zum Start-Button, Wiederöffnung und Escape. Mobile Breite 390 px ohne horizontalen Überlauf; Screenshot kontrolliert. Rezeptrevision und gespeicherte Portionen bleiben unverändert. Keine JavaScript-Seitenfehler.
- Vor Deployment Sicherung unter backups/pre-cooking. Nach Deployment sind Konten-/Rezeptprüfsummen, Bilddateien und Environment unverändert. Weboberfläche und Readiness über LAN liefern HTTP 200; System meldet Version 0.3.3 bei abgeschlossener Einrichtung. Externe Datenbank weiterhin über DATABASE_URL konfigurierbar.

## Planung und gemeinsame Rezeptbücher – Version 0.4.0 (02.10.2026)

- Zwei neue fachliche Tests prüfen exakte Mengen, Einheiten und Kalenderdaten; insgesamt zwölf Unit-Tests und fünf MariaDB-API-Abläufe bestanden. Neue API-Prüfung umfasst private Bücher/Planung, Fremdhaushalte, Viewer, atomare private Einkaufsübernahme, Revisionskonflikte bei parallelem Abhaken, Rollenentzug und idempotente persönliche Kochabschlüsse.
- Docker-Build mit Node 22 erfolgreich. SQL aus backups/pre-planning wird ausschließlich in rezeptdatenbank_upgrade restauriert: alle bestehenden Tabellenprüfsummen stimmen vor/nach der additiven Migration überein.
- Neun Browserprüfungen bestanden: bestehende Abläufe, neues Bücher/Plan/Einkauf-Szenario inkl. zweitem Gerät und Mobile, Abschluss mit Notiz/Historie, tatsächlicher Vollbildwechsel sowie Wake-Lock-Anfrage/Verweigerung/Wiederaktivierung/Freigabe mit kontrollierter Browser-API.
- Live 0.4.0 bereitgestellt: LAN-Readiness und System HTTP 200; vorhandene Konten-/Datenprüfsummen, Uploadbytes und Environment unverändert, Einrichtung weiterhin abgeschlossen.

## Version 0.5 (02.10.2026)

15 Unit-Tests, sechs MariaDB-API-Workflows und zehn Chromium-Browserprüfungen erfolgreich. Neue Browserprüfung: bestätigte Geräteparameter, eigene JSON-Datei importieren, öffentliche JSON-LD-Seite ohne persönliche Notiz, Freigabe widerrufen sowie ein Default-Tandoor-Testexport mit 11-MiB-Zusatzdatei (über dem alten Proxy-Limit), einem gültigen und einem fehlerhaften Rezept. Tandoor-Fixtures unabhängig nach dem dokumentierten Originalformat erzeugt, kein echter Benutzerexport als Beleg behauptet.

Upgrade aus der aktuellen Live-Sicherung in die ausschließlich temporäre DB `rezeptdatenbank_upgrade` erfolgreich; alle bereits vorhandenen Datenzeilen und Spalten unverändert. Vollständiger Restore in isolierte DB `rezeptdatenbank_restore`, neues Uploadvolume und separate App auf 127.0.0.1:8082 erfolgreich: authentifizierte Rezeptansicht und bytegenaue Bildantwort überprüft. Testinstanz, Testvolume und Restore-DB danach entfernt. Nach Live-Deployment bestehende Daten, Konten, Sitzungen, Bilddateien und .env unverändert bestätigt.

## Version 0.6 (02.10.2026)

15 Unit-Tests, sieben isolierte MariaDB-API-Workflows und elf Browserprüfungen erfolgreich. API-Test mit lokalem SMTP-Server prüft tatsächlich empfangene Reset-Mail, gehashte Einmaltoken, Passwortwechsel und Sitzungswiderruf. Test-OIDC-Anbieter stellt ein signiertes ID-Token über Discovery/JWKS aus; PKCE, Nonce, State, Kontokollision, ausdrückliche Verknüpfung und Wiederverwendung geprüft. Letzter Administrator, gesperrte Anmeldung, Profilbild und administrative Protokollierung geprüft. Integrationstests erhalten je Workflow isolierte Tabelleninhalte, damit globale Bootstrap-/Admin-Regeln keine konkurrierenden Testfixtures sehen.

PWA im Chromium-Test mit ausdrücklich als sicher behandeltem ausschließlich lokalem Testursprung geprüft: AES-GCM-Daten in IndexedDB enthalten keinen lesbaren Rezepttext, falsche Passphrase scheitert, Oberfläche/Rezepte öffnen nach Offline-Reload, Einkaufshäkchen bleiben lokal, ein online geänderter Listenstand erzeugt einen Konflikt; bewusste Anwendung und Abmeldesperre über zwei Tabs erfolgreich. Diese Testoption wird nicht für die öffentliche HTTP-LAN-Instanz verwendet. Dort sind WebCrypto/Service Worker weiterhin durch Browserregeln eingeschränkt.

Aktuelle Live-Sicherung in `backups/pre-accounts-final/`; additive Kontenmigration erhält alle bestehenden Daten. Vollständiger Restore aus dieser Sicherung mit finalem 0.6-Image, authentifizierter Rezeptansicht und bytegenauem Bildvergleich erfolgreich. Live-Upgrade erhält Daten, Sitzungen, Bilddateien und Environment.

## Version 0.7 (02.10.2026)

18 Unit-Tests, acht je Datei isolierte MariaDB-API-Workflows, zwölf Chromium-Prüfungen und drei Python-Vertragsprüfungen mit installiertem veröffentlichtem SDK bestanden. TypeScript strict und Docker-Produktionsbuild erfolgreich; Produktions-npm-Audit im Build ohne Funde. Python läuft als unprivilegierter Bestandteil desselben Images, ohne offenen Port. SDK-Version 0.18.4 und alle installierten Python-Abhängigkeiten festgehalten.

Cookidoo-API-Test mit deterministischem Fake-Provider und echter MariaDB: Haushalts-/Viewerrechte vor Login, ausdrückliche Haushalt-/Abgleichbestätigung, HTTPS-Gating/Entwicklungsoption, persönliche Verbindungsisolation, verschlüsselte Token/Schlüsseldatei 0600 und kein gespeichertes Passwort. Erstabgleich und freie beidseitige CRUD-Operationen, Mengen/Häkchen-Zusammenführung, gemeinsame Änderungen/Baseline-Checkpoint, stale Konfliktentscheidung, nur unterstützte Rezeptzutaten-Häkchen, Unlink, bekannte Remote-Vorbedingungsfehler ohne unklare Schreibabsicht, verlorene Erstellung ohne Doppelanlage, lokales Löschen während Erstellung ohne ungültige FK, parallele lokale Änderung, zwei konkurrierende Worker, Kontensperre/Rechteverlust und Verbindungstrennung ohne Datenlöschung geprüft. JSON-Schlüsselreihenfolge und Mengen ohne bekannte Einheit fachlich geprüft.

Python-Vertragsprüfungen laufen mit Netzwerk deaktiviert gegen die tatsächlich installierte PyPI-Version: öffentliche SDK-Methoden vorhanden, Dataclasses passen, freie Einträge erstellen/umbenennen/abhaken/löschen, Rezeptzutat nur abhaken, Vorbedingungen ohne Schreibzugriff, feste Regionen und mehrdeutige Remote-IDs. Browser prüft ohne Cookidoo-Zugangsdaten über simulierte Antworten: HTTP standardmäßig gesperrt, explizite Entwicklungsfreigabe plus beide Formularzustimmungen, lesende Vorschau vor Aktivierung, Konfliktauswahl und nicht unterstützte lokale Rezeptzutatenänderung gesperrt. Mobile 390 px ohne horizontalen Überlauf. **Kein echter Cookidoo-Konto-/Live-Server-Test behauptet.**

Offline-Auswahl ergänzt Suche/Seitenwechsel mit erhaltener Auswahl und separates bevorzugtes Laden von Favoriten. Bestehende Offline-Prüfung bestätigt zusätzlich das Beibehalten einer ausgewählten Rezept-ID bei einer Suche ohne Treffer und erneute Auswahlansicht. Alle bisherigen Browserabläufe bestanden. Nach visueller Kontrolle die Konfliktrahmenfarbe an vorhandene Themevariable angepasst; abschließendes Image erneut gebaut und Grundgerüst/Cookidoo-Browserworkflow damit erneut bestanden.

Sicherung `backups/pre-cookidoo/` enthält SQL, Uploadvolume, private Environment-Konfiguration, tatsächliches Vorgängerimage und Prüfsummen bei gestoppter App. Upgrade in `rezeptdatenbank_upgrade` erhält alle vorhandenen Zeilen/Spalten. Vollständiger Restore in `rezeptdatenbank_restore` mit separatem Volume/Container auf Loopback 8082 erhält Daten, authentifizierte Rezeptansicht und eine bytegenau gleiche Rezeptbildantwort; temporäre Restore-Ressourcen entfernt.

Live unter http://192.168.10.70:8080: System 0.7.0/Phase 8, Einrichtung abgeschlossen, Readiness/Web UI HTTP 200, App/DB healthy. Alle 15 zuvor befüllten Tabellen unverändert, Konten-/Sitzungsprüfsummen und Uploadbytes unverändert. Environment unverändert gegenüber der Sicherung; einzig vorher absichtlich ergänzte Entwicklungsoptionen COOKIDOO_ENABLED=true und COOKIDOO_ALLOW_HTTP=true. Sonstige ursprüngliche Environment-Werte zuvor exakt auf Erhalt geprüft. Release-Image: `sha256:c940d4696ecc5811c0bc93a805e1440f30479d9a8800a2a41e8c07ebfd8e4efb`. SMTP/OIDC bleiben unkonfiguriert, Offline/Wake Lock auf LAN-HTTP browserbedingt eingeschränkt, Cookidoo-URL-Rezeptimport unbestätigt.

## Version 0.8 · öffentlicher Rezeptkatalog (02.10.2026)

18 Unit-Tests, neun isolierte MariaDB-API-Workflows und 13 Chromium-Prüfungen erfolgreich. Produktionsbuild mit TypeScript strict erfolgreich. Neue API-Prüfung umfasst ausdrückliche Zustimmung, Erstellerrechte einschließlich privater Rezepte/EDIT-Freigaben, fremde Haushalte, Inhalts-/Freigaberevisionen und parallelen Widerruf. Anonyme Suche nach Titel/Tag/Kategorie, Ernährungsfilter, Seitengrenzen, Quellen-/Notizfilter in DTOs/JSON-LD und unveränderte interne Quelle geprüft. Bildbytes/No-store sowie Widerruf, deaktivierter Katalog, Papierkorb/Wiederherstellen, Sichtbarkeitswechsel, gesperrter Herausgeber, VIEWER-Widerruf und Haushaltsaustritt/Wiedereintritt mit zusätzlicher Mitgliedschaft in einem anderen Haushalt geprüft. Bestehende unaufgelistete Links ebenfalls ohne Quellenfelder.

Neue Browserprüfung veröffentlicht ein privates Testrezept bewusst, findet es ohne Cookies über Anmeldeseiten-Link und Suche, zeigt vollständige Zutaten/Schritte und Bild, prüft Quellen-/Notizfreiheit auch im ausgelieferten HTML, Widerruf mit anschließendem Rezept-/Bild-404, mobile Breite 390 px und Browser-Dark-Mode. Bild bleibt geometrisch im Coverbereich; Desktop-/Mobile-Screenshots kontrolliert. Bestehende Browserabläufe einschließlich Linkfreigabe, Website-/Tandoor-Import, Rezeptverwaltung, Planung, Kochmodus, Offline und Themes erfolgreich. Keine synthetischen Rezepte oder Konten in der Live-Datenbank.

Private Sicherung `backups/pre-public-catalog`: SQL, Uploadvolume, Environment, altes Image sowie Konten-/Datenprüfsummen. Release-Image `sha256:56c1cc6b44adc46e478603344812434c561a5ba874c71ba8faae83754dbecad9`. Migration und vollständiger Restore mit genau diesem Image ausschließlich in isolierten Datenbanken/Volume geprüft; ursprüngliche Tabelleninhalte, authentifizierter Rezeptabruf und Bildbytes erhalten.

Live: Version 0.8.0/Phase 8, `setupRequired=false`, `PUBLIC_CATALOG_ENABLED=true`, `/entdecken`/Web UI/Readiness HTTP 200, App/MariaDB healthy. Alle 15 zuvor befüllten Tabellen, Konten/Sitzung und Uploadbytes mit Sicherung identisch. Öffentlicher Katalog zunächst leer; kein Bestandsrezept automatisch veröffentlicht. `.env` gegenüber Sicherung unverändert; vor Sicherung ausschließlich PUBLIC_CATALOG_ENABLED=true bewusst ergänzt, sämtliche bisherigen Werte erhalten. Externe Datenbank und Reverseproxy weiterhin über Environment konfigurierbar.

## Allgemeine Installation mit eigener MariaDB (02.10.2026)

README von Server-/LAN-spezifischen Angaben bereinigt und vollständige Installation ergänzt: eigene DB/Benutzer, Clone, Environment, einmalige Einrichtung, HTTPS, optionale Dienste, Update und DB-Wechsel. `.env.example` ausschließlich für externe MariaDB; separate `.env.development.example` und DEVELOPMENT.md für den ausdrücklich optionalen Entwicklungs-DB-Service.

Compose mit Standard-Beispiel gerendert: ausschließlich `app`, ausschließlich Uploadvolume, keine DB-Abhängigkeit, DATABASE_URL unverändert durchgereicht. Entwicklungsbeispiel separat mit explizitem zweiten Compose-File erfolgreich gerendert. Standard ergänzt `host.docker.internal:host-gateway` für eine MariaDB direkt auf dem Host; deren Listener muss aus Docker erreichbar sein.

Praktischer Start in separatem Compose-Projekt mit ausschließlich der App gegen eine bestehende MariaDB außerhalb dieses Projekts und ausschließlich leerer Testdatenbank `rezeptdatenbank_external_smoke`. Migrationen erfolgreich, Readiness connected, Ersteinrichtung verfügbar, Hostzuordnung im Container vorhanden, weder mariadbd noch mysqld im App-Image. Temporärer App-Container, Uploadvolume und Testdatenbank danach entfernt. Live-App und vorhandene Entwicklungsdatenbank weiter erreichbar; keine Datenbank-/Rezeptmigration am Live-Bestand vorgenommen. Änderungen betreffen Dokumentation, Beispiele und Compose-Konfiguration, keine Anwendungslogik.

## GHCR-Image und Compose-Installation (09.10.2026)

Standard-Compose mit .env.example gerendert: ausschließlich App und Uploadvolume, GHCR-Image, kein Build/DB-Service/depends_on. Lokaler Build-Override ebenfalls App-only; ausdrückliches Entwicklungsprofil behält lokalen Build und Test-DB. Workflow-YAML sowie Bash-Schritte geprüft, alle Actions auf aktuelle Release-Commit-SHAs festgelegt.

Lokales Produktionsimage gebaut und gegen eine leere isolierte Datenbank außerhalb seines Compose-Projekts gestartet. Migrationen, Readiness/Ersteinrichtung, Hostzuordnung und Abwesenheit von mariadbd/mysqld im App-Image erfolgreich geprüft. Testcontainer/-volume/-datenbank entfernt; kein Live-Datenbankwechsel. Der Workflow wiederholt Runtime-Prüfung vor jedem Registry-Upload. Ergebnis der ersten GitHub-Veröffentlichung wird nach deren Abschluss separat festgehalten.

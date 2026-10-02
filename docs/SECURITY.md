# Sicherheitskonzept · 0.8.0

## Anmeldung und Konten

Scrypt mit zufälligem Salt/versionierter Kodierung; zufällige Sessions ausschließlich als SHA-256-Hash in der DB, HttpOnly/SameSite=Lax, Secure über COOKIE_SECURE. Logout, Passwortwechsel/-reset und Kontensperren widerrufen Sessions. Einmaliger Bootstrap mit zufälligem Einrichtungscode und DB-Singleton; kein Entwicklungs-Auth-Bypass. Origin-Prüfung schreibender Browseranfragen gegen APP_ORIGIN, keine offene CORS-Freigabe, JSON-Schemas und Rate-Limits.

SMTP-Reset: kurzlebiger gehashter Einmaltoken, generische Anfrageantwort, URL-Fragment und kein Token in Logs, tatsächlicher Versand nur bei konfiguriertem SMTP. OIDC: Authorization Code/PKCE, State/Nonce, browsergebundener Versuch, signiertes ID-Token/JWKS, Issuer/Subject als Identität, explizites Verbinden bei bestehendem Konto. Keine automatische Verknüpfung nach gleicher E-Mail. Letzter aktiver Administrator wird durch gemeinsamen Lock geschützt. Audit enthält Akteur/Aktion/Zeit/Status, keine Anfragebodies/Passwörter; Bereinigung nach 90 Tagen.

## Haushalte und Rezepte

Jeder Haushaltszugriff prüft aktuelle Mitgliedschaft. VIEWER hat keine gemeinsamen Schreibrechte; eigene Favoriten/Bewertungen/Abschlüsse separat. Private Rezepte benötigen Erstellerstatus oder gezielte VIEW/EDIT-Freigabe zusätzlich zur Mitgliedschaft. Globale Adminrolle umgeht diese Rechte nicht. Suche, Metadaten, Bilder, Export, Planung, Bücher und Historie filtern dieselben Rechte. Schreibaktionen sperren Haushalt vor Rezept und prüfen danach Rechte erneut. Revisionen erkennen Paralleländerungen. Letzter OWNER bleibt erhalten.

Einladungen: gehashte 256-Bit-Token, E-Mail-Bindung, sieben Tage, Einmalannahme, Widerruf, Rolle des Einladenden und aktuelle Mitgliedschaft werden geprüft. Link wird manuell weitergegeben. Entfernen entzieht private Empfängerfreigaben; Wiedereintritt reaktiviert sie nicht. Rezept-Soft-Delete erlaubt Wiederherstellung; Versionsrestore verändert aktuelle Freigaben nicht.

Öffentliche Links nur ausdrücklich vom Ersteller, zufälliger Token nur gehasht gespeichert, Ablauf/Widerruf und bestehende Erstellermitgliedschaft geprüft. Öffentliche DTOs enthalten keine persönlichen Notizen, Bewertungen oder Kontodaten. Bildrechte werden auch nach Widerruf geprüft; no-store/no-referrer/noindex. Log-Redaktion entfernt URL, Referer, Cookie, Authorization, Anfragebody und Set-Cookie.

## Dateien und Import

Bilder: max. acht je Rezept, JPEG/PNG/WebP, 8 MiB/25 MP, Formatprüfung und Sharp-WebP-Neukodierung ohne EXIF, sichere zufällige Dateischlüssel, kein SVG. Profilbilder analog normalisiert. Dateipfade kommen ausschließlich aus kontrollierten Schlüsseln; Uploadvolume wird nicht statisch öffentlich ausgeliefert. JSON-Dateiformat streng validiert, Bilder begrenzt/normalisiert, Dateianlage und DB-Fehlerbereinigung abgestimmt.

Website-Fetch: HTTP(S), Ports 80/443, keine URL-Credentials. Alle DNS-Adressen müssen öffentlich sein; spezielle/private/Loopback/Link-local und Übergangsadressen gesperrt. Socket an geprüfte IP gebunden; jede Weiterleitung neu prüfen. Keine fremden Cookies/Auth, keine Skriptausführung/Paywallumgehung. HTML/Bildantworten komprimiert und dekomprimiert begrenzt, vier Redirects, 25-s-Budget.

Tandoor-ZIP: keine Pfadextraktion, Traversal/doppelte Namen/Symlinks/verschlüsselte Einträge abweisen, echte Größen- und Expansionsgrenzen über beide Ebenen. Persistente Originalarchive bleiben privat. Worker prüft Rechte je Rezept und speichert idempotente Ergebnisse. Teilfehler ersetzen keine gültigen Nachbarn und überschreiben keine lokalen Rezeptänderungen.

## Offline und Cookidoo

Service Worker cached nur öffentliche statische Offline-Dateien; keine angemeldeten Seiten, privaten Bilder oder APIs. Offline-Daten in IndexedDB AES-GCM, Passphrase mit PBKDF2, Schlüssel nur im Speicher. Gespeicherte Pakete gehören einem Konto; Synchronisierung prüft das aktuelle Konto und Listenrevisionen. Konflikte verlangen eine Entscheidung. Sperren/Logout über mehrere Tabs verwirft Schlüssel und leert die Ansicht; Hintergrundsperre nach zehn Minuten. Daten bleiben verschlüsselt lokal bis zum ausdrücklichen Löschen. Rechteverlust kann zuvor heruntergeladene Offline-Kopien nicht aus einem ausgeschalteten fremden Gerät zurückholen.

Cookidoo ist optional/inoffiziell, nicht als zuverlässiger offizieller Service zugesagt. Passwort nur zur Anmeldung über stdin, Token AES-GCM-verschlüsselt in DB, separater Schlüssel im privaten Volume/Environment. Kein zusätzlicher Port, feste Regionen, Zeit-/Größenlimits, keine fremden Fehlermeldungen in Logs. Eine persönliche Verbindung macht Inhalte ausdrücklich auf einer Haushaltsliste sichtbar. Rechteverlust/Kontensperre stoppt weitere Schreibzugriffe. Schreibabsichten vor Remote-Änderung, unklarer Ausgang pausiert statt blindem erneuten Erstellen. Kein belegter atomarer Remote-ETag-Vertrag; externe Paralleländerungen können nicht vollständig ausgeschlossen werden. [Details](COOKIDOO_SYNC.md).

## Betrieb

Eigener Reverseproxy konfiguriert APP_ORIGIN/COOKIE_SECURE/TRUST_PROXY. TRUST_PROXY nur bei kontrollierter Proxy-Infrastruktur; API und persönliche Seiten nicht cachen. HTTP-LAN-Entwicklung bleibt möglich. Cookidoo-Anmeldung auf HTTP ist standardmäßig gesperrt, lässt sich ausdrücklich mit COOKIDOO_ALLOW_HTTP freigeben und verlangt zusätzliche Formularbestätigung. Browser-Offline/Wake Lock erfordern HTTPS unabhängig von diesem Flag.

Externe MariaDB über DATABASE_URL, dedizierte DB/Rechte, private Verbindung und erforderlichenfalls striktes TLS mit CA; keine DB-Ports öffentlich. .env/Accessdatei/Backups ignoriert und privat, keine NEXT_PUBLIC-Secrets. Container als unprivilegierter Benutzer, Capabilities entfernt, no-new-privileges, begrenzte Logs. npm-Lockfile und Imageversion/Digests festgehalten. Backup enthält DB, Uploadvolume, Environment und Schlüssel. Änderungen mit passenden Tests und isoliertem Restore prüfen; Tests ersetzen kein unabhängiges Produktionsaudit.

## Öffentliche Veröffentlichung

Opt-in durch Rezept-Ersteller mit bewusster Bestätigung und Inhalts-/Freigaberevision; Schreibrechte erforderlich zum Veröffentlichen. Zurücknehmen bleibt dem Ersteller mit Leserechten erlaubt. Globales PUBLIC_CATALOG_ENABLED schaltet ausschließlich den Katalog. Alle anonymen Rezept-/Bildabrufe prüfen Freigabe, aktives Konto, Papierkorb und Mitgliedschaft im exakt zugehörigen Haushalt. Keine automatische Veröffentlichung aus Import/Kopie oder durch globale Adminrolle. Papierkorb/Sichtbarkeitswechsel/Austritt widerrufen auch für späteres Wiederherstellen/Wiedereintreten.

Explizite öffentliche DTOs enthalten keine Quellenfelder (einschließlich Nährwertquelle), privaten Notizen, Bewertungen, Geräteparameter, Benutzer-/Haushaltsdaten oder Dateischlüssel. Quellenfilter gilt auch für bestehende unaufgelistete Links. Rezepttexte sind Benutzerinhalt und werden nicht auf manuell eingegebene Quellenhinweise redigiert. Öffentliche SSR-Seiten/API/Bilder no-store, Referrer-Policy no-referrer; bei Widerruf sperrt der Server weitere Abrufe. Bereits gespeicherte Kopien können nicht zurückgerufen werden.

# Umsetzung der offenen Funktionen

Auftrag vom 02.10.2026: offene Funktionen der gesamten Rezept-App ergänzen. Bestehende Daten, Rollen und private Rezeptrechte erhalten; externe MariaDB weiter über Environment.

## Arbeitsreihenfolge und Abnahme

- [x] Gemeinsame Rezeptbücher: CRUD, mehrere Zuordnungen, Rollen und private Rezepte beachten.
- [x] Wochen-/Tagesplan: Mahlzeiten/Portionen, Rezeptauswahl, Drag & Drop, Haushaltrechte.
- [x] Einkaufslisten: manuell/aus Rezept/aus Plan, genaue Mengenaggregation g/kg und ml/l, Häkchen, Bearbeiten/Löschen, Konflikterkennung und Aktualisierung.
- [x] Kochhistorie: Abschluss mit Notiz/Portionen, persönliche Liste/zuletzt gekocht, Schutz vor doppeltem Speichern.
- [x] Kochmodus: Wake Lock mit Status/Fallback, tatsächlicher Browser-Vollbildschalter, Schrittbezug zu Zutaten und Timerergänzungen.
- [x] Rezepte: Duplizieren, Versionshistorie/Wiederherstellung, JSON-Import/Export, Nährwerte/Allergene, Bewertungs-/Zutatenfilter.
- [x] Tandoor-Default-ZIP: geprüftes Format, sichere Archivvorschau, wiederholbarer Hintergrundimport, Teilfehler/Report und Bilder.
- [x] Widerrufbare Linkfreigaben, öffentliche JSON-LD-Seite, QR und Export. Cookidoo-Annahme separat belegen.
- [x] Gerätemodell/Thermomix: validierter Parametereditor, bestätigte Vorschläge, eigener Export/Kochansicht. Keine nicht belegte Cookidoo-API.
- [x] Benutzer/Admin: Passwortreset mit konfiguriertem SMTP, OIDC-Konfiguration, Aktivitäten/Audit, optionales Profilbild.
- [x] Dashboard: heutige Planung, letzte Kochvorgänge, Favoriten, Zufallsrezept und Aktionen.
- [x] PWA: geschützte Offline-Rezepte/Plan/Listen und konfliktbewusste Synchronisierung.
- [x] Vollständiger Backup-/Restore-Test, Dokumentation und finale Gesamtprüfung.

Jede Etappe: Architekturentscheidung vor großen Änderungen dokumentieren, additive Migration, fachliche/API/Browserprüfungen, sicherer Live-Upgrade-Test mit vorhandenen Daten. Externe Zugangsdaten und nicht bestätigte Integrationsmöglichkeiten werden getrennt als Konfigurations-/Nachweispunkte festgehalten.

Zusatzwunsch: Beidseitiger Cookidoo-Einkaufslistenabgleich. Inoffiziellen SDK-Adapter und Drei-Wege-Abgleich mit Konflikten implementieren und testen; echtes Konto für den Servernachweis erforderlich. Eigener Reverseproxy über Environment; HTTP-Entwicklungsanmeldung ausdrücklich konfigurierbar.
- [x] Cookidoo-Einkaufslisten: Adapter, Tokenverschlüsselung, Erstabgleich, Hintergrundabgleich, Konfliktentscheidungen, UI und Tests.

Konfiguration: SMTP/OIDC-Zugangsdaten noch nicht gesetzt. Offline-Nutzung erfordert HTTPS (LAN bisher HTTP). Cookidoo-Annahme eigener öffentlicher Rezeptlinks nicht nachgewiesen.

Abschluss 0.7.0: 18 Unit-Tests, acht isolierte API-Workflows, zwölf Browserprüfungen und drei Offline-SDK-Vertragsprüfungen bestanden. Abschließendes Image gebaut, Upgrade/kompletter Restore aus Live-Sicherung geprüft und Instanz bereitgestellt; bestehende Daten/Session/Bildbytes unverändert. Eigener Reverseproxy vollständig per Environment konfigurierbar. Für die aktuelle IP+Port-Entwicklung COOKIDOO_ALLOW_HTTP=true; zusätzliche Zustimmung im Formular, später hinter HTTPS false setzen.

Zusatzwunsch 0.8: Öffentlicher Rezeptkatalog unter `/entdecken`, Suche und Ernährungsfilter, vollständige Ansichten mit Bildern, ausdrückliche Veröffentlichung/Widerruf durch Ersteller, Quellenfilter serverseitig und globales Environment-Flag. Vorhandene Rezepte bleiben unveröffentlicht.

- [x] Öffentlicher Rezeptkatalog ohne Login, ausdrückliche Freigabe/Widerruf, Quellenfreiheit in öffentlichen DTOs/JSON-LD/Ansichten und Environment-Schalter.
Abschluss 0.8.0: 18 Unit-Tests, neun isolierte API-Workflows und 13 Browserprüfungen bestanden. Release-Image gebaut, Migration/kompletter Restore aus aktueller Live-Sicherung geprüft und Server aktualisiert. Konten/Sitzung/Rezept/Bildbytes unverändert; Katalog erreichbar und zunächst leer, keine automatische Bestandsveröffentlichung.

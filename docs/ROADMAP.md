# Umsetzungsstand · 0.7.0

Die angeforderten Kernmodule sind implementiert: Rezeptverwaltung mit Bildern und Versionsständen, Haushalte/private Freigaben, Website-/JSON-/Tandoor-Import, gemeinsame Rezeptbücher, Planung/Einkauf, Kochmodus mit bestätigtem TM6-Adapter und Historie, öffentliche Links/QR sowie Konto-/Adminfunktionen und verschlüsselte Offline-Küche. Dashboard und mobile Navigation verbinden diese Module. Aktuelle Prüfnachweise: [VALIDATION](VALIDATION.md).

Zusatzwunsch Cookidoo: experimenteller beidseitiger Einkaufslistenadapter mit Hintergrundverarbeitung, verschlüsselten Tokens und Konflikten. Implementierung und Offline-/Fake-Provider-Prüfungen abgeschlossen; tatsächliche Anmeldung und Serverkompatibilität erst mit einem echten Konto belegbar. Nur Rezeptzutaten-Häkchen, freie Einträge zusätzlich CRUD. Keine behauptete offizielle Schnittstelle, keine Gerätesteuerung.

Offene Konfigurations-/Kompatibilitätspunkte:

- Eigener HTTPS-Reverseproxy des Nutzers: APP_ORIGIN, COOKIE_SECURE, TRUST_PROXY. Bis dahin IP+Port; Browser-Offline/Wake Lock verlangen sicheren Kontext. COOKIDOO_ALLOW_HTTP ist eine ausdrückliche Entwicklungsoption mit Formularbestätigung.
- SMTP/OIDC-Zugangsdaten einrichten; lokale SMTP- und signierte OIDC-Testanbieter bestanden, reale Anbieter noch nicht verbunden.
- Eigenen öffentlichen Rezeptlink manuell gegen Cookidoo „Meine Kreationen“ prüfen. JSON-LD allein belegt keine Cookidoo-Unterstützung.
- Tatsächlichen Tandoor-Export der Nutzerinstallation gegen den unabhängig implementierten Default-Parser prüfen. Formatfixtures/Fehlergrenzen sind getestet.
- Weitere Geräteadapter und optionale KI sind Erweiterungen; aktuelle Vorschläge erfinden keine Temperatur/Geschwindigkeit.

Änderungen weiterhin mit additiven Migrationen, geeigneten Fach-/API-/Browserprüfungen sowie Backup/Restore auf isolierten Testdatenbanken bereitstellen. Kein globaler Cache persönlicher API-Antworten und kein unkontrolliertes Überschreiben bei Synchronisierung.

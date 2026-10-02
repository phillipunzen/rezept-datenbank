# Thermomix und Cookidoo · 0.7.0

## Verfügbare App-Funktionen

Der allgemeine Kochmodus zeigt skalierte Zutaten mit Häkchen und Schrittbezug, große Touchflächen, mehrere absolute Schritttimer, Pause/Fortsetzen, Browser-Vollbild und Wake Lock mit Status/Fallback. Abschluss speichert persönliche Kochhistorie mit Portionen/Notiz idempotent. Timer gelten für die geöffnete Ansicht; kein garantierter Systemalarm bei geschlossener oder vom Betriebssystem angehaltener App. Offline-Kochansicht ist in der verschlüsselten Offline-Küche unter HTTPS verfügbar.

`DeviceAdapter`/Registry trennt Gerätespezifika vom normalen Rezept. Der TM6-Editor übernimmt vorhandene Zeiten als unbestätigte Vorschläge; Temperatur/Geschwindigkeit werden nicht geraten. Parameter pro Schritt: Aktivierung, Dauer, Temperatur, Geschwindigkeit, Linkslauf und Modus. Validierung prüft zulässige Kombinationen (u.a. ganze Sekunden im normalen/Teigmodus, Turbo 0.5/1/2 Sekunden, Geschwindigkeit 0.5–10 in halben Schritten, Temperaturbereiche und begrenzte Geschwindigkeit bei Heizung). Nutzer prüft und bestätigt ausdrücklich; Geräteanleitung/Originalrezept bleiben maßgeblich.

Bestätigte Daten sind an einen Hash der allgemeinen Rezeptinhalte gebunden. Bei Inhaltsänderung sind sie veraltet und müssen geprüft werden. Thermomix-Kochansicht nutzt bestätigte Schrittparameter und deren Zeiten. Export ist **unser versioniertes JSON**, auch im eigenen Rezept-JSON enthalten, kein versprochener Cookidoo-Dateiimport. Keine direkte TM6/TM7-Steuerung. TM7 ist noch kein eigener Parameteradapter.

## Eigene Rezept-URLs

Ersteller können ausdrücklich einen widerrufbaren öffentlichen Link mit Ablauf und QR-Code erstellen. Die Seite liefert serverseitiges Schema.org Recipe-JSON-LD mit Zutaten, Schritten, Bild und allgemeinen Zeiten. Persönliche Notizen, Bewertungen und Haushalts-/Kontoinformationen fehlen. Widerruf sperrt auch den Bildabruf. Öffentliche Freigabe ist optional und veröffentlicht kein ganzes Rezeptbuch.

[Cookidoo erläutert Importe](https://cookidoo.de/foundation/de-DE/articles/learn-about-importing-recipes), [Vorwerk nennt unterstützte Quellen](https://support.vorwerk.com/hc/de/articles/4404599366674-Grundlegende-Informationen-zu-eigenen-Rezepten-auf-Cookidoo). Daraus ist die Annahme beliebiger eigener Domains nicht belegt. Für einen Kompatibilitätstest einen unkritischen Testlink anlegen, App hinter öffentlich erreichbarem HTTPS betreiben und den Link selbst in „Meine Kreationen“ einfügen. Annahme sowie tatsächlich übernommene Zutaten/Schritte/Bilder prüfen. Die aktuelle LAN-IP ist von Vorwerk nicht allgemein abrufbar. **Unsere Links wurden noch nicht erfolgreich gegen diesen Importer nachgewiesen.**

## Einkaufslisten separat

Auf Zusatzwunsch ist ein experimenteller Einkaufslistenadapter über eine inoffizielle Bibliothek implementiert. Er wird nicht als offizielle Vorwerk-Integration bezeichnet und ist unabhängig vom Rezeptimport. Passwort nur zur Anmeldung, verschlüsselte Sitzungstoken, ausdrückliche Haushalts-/Abgleichbestätigung. Details und Einschränkungen: [Cookidoo-Einkaufslisten](COOKIDOO_SYNC.md). Ein echter Konto-Test steht aus.

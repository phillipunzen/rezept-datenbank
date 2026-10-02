# Cookidoo-Einkaufslisten, Version 0.7.0

Zusatzauftrag: automatischer Abgleich in beide Richtungen, sofern eine nutzbare Schnittstelle vorhanden ist. Die offizielle Hilfe beschreibt Einkaufen/Teilen, liefert aber in den geprüften Quellen keine belegte öffentliche Entwickler-API. Der Adapter verwendet die veröffentlichte MIT-Bibliothek [cookidoo-api](https://github.com/miaucl/cookidoo-api), festgehalten auf PyPI-Version **0.18.4**, über deren öffentliche Python-Methoden. Diese Schnittstelle ist **inoffiziell** und kann sich ändern. SDK-Vertrag und unser Abgleich sind offline mit simuliertem Provider geprüft; echte Anmeldung und aktueller serverseitiger Cookidoo-Vertrag bleiben mit dem Nutzerkonto nachzuweisen.

## Bedienung

Einkaufsliste öffnen → Cookidoo verbinden. E-Mail, Passwort und Region (DE/AT/CH/GB) eingeben und gemeinsame Haushaltssichtbarkeit bestätigen. Zuerst nur lesen: Vorschau zeigt beide Eintragszahlen. Erst „Abgleich aktivieren“ bestätigt Änderungen/Löschungen in beide Richtungen. Worker prüft normalerweise alle fünf Minuten; „Jetzt abgleichen“ stellt einen persistenten Auftrag ein. „Pausieren“ beendet zukünftige automatische Durchläufe. Manuelles Abgleichen während der Pause ist eine ausdrückliche Aktion. Trennen entfernt nur die lokale Verbindung/Zugangstoken, keine Einträge auf beiden Seiten.

Eine persönliche Verbindung gehört genau einer gemeinsamen Haushaltsliste; eine Liste ist höchstens mit einem Cookidoo-Konto verbunden. Nur der verbindende Benutzer verwaltet sie. Rechteverlust oder Kontensperre stoppt Schreibzugriffe. Andere Haushaltsmitglieder sehen die synchronisierte Liste, aber keine Zugangstoken. Zum Wechseln von Konto/Region/Liste erst trennen. Bei abgelaufener Anmeldung dasselbe Konto erneut verbinden.

## Zusammenführung und Grenzen

Eintrags-IDs und beide vorherigen Stände werden gespeichert. Unabhängige Änderungen an Inhalt und Häkchen werden zusammengeführt; gleichzeitig unterschiedliche Inhalte oder Löschen gegen Bearbeiten erzeugen Konflikte. Erstabgleich verknüpft nur eindeutig gleiche Inhalte. Mehrdeutige ähnliche Einträge bleiben eigenständig. Gleicher Inhalt mit verschiedenen Häkchen verlangt eine Entscheidung.

Freie zusätzliche Cookidoo-Einträge: hinzufügen, Text/Menge ändern, abhaken und löschen. Mengen und Notizen werden in den Text übertragen; bekannte Einheiten natürlich, sonst mengenbezogen in eckigen Klammern. maximal 500 Zeichen; Einträge, die nicht verlustfrei abgebildet werden können, pausieren mit Erklärung. Maximal 1000 Listeneinträge.

Rezeptzutaten: Name/Menge kommen von Cookidoo; nur Häkchen lassen sich dort einzeln ändern. Die App entfernt keine kompletten Cookidoo-Rezepte, um eine einzelne Zutat zu löschen. Konfliktansicht bietet Cookidoo-Version oder Trennen; lokale Version nur bei unterstützten Änderungen. „Trennen“ lässt beide Versionen stehen und schließt den Eintrag künftig aus. Eine inzwischen veraltete Entscheidung wird erneut zur Prüfung vorgelegt.

Die Remote-Liste wird unmittelbar vor einer Änderung geprüft. Da kein atomarer ETag-/Compare-and-swap-Vertrag belegt ist, besteht bei gleichzeitiger Bedienung der Cookidoo-App ein Restfenster; kein atomarer Zwei-System-Abgleich versprochen. Bei Absturz/Timeout wird eine gespeicherte Schreibabsicht anhand frisch gelesener IDs geprüft. Unbekannter Ausgang pausiert; Erstellen wird **nie blind wiederholt**. Bei nicht eindeutig auflösbarem Zustand erneut prüfen oder Verbindung trennen und nach Prüfung neu verbinden.

## Environment und Secrets

`COOKIDOO_ENABLED=true` stellt Modul/Worker bereit. HTTPS ist Standard für Anmeldung. Für die vom Benutzer gewünschte IP+Port-Entwicklung kann `COOKIDOO_ALLOW_HTTP=true` gesetzt werden; Formular verlangt zusätzliche Bestätigung der unverschlüsselten Browser–App-Strecke. Hinter eigenem HTTPS-Reverseproxy: APP_ORIGIN anpassen, COOKIE_SECURE=true, TRUST_PROXY passend, COOKIDOO_ALLOW_HTTP=false. Offline-Funktionen benötigen trotzdem HTTPS.

Passwort geht nur einmalig über stdin an den SDK-Unterprozess; weder DB noch argv/Logs enthalten es. OAuth-/Refresh-Token liegen AES-256-GCM-verschlüsselt in der DB. Schlüssel über `COOKIDOO_ENCRYPTION_KEY` (32 Byte als 64 Hexzeichen) oder einmalig `UPLOAD_DIR/.cookidoo-encryption-key` (0600). AAD trennt den Verwendungszweck. Schlüssel und vollständiges Uploadvolume zusammen mit der DB sichern; ohne Schlüssel ist erneute Anmeldung erforderlich. SDK hat keinen offenen Port. Abrufe/Unterprozess sind zeit- und größenbegrenzt; Fehlermeldungen enthalten keine fremden Antworttexte oder Token.

## Abgrenzung zum Rezeptimport

Der Einkaufslistenadapter ist unabhängig von eigenen Rezept-URLs oder Thermomix-Dateien. Er importiert/synchronisiert keine Rezepte und steuert kein Gerät. Annahme unserer öffentlichen JSON-LD-Seiten durch „Meine Kreationen“ bleibt ein separater manueller Kompatibilitätstest mit einer von Cookidoo erreichbaren HTTPS-Adresse.

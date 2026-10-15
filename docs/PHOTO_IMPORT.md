# Rezepte aus Fotos und Handschrift

Unter **Rezepte → Rezept hinzufügen → Rezept aus Foto** können gedruckte und handschriftliche Rezepte erkannt werden. Die App sendet das ausgewählte Foto erst nach ausdrücklicher Zustimmung an OpenAI. Das Ergebnis öffnet sich im normalen Rezepteditor: **Es wird noch kein Rezept angelegt.** Die Vorlage ist zunächst privat. Vor dem Speichern alle Mengen, Brüche, Einheiten und Schritte mit dem Original vergleichen.

JPEG, PNG und WebP bis 8 MiB werden unterstützt. Vor dem Versand prüft die App den tatsächlichen Bildtyp, begrenzt die Auflösung und entfernt Bildmetadaten. Das Foto wird für die Erkennung im Arbeitsspeicher verarbeitet. **Foto zusätzlich als Rezeptbild speichern** übernimmt es erst beim Speichern des Rezepts in das Upload-Volume. HEIC vorher in JPEG umwandeln. Mehrseiten-/PDF-Import und garantierte Handschriftqualität sind nicht enthalten.

## ChatGPT direkt per Device Code verbinden

Die Verbindung verwendet den offiziellen **Codex App Server** mit `account/login/start` und `type: chatgptDeviceCode`. Der passende Codex-Runtime ist im Docker-Image enthalten; Version und Paketintegrität sind über die npm-Lockdatei festgelegt. Auf dem Handy, Tablet oder Computer ist keine zusätzliche Installation und kein lokales Callback-Programm nötig. Authentik bleibt die unabhängige Anmeldung an der Rezept-App.

1. In den **ChatGPT-Sicherheitseinstellungen** die Anmeldung mit Device Code aktivieren. Für Arbeitsbereiche kann eine Administratorfreigabe nötig sein. OpenAI bezeichnet diesen Anmeldeweg als Beta; Verfügbarkeit, Kontoberechtigung und Modellfreigabe bestimmt OpenAI.
2. In der Rezept-App **Rezept hinzufügen → Rezept aus Foto → Continue with ChatGPT** wählen. Für eine vorhandene Registrierung **Erneut verbinden** verwenden.
3. **Bei OpenAI anmelden** öffnen, mit dem eigenen ChatGPT-Konto anmelden und den angezeigten **Einmalcode** eingeben. Den Code nicht an andere Personen weitergeben. Die verlinkte Adresse muss `https://auth.openai.com/codex/device` sein.
4. Die Rezept-App übernimmt die Bestätigung automatisch. Der Anmeldevorgang lässt sich abbrechen; nach Ablauf oder Ablehnung neu starten. Der angezeigte Vorgang gilt höchstens zehn Minuten; OpenAI kann ihn früher beenden. Nach einem Containerneustart einen neuen Vorgang starten.
5. Das verbundene Konto und die Nutzungseinstellungen prüfen. Eine erneute Anmeldung setzt die persönliche Bestätigung für zusätzliche Credits zurück.

Offizielle Beschreibung: [Device-Code-Ablauf im Codex App Server](https://learn.chatgpt.com/docs/app-server), [Device-Code-Freigabe im ChatGPT-Konto](https://learn.chatgpt.com/docs/auth). Stand: 15. Oktober 2026.

## Ohne zusätzliche Kosten betreiben

Der Device-Code-Ablauf nutzt die von Codex verwaltete ChatGPT-Anmeldung. **Keinen API-Schlüssel hinterlegen.** Die App übernimmt keine private Codex-Sitzung vom Administrator und verwendet keine API-Key-Ausweichroute.

Vor der Freigabe zusätzliches **Codex-Guthaben und automatische Guthabenaufladung in ChatGPT deaktiviert lassen**. Die App kann automatische Aufladung nicht selbst abschalten oder verbindlich für die Zukunft überprüfen. Wenn sich kostenpflichtige Zusatznutzung nicht ausschließen lässt, die Erkennung gesperrt lassen.

Es gibt zwei ausdrückliche Freigaben:

- Der Betreiber setzt `CHATGPT_CREDITS_DISABLED_CONFIRMED=true` erst nach Prüfung der Kontoeinstellungen.
- Jeder Benutzer bestätigt die Nutzung ohne Zusatzguthaben für seine eigene Verbindung in der App.

Zusätzlich fragt die App **vor jeder Erkennung** `account/rateLimits/read` ab. Sie startet nur, wenn Codex gewöhnliche enthaltene Nutzung ausdrücklich erlaubt, die gemeldeten Quoten nicht ausgeschöpft sind und die Meldung keinen Zugriff auf Zusatzguthaben oder unbegrenzte Credits ausweist. Fehlende, unbekannte oder widersprüchliche Angaben sperren die Erkennung. Ein Pro-Tarif allein ersetzt diesen Nachweis nicht. Verbrauchsanteile oder zurückliegende Reset-Zeiten werden nicht als selbst ermittelte Freigabe verwendet.

**Eine erfolgreiche Anmeldung allein löst noch keine KI-Anfrage aus.** Weder Anmeldung, Statusabfrage noch Modellauswahl starten eine Fotoerkennung. Es werden keine Credits gekauft, keine Quoten-Reset-Credits eingelöst und keine Zahlungs-/Upsell-Methoden aufgerufen. Bei einem abgewiesenen oder fehlgeschlagenen Erkennungslauf wird die Verbindung angehalten; erst nach Prüfung bewusst fortsetzen. Das Modell wird nicht automatisch durch ein anderes ersetzt. Der offizielle Codex-Runtime kann vorübergehende Verbindungsfehler intern behandeln; die App startet keinen zweiten Erkennungslauf und keinen anderen Anbieter.

Kontoeinstellungen können sich nach einer Prüfung ändern. Diese Kontrollen sind keine allgemeine Abrechnungsgarantie von OpenAI. Die tatsächliche Freigabe und die gemeldeten Nutzungsdaten müssen bei der Einrichtung mit dem eigenen Konto geprüft werden. Bis dahin bleiben beide Freigaben aus.

## Server einrichten oder aktualisieren

Die Compose-Datei betreibt weiterhin ausschließlich die App mit externer MariaDB über `DATABASE_URL`. Die additive Migration ergänzt Device-Anmeldevorgänge und die Verbindungsart. Vor Updates Datenbank und Upload-Volume sichern.

Für die erste Einrichtung in `.env` setzen und bei älteren Installationen die entsprechenden Einträge auch in `docker-compose.yml` übernehmen:

```dotenv
APP_ORIGIN=https://rezepte.example.de
COOKIE_SECURE=true
CHATGPT_PHOTO_IMPORT_ENABLED=true
CHATGPT_CREDITS_DISABLED_CONFIRMED=false
CHATGPT_ENCRYPTION_KEY=
```

Bei leerem Schlüsselwert erzeugt die App eine eigene Schlüsseldatei im persistenten Upload-Volume. Alternativ einen eigenen Schlüssel mit `openssl rand -hex 32` erzeugen und als `CHATGPT_ENCRYPTION_KEY` setzen. Nach der ersten Verbindung nicht ohne erneute Anmeldung wechseln. Schlüssel niemals ins Repository übernehmen.

```bash
docker compose pull app
docker compose up -d app
```

Nach Device-Anmeldung und Prüfung der Guthaben-/Aufladungseinstellungen auf dem Server `CHATGPT_CREDITS_DISABLED_CONFIRMED=true` setzen und den Container erneut erstellen. Anschließend die persönliche Bestätigung in der App setzen. Ein neues Environment-Feld für Device Code ist nicht nötig. Hinter dem Reverseproxy gelten die normalen Origin-/Cookie-Einstellungen. Die App benötigt HTTPS und ausgehende Verbindungen zu den offiziellen OpenAI-/ChatGPT-Diensten; kein zusätzlicher eingehender Port ist nötig.

Die frühere lokale Anmeldung bleibt für bestehende API-Clients kompatibel. Bereits gespeicherte OAuth-Verbindungen werden nicht stillschweigend umgedeutet. Über **Erneut verbinden** lassen sie sich ausdrücklich auf Device Code umstellen; die aktuelle Oberfläche gibt Fotoerkennung nur für Device-Verbindungen frei. Das frühere lokale Anmeldeprogramm wird nicht mehr benötigt.

## Foto importieren

1. Aktives Konto und Nutzungseinstellungen prüfen.
2. **Modelle laden** und ein angebotenes Modell mit Bildeingabe wählen. Die Liste stammt vom Codex-Runtime; rein textbasierte Modelle werden ausgefiltert. Sichtbarkeit in der Liste garantiert keine Freigabe eines echten Erkennungslaufs.
3. Ein gut ausgeleuchtetes, gerades Foto mit Zutaten und Zubereitung wählen.
4. Optional das Foto als Rezeptbild übernehmen, die Übermittlung ausdrücklich erlauben und **Foto erkennen und Vorschau öffnen** wählen.
5. Warnungen lesen und den Entwurf korrigieren. Fehlende Portionszahlen erhalten den angekündigten Platzhalter **1**, fehlende Zeiten **0**. Unlesbare Mengen bleiben ohne Zahl. Diäten und Allergene werden nicht automatisch zugesichert.
6. Sichtbarkeit bewusst wählen und das Rezept speichern.

## Speicherung und Trennung

Bis zu fünf persönliche Registrierungen lassen sich getrennt verwalten. Ein Haushalt verwendet nicht automatisch das KI-Konto eines anderen Mitglieds. **Verbindung trennen** entfernt die gespeicherten Zugangsdaten und meldet die isolierte Codex-Sitzung ab. Falls die externe Abmeldung nicht bestätigt werden kann, zeigt die App das an; die Sitzung zusätzlich in ChatGPT beenden.

Der Codex-Runtime erhält ausschließlich seine eigene isolierte Konfiguration, keine geerbten API-Schlüssel oder privaten Administrator-Sitzungen. Pro Anmeldung oder Operation wird ein geschütztes temporäres Verzeichnis verwendet. Der Runtime verwaltet seine OAuth-Tokens selbst; nach Abschluss werden die aktuellen Anmeldedaten verschlüsselt in der MariaDB abgelegt und die temporären Dateien entfernt. Datenbank-Leases verhindern konkurrierende Erkennungs-/Refresh-Prozesse derselben Verbindung. Eine parallele Trennung darf keine Tokens wiederherstellen.

Der Verschlüsselungsschlüssel `.chatgpt-encryption-key` liegt im Upload-Volume. Datenbank und Schlüssel/Volume gemeinsam sichern und geschützt aufbewahren. Zugangsdaten gehören weder in Browser-Speicher noch in Logs oder Supportnachrichten. Die Fotoerkennung verwendet kurzlebige Threads und keine zusätzliche Datei-, Shell-, Browser-, Plugin- oder Agentenfunktion. Der Modelloutput wird streng als Rezeptvorlage validiert. Aussagen über OpenAIs gesamte Datenverarbeitung oder Aufbewahrung ergeben sich daraus nicht.

Die automatisierten Anmeldung-/KI-Tests verwenden einen simulierten Runtime. Zusätzlich wird der echte gebündelte Runtime ohne Konto initialisiert. Ein echter Pro-Login und die Handschriftqualität müssen nach der Einrichtung auf der Zielinstanz noch geprüft werden.

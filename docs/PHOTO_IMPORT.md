# Rezepte aus Fotos und Handschrift

Unter **Rezepte → Rezept hinzufügen → Rezept aus Foto** können gedruckte und handschriftliche Rezepte erkannt werden. Die App sendet das ausgewählte Foto erst nach ausdrücklicher Zustimmung an OpenAI. Das Ergebnis öffnet sich im normalen Rezepteditor: **Es wird noch kein Rezept angelegt.** Die Vorlage ist zunächst privat. Vor dem Speichern alle Mengen, Brüche, Einheiten und Schritte mit dem Original vergleichen. Unlesbare Angaben können trotz Warnungen falsch erkannt werden.

JPEG, PNG und WebP bis 8 MiB werden unterstützt. Vor dem Versand prüft die App den tatsächlichen Bildtyp, begrenzt die Auflösung und entfernt Bildmetadaten. Das Foto bleibt standardmäßig nur für die Erkennung im Arbeitsspeicher. **Foto zusätzlich als Rezeptbild speichern** übernimmt es erst beim Speichern des Rezepts in das Upload-Volume. Fotos aus der Handygalerie oder der Kameraauswahl des Betriebssystems sind möglich; HEIC vorher in JPEG umwandeln.

## Tarif und Kosten: zuerst prüfen

Die Integration verwendet den offiziellen **Sign in with ChatGPT**-Weg für Open-Source-/selbst gehostete Apps. Berechtigte Plus-/Pro-Konten können hierfür ihr vorhandenes Kontingent nutzen. Die konkrete Konto-, Arbeitsbereichs- und Modellfreigabe bestimmt OpenAI; ein Pro-Abonnement allein garantiert die Freigabe nicht.

**Diese Verbindung kann laut OpenAI auch vorhandene Credits verwenden. Die App kann das Credit-Limit weder auslesen noch setzen. Es gibt keinen dokumentierten Request-Parameter, mit dem sie ausschließlich enthaltenes Kontingent erzwingen könnte.** Die folgenden Schalter sind deshalb manuelle Bestätigungen, keine technische Kostenobergrenze bei OpenAI.

Für Betrieb ohne zusätzliche Kosten:

1. Nach der Verbindung unter **ChatGPT → Einstellungen → Nutzung** diese registrierte App auswählen und ihren Zugriff auf zusätzliche Credits auf **0** begrenzen. Eventuelle automatische Guthabenaufladung ebenfalls ausgeschaltet lassen. Ein Limit des gesamten Kontos ersetzt nicht automatisch das Limit dieser App.
2. Ist diese Einstellung für das Konto nicht verfügbar oder ihre Wirkung unklar, **die Fotoerkennung gesperrt lassen**. Keine kostenpflichtige Alternative konfigurieren.
3. Erst nach Prüfung im Server-Environment `CHATGPT_CREDITS_DISABLED_CONFIRMED=true` setzen. Bei mehreren Benutzern/Registrierungen muss die Einstellung für jede Verbindung gelten. Jeder Benutzer bestätigt sein gesetztes Limit zusätzlich in der App. Eine erneute Anmeldung setzt diese persönliche Bestätigung zurück.
4. Diese Limits nicht nachträglich erhöhen, solange Kostenfreiheit gewünscht ist. Die Bestätigung in der Rezept-App würde sonst nicht mehr stimmen.

Es gibt **keinen API-Schlüssel, keinen bezahlten Ersatzanbieter, keine automatische Credit-Buchung und keinen automatischen Wiederholungsversuch** bei der Erkennung. Bei einem Nutzungs- oder Berechtigungsfehler hält die App die betroffene Verbindung an. Erst nach Prüfung der Nutzungseinstellungen bewusst fortsetzen beziehungsweise erneut anmelden. Verbrauch innerhalb deines Tarifs kann andere KI-Nutzung beeinflussen. Modellverfügbarkeit bedeutet nicht automatisch eine erfolgreiche Berechtigungsprüfung für Bilder.

Offizielle Grundlagen: [Übersicht](https://developers.openai.com/siwc/token-sharing-open-source), [Nutzung und Limits](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [Fehlerbehandlung](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [unterstützte Bildeingaben](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Stand: 15. Oktober 2026. Mit einem echten ChatGPT-Konto muss die Freigabe auf der Zielinstanz noch geprüft werden; automatisierte Tests verwenden ausschließlich einen simulierten Dienst und verursachen keine KI-Kosten.

## 1. Server vorbereiten

Die normale Compose-Datei enthält weiterhin ausschließlich die App und verwendet `DATABASE_URL` für eine externe MariaDB. Die neue, additive Migration legt nur Verbindungstabellen an; beim Containerstart wird sie automatisch angewendet. Vor Updates Datenbank und Upload-Volume sichern.

In `.env` setzen (bei einer vorhandenen Installation auch die neuen Einträge in `docker-compose.yml` übernehmen):

```dotenv
APP_ORIGIN=https://rezepte.example.de
COOKIE_SECURE=true
CHATGPT_PHOTO_IMPORT_ENABLED=true
CHATGPT_CREDITS_DISABLED_CONFIRMED=false
CHATGPT_ENCRYPTION_KEY=
```

Der leere Schlüsselwert erzeugt eine eigene Schlüsseldatei im persistenten Upload-Volume. Alternativ einen eigenen Schlüssel mit `openssl rand -hex 32` erzeugen und als `CHATGPT_ENCRYPTION_KEY` setzen. Nach der ersten Verbindung nicht ohne erneute Anmeldung wechseln. Schlüssel niemals ins Repository übernehmen.

Image aktualisieren und Container neu erstellen:

```bash
docker compose pull app
docker compose up -d app
```

Die Verbindung und Fotoerkennung benötigen eine gültige HTTPS-Adresse. Hinter einem Reverseproxy gelten die normalen `APP_ORIGIN`-/Cookie-Einstellungen. Ein weiterer öffentlicher Port ist nicht erforderlich. Ausgehendes HTTPS zu `auth.openai.com` und `api.openai.com` muss möglich sein. Das vorhandene Authentik-Login der Rezept-App bleibt unabhängig von dieser zusätzlichen KI-Verbindung.

## 2. Persönliches ChatGPT-Konto verbinden

Die Open-Source-Anmeldung verlangt einen lokalen Browser-Rücksprung an `127.0.0.1`. Daher läuft der kleine Anmeldehelfer **auf dem Computer mit deinem Browser**, beispielsweise deinem Windows-/Mac-/Linux-Rechner. Auf dem Server oder in der Handy-App muss kein Codex-Prozess installiert werden. Die einmalige Verbindung am Computer gilt anschließend auch beim Fotoimport vom Handy und Tablet.

1. In der Rezept-App anmelden, **Rezept hinzufügen → Rezept aus Foto → Continue with ChatGPT** öffnen. Ein Verbindungscode wird angezeigt; er gilt zehn Minuten und bindet die Anmeldung ausschließlich an dein Rezept-Konto. Nicht teilen oder in Supportnachrichten posten.
2. Über **Anmeldeprogramm herunterladen** die Datei `chatgpt-connect.mjs` auf deinen Computer laden. Alternativ aus dem öffentlichen Repository unter `public/tools/chatgpt-connect.mjs` beziehen und vor Ausführung ansehen.
3. Mit installiertem Node.js 22 oder neuer starten:

   ```bash
   node chatgpt-connect.mjs
   ```

4. Auf Nachfrage die HTTPS-Adresse deiner Rezept-App und den Verbindungscode eingeben. Den Code nicht als Kommandozeilenargument oder Environment-Variable übergeben.
5. Die ausgegebene OpenAI-Anmeldeadresse auf **demselben Computer** im Browser öffnen. ChatGPT-Konto/Arbeitsbereich wählen, Registrierung benennen und die Nutzung des ChatGPT-Tarifs freigeben. Nach der Rückmeldung das lokale Programm beenden lassen.
6. In der Rezept-App **Verbindungsstatus aktualisieren**. Das aktive Konto wird angezeigt. In ChatGPT jetzt die oben beschriebenen Credit-Limits setzen. Danach auf dem Server `CHATGPT_CREDITS_DISABLED_CONFIRMED=true` setzen und `docker compose up -d app` ausführen. In der App die persönliche Limit-Bestätigung setzen.

Die App verwendet OAuth mit PKCE und Nonce, prüft Signatur, Aussteller, Ziel-Client, Ablauf und Identität und verwahrt verschlüsselte Zugangsdaten serverseitig. Weder API-Schlüssel noch Codex-Sitzungsdateien werden benötigt. Der Helfer reicht den kurzlebigen Anmeldecode über HTTPS an die App weiter; die App tauscht ihn selbst gegen Tokens. Zugangstokens gelangen nicht in den Browser, die Kommandoausgabe oder Browser-Speicher. Die bestehende Anmeldung hier im Codex-Chat wird nicht übernommen.

## 3. Foto importieren

1. Das aktive ChatGPT-Konto und seine Nutzungseinstellungen prüfen.
2. **Modelle laden** und ein für dein Konto angebotenes Modell mit Bildeingabe auswählen. Die App erzwingt keinen fest eingebauten Modellnamen und wechselt bei Fehlern nicht selbstständig das Modell.
3. Ein gut ausgeleuchtetes, gerades Foto mit Zutaten und Zubereitung wählen. Bei mehreren Seiten zunächst pro Rezept ein vollständiges Bild verwenden; Mehrseiten-/PDF-Import ist nicht enthalten.
4. Optional das Foto als Rezeptbild übernehmen, die Übermittlung ausdrücklich erlauben und **Foto erkennen und Vorschau öffnen** wählen.
5. Warnungen lesen und den Entwurf korrigieren. Fehlende Portionszahlen erhalten den deutlich angekündigten Platzhalter **1**, fehlende Zeiten **0**. Unlesbare Mengen bleiben ohne Zahl. Diäten und Allergene werden nicht automatisch zugesichert.
6. Sichtbarkeit bewusst wählen und das Rezept speichern.

## Verbindungen verwalten und sichern

Bis zu fünf persönliche ChatGPT-Registrierungen lassen sich getrennt verwalten und auswählen. Ein Haushalt verwendet nicht automatisch das KI-Konto eines anderen Mitglieds. Bei erneutem Verbinden eine vorhandene Registrierung wählen, damit deren ausgegebene Client-ID erhalten bleibt. Jede Neuregistrierung kann eigene Limits in ChatGPT haben.

**Verbindung trennen** stoppt die lokale Nutzung und versucht, die erneuerbare externe Sitzung zu widerrufen. Falls die Bestätigung ausbleibt, zeigt die App das an; die App zusätzlich in ChatGPT trennen. Eine getrennte Registrierung bleibt mit ihrer Identitäts-/Client-Zuordnung für eine spätere Anmeldung gespeichert, ohne Zugangstokens. Bei einer Kontolöschung entfernt die Datenbank auch die Verbindungseinträge.

Zugangstokens und rotierende Refresh-Tokens liegen verschlüsselt in der externen MariaDB. Der Schlüssel `.chatgpt-encryption-key` und die stabile Hostkennung `.chatgpt-host-id` liegen verborgen im Upload-Volume. Datenbank **und** Schlüssel/Volume sichern und Backups geschützt aufbewahren. Die normalen Bildrouten stellen diese Dateien nicht bereit. Eine wiederhergestellte oder umgezogene Instanz benötigt gegebenenfalls eine erneute Anmeldung. Keine bestehende private Codex-Anmeldedatei auf den Server kopieren.

Nicht enthalten: garantierte Handschrifterkennung, Offline-KI, Verbrauchsmessung in Euro, automatische Verifikation der Credit-Einstellung und eine bereits bewiesene Freigabe deines realen Kontos. Erkennungsdaten werden mit `store:false` angefordert; das ist keine allgemeine Zusage über OpenAIs gesamte Datenverarbeitung oder Aufbewahrung.

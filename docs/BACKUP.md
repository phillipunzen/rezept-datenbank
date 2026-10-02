# Backup und Restore · 0.7.0

Eine vollständige Sicherung enthält **MariaDB, das vollständige Uploadvolume, private Environment-Konfiguration und App-Image/Versionsstand**. Uploadvolume beinhaltet Bilder, Importarchive und gegebenenfalls `.cookidoo-encryption-key`; bei Environment-Schlüssel dessen Wert sichern. Ohne passenden Schlüssel sind gespeicherte Cookidoo-Sitzungstoken nicht entschlüsselbar. Sicherungen enthalten personenbezogene Daten und Secrets: 0700-Verzeichnis/0600-Dateien, verschlüsselte externe Aufbewahrung.

## Entwicklungsprofil sichern

```bash
cd /opt/rezeptdatenbank
python3 scripts/backup.py backups/MEIN_NEUER_SICHERUNGSNAME
```

Dieses Skript ist für die aktuelle separate Compose-Entwicklungsdatenbank vorgesehen. Ziel muss neu innerhalb `backups/` liegen. Es ermittelt das tatsächlich laufende Image, stoppt die App für einen konsistenten Stand, schreibt Konten-/Tabellenprüfsummen und SQL-Dump, archiviert das Uploadvolume und kopiert `.env`. Im `finally` startet es die ursprüngliche App wieder; ein fehlgeschlagenes Backup ist kein gültiger Sicherungsstand. Supervisor/Compose lassen laufende begrenzte Arbeiten geordnet auslaufen; eine unklare Cookidoo-Schreibabsicht bleibt zur Wiederprüfung gespeichert.

Ergebnis: `database.sql`, `uploads.tar.gz`, `environment.env`, `image-id.txt`, `accounts-before.json`, `data-before.json`. Zusätzlich getestetes Image in Registry bzw. mit `docker image save` extern verwahren; ein lokaler Digest allein schützt nicht vor Serververlust. Lockfile/Quellen separat versionieren. Backups niemals committen.

## Restore vorher isoliert prüfen

```bash
python3 scripts/test-upgrade.py backups/MEIN_NEUER_SICHERUNGSNAME/database.sql rezeptdatenbank:0.7.0
python3 scripts/test-restore.py backups/MEIN_NEUER_SICHERUNGSNAME rezeptdatenbank:0.7.0
```

Upgrade testet ausschließlich `rezeptdatenbank_upgrade` und vergleicht bereits vorhandene Tabelleninhalte vor/nach Migrationen. Vollständiger Restore erzeugt ausschließlich `rezeptdatenbank_restore`, ein neues Volume und einen temporären Container auf 127.0.0.1:8082. Er vergleicht Daten vor/nach Start, ruft eine angemeldete Rezeptansicht auf und vergleicht Bildantworten bytegenau mit der Sicherung. Eine Testsession wird nur in der Restore-Kopie angelegt. Temporäre DB/Volume/Container/Environment-Datei werden anschließend entfernt. Live-DB und Live-Volume sind keine Restore-Ziele.

## Entwicklungsprofil tatsächlich wiederherstellen

Erst eine neue Sicherung des aktuellen Bestands und Rückfallmöglichkeit erstellen, App stoppen. SQL-Ziel muss eine leere dedizierte DB sein; keine vorhandene DB ungeprüft überschreiben. MariaDB-Benutzer benötigt Rechte nur für diese DB. Dump über `mariadb` einspielen. Uploadarchiv aus vertrauenswürdiger Sicherung in ein **leeres** Volume extrahieren, Besitzer 1000:1000 und private Schlüsseldatei 0600 erhalten. Environment auf Zielserveradressen prüfen, gesicherten Verschlüsselungsschlüssel erhalten; keine fremden Hostkonfigurationen blind übernehmen. Passendes App-Image starten, Migrationen/Readiness, Anmeldung, Haushalte/Privatrechte, Rezepte/Bilder und pausierte Integrationen kontrollieren.

`down -v` löscht Daten. Rollback auf Software, die neuere Privatrechte nicht kennt, ist unsicher; dafür einen zusammengehörigen alten DB-/Volume-/Image-Stand kontrolliert zurückspielen. Ein SQL-Dump allein stellt Bilder und Cookidoo-Schlüssel nicht wieder her.

## Externe MariaDB

Backupskript ersetzt kein Backup der künftigen externen Datenbank. App-Schreibzugriffe stoppen, Werkzeuge des DB-Servers oder `mariadb-dump`/`mariadb` über private/TLS-Verbindung verwenden. Credentials in eine private Datei, nicht als Argumente oder Shellhistory:

```ini
[client]
host=db.example.internal
port=3306
user=rezeptdatenbank
password=YOUR_PASSWORD
# ssl-ca=/path/to/ca.pem
# ssl-verify-server-cert
```

```bash
mariadb-dump --defaults-extra-file=/PRIVATE/client.cnf --single-transaction --routines --triggers rezeptdatenbank > database.sql
mariadb --defaults-extra-file=/PRIVATE/client.cnf rezeptdatenbank < database.sql
```

Uploadvolume/Environment/Image separat sichern. Nach Einspielen DATABASE_URL ändern und App mit der normalen Compose-Datei neu erstellen. URL-Änderung migriert keine Daten. Entwicklungs-DB erst nach erfolgreicher Prüfung stoppen, bisheriges Volume zunächst behalten.

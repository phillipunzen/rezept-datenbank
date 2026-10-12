# Funktionen und optionale Integrationen

Die Rezeptdatenbank unterstützt Rezeptverwaltung mit Bildern und Versionshistorie, Haushalte und private Freigaben, Website-/JSON-/Tandoor-Import, Rezeptbücher, Wochenplanung und Einkaufslisten, Kochmodus mit Timern und bestätigten TM6-Parametern, Kochhistorie sowie öffentliche Rezeptansichten. Kontenverwaltung und verschlüsselte Offline-Küche sind enthalten.

## Installation

Der normale Betrieb verwendet das veröffentlichte Docker-Image und eine eigene MariaDB. HTTPS, Reverseproxy, SMTP und OIDC werden über Environment konfiguriert. [Installation](../README.md#installation) · [Authentik](OIDC_AUTHENTIK.md).

## Optionale Integrationen

- Cookidoo-Einkaufslisten: experimenteller beidseitiger Adapter mit verschlüsselten Tokens und Konfliktentscheidungen. Die Schnittstelle ist inoffiziell; SDK-Vertrags- und simulierte Providerprüfungen ersetzen keinen Test mit einem echten Cookidoo-Konto. [Details](COOKIDOO_SYNC.md).
- Thermomix: bestätigte Geräteparameter und eigener Export, keine direkte Gerätesteuerung oder nachgewiesene Cookidoo-Rezeptübertragung.
- Tandoor: Default-ZIP-Export mit Bildern, Vorschau und Importbericht; Exportvarianten können abweichen.
- SMTP-Passwortreset und OIDC-Anmeldung werden bei entsprechender Konfiguration aktiviert.
- Offline-Küche und Wake Lock benötigen einen sicheren Browserkontext, regulär HTTPS.

Prüfnachweise: [VALIDATION.md](VALIDATION.md). Datenbank, Uploads und private Konfiguration gemeinsam sichern: [BACKUP.md](BACKUP.md).

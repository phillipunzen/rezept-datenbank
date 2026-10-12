# Funktionsumfang

Die folgenden Module sind Bestandteil des Docker-Images:

- Rezeptverwaltung mit Zutaten, Bildern, Portionenskalierung, Bewertungen, Versionshistorie, Papierkorb und JSON-Import/Export.
- Haushalte mit Rollen, Einladungen und gezielten privaten Rezeptfreigaben.
- Gemeinsame Rezeptbücher, Wochenplanung, Einkaufslisten mit Mengenaggregation und Revisionskonflikten.
- Kochmodus mit Timern, Vollbild, Wake Lock und persönlicher Kochhistorie.
- Website-Link-Import einschließlich Bildern und Tandoor-Default-ZIP mit Importvorschau und Teilfehlerbericht.
- Öffentlicher Rezeptkatalog unter `/entdecken` mit ausdrücklicher Veröffentlichung und Widerruf sowie Quellenfilter in öffentlichen Ansichten.
- Widerrufbare Rezeptlinks, QR-Code und Recipe-JSON-LD.
- Bestätigte Thermomix-Parameter, eigene Exportdateien und Geräteansicht.
- Profil- und Kontenverwaltung, Administration, Aktivitätenprotokoll, SMTP-Passwortreset und OIDC-Anmeldung einschließlich Authentik.
- Verschlüsselte Offline-Rezepte, Wochenplanung und Einkaufslisten mit konfliktbewusster Synchronisierung.
- Optionaler experimenteller Cookidoo-Einkaufslistenadapter mit Tokenverschlüsselung, Hintergrundabgleich und Konfliktentscheidungen.

Die Installation startet ausschließlich den App-Container. Die eigene MariaDB wird über `DATABASE_URL` verbunden. Integrationen werden zur Laufzeit über Environment konfiguriert; persönliche Zugangsdaten gehören nicht ins Image oder Repository.

Cookidoo verwendet eine inoffizielle Schnittstelle. Direkte Gerätesteuerung und die Annahme eigener Rezeptlinks durch Cookidoo sind nicht nachgewiesen. Weitere Informationen: [Funktionen und Integrationen](ROADMAP.md), [Authentik](OIDC_AUTHENTIK.md), [Prüfnachweise](VALIDATION.md).

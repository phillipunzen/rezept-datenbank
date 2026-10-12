# Anmeldung mit Authentik (OIDC)

Die App unterstützt OIDC bereits im veröffentlichten Docker-Image. Nach der Konfiguration erscheint auf der Anmeldeseite der OIDC-Button; angemeldete Benutzer können ihr bestehendes Konto in den Einstellungen verknüpfen. Die externe MariaDB speichert Kontoverknüpfungen und App-Sitzungen.

## Authentik einrichten

Unter **Applications → Applications → New Application** eine Anwendung mit Slug `rezeptdatenbank` und einem **OAuth2/OIDC**-Provider anlegen. [Offizielle Anleitung](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/create-oauth2-provider/).

| Einstellung | Wert |
| --- | --- |
| Client type | Confidential |
| Client ID / Client Secret | Aus dem Provider übernehmen |
| Redirect URI, Matching mode Strict | `https://rezepte.example.de/api/v1/auth/oidc/callback` |
| Scopes | `openid`, `email`, `profile` |
| Include claims in id_token | Aktivieren |
| Signing Key | RSA-Zertifikatsschlüsselpaar für RS256 auswählen |
| Encryption Key | Leer lassen |
| Issuer mode | Each provider has a different issuer, based on the application slug |

Die Redirect URI muss exakt zur Browseradresse `APP_ORIGIN` passen. Für den vorläufigen IP-Betrieb beispielsweise `http://SERVER_IP:8080/api/v1/auth/oidc/callback` eintragen. Der Authentik-Issuer selbst benötigt HTTPS und ein vertrauenswürdiges Zertifikat.

Den auf der Provider-Seite angegebenen Issuer einschließlich abschließendem `/` übernehmen, beispielsweise `https://auth.example.de/application/o/rezeptdatenbank/`. **Nicht** die Discovery-URL mit `.well-known/openid-configuration` als Issuer eintragen. Die App lädt darüber automatisch Discovery, Token-Endpunkt und JWKS. Authentiks globaler Issuer-Modus passt nicht zur automatischen Discovery dieser App. Asymmetrische Signatur und ID-Token-Claims müssen wie oben konfiguriert sein. [Authentik: Issuer, Scopes und Signatur](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/).

Den Zugriff auf die Anwendung in Authentik für die gewünschten Benutzer/Gruppen freigeben. Browser und App-Container müssen Authentik erreichen können, einschließlich Discovery-, Token- und JWKS-Endpunkt.

## Environment der App

In der vorhandenen privaten `.env` ergänzen; Datenbankkonfiguration und Einrichtungscode beibehalten:

```dotenv
APP_ORIGIN=https://rezepte.example.de
COOKIE_SECURE=true
TRUST_PROXY=true
OIDC_ISSUER=https://auth.example.de/application/o/rezeptdatenbank/
OIDC_CLIENT_ID=YOUR_AUTHENTIK_CLIENT_ID
OIDC_CLIENT_SECRET=YOUR_AUTHENTIK_CLIENT_SECRET
OIDC_LABEL=Mit Authentik anmelden
OIDC_REGISTRATION_ENABLED=false
```

Für IP + Port stattdessen `APP_ORIGIN=http://SERVER_IP:8080` und `COOKIE_SECURE=false` verwenden; `TRUST_PROXY` entsprechend der eigenen Proxy-Anbindung setzen. Die `docker-compose.yml` reicht alle OIDC-Variablen bereits an die App weiter. Secrets nur in der privaten `.env` speichern (`chmod 600 .env`), niemals im Repository.

Container nach Änderungen neu erstellen:

```bash
docker compose up -d --force-recreate app
```

Bei einer Installation mit dem ausdrücklich optionalen Entwicklungsprofil dessen bisherigen Compose-Aufruf verwenden:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build --force-recreate app
```

## Bestehendes Konto verwenden

1. Einmal mit dem bisherigen App-Passwort anmelden.
2. **Einstellungen → Anmeldekonto verknüpfen** öffnen und bei Authentik anmelden.
3. Danach ist auf der Anmeldeseite **Mit Authentik anmelden** verfügbar.

Verknüpfung und spätere Anmeldung funktionieren auch mit `OIDC_REGISTRATION_ENABLED=false`. Die App erkennt die Identität anhand des Issuers und der unveränderlichen Subject-ID, nicht allein an der E-Mail. Konten mit gleicher E-Mail werden deshalb nicht automatisch verbunden. Rezepte, Haushalt und Rechte bleiben am bestehenden Konto erhalten.

## Optional: neue Konten über Authentik

`OIDC_REGISTRATION_ENABLED=true` erlaubt neuen OIDC-Identitäten ein eigenes App-Konto mit eigenem Haushalt; sie erhalten keine globalen Administratorrechte. Diese Einstellung ist unabhängig von der normalen Passwortregistrierung. Die erste App-Einrichtung erfolgt weiterhin mit dem Einrichtungscode.

Neue Konten benötigen `email` und **`email_verified=true`** im signierten ID-Token. Seit Authentik 2025.10 liefert die Standard-E-Mail-Zuordnung zunächst `false`. Für neue Konten einen tatsächlichen E-Mail-Verifizierungsablauf und die dazu passende Scope-Zuordnung in Authentik verwenden. [Authentik: E-Mail-Adressen bestätigen](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/verify-email-address/). Bestehende, ausdrücklich verknüpfte Konten benötigen für die spätere Anmeldung keine erneute E-Mail-Verifikation.

## Fehler eingrenzen

- **Button fehlt:** `OIDC_ISSUER`/`OIDC_CLIENT_ID` setzen und Container neu erstellen. `/api/v1/auth/options` muss `oidcEnabled: true` liefern.
- **Redirect wird abgelehnt:** Authentik-Redirect und `APP_ORIGIN` einschließlich Schema, Host und Port abgleichen.
- **Anmeldung scheitert:** Issuer/Client-Zugangsdaten, Zertifikat, RSA-Signaturschlüssel und `Include claims in id_token` prüfen. Bei neuen Konten zusätzlich E-Mail-Verifikation und Registrierungsfreigabe prüfen; bestehendes Konto zuerst ausdrücklich verknüpfen.
- **Discovery nicht erreichbar:** Aus dem App-Netz `https://auth.example.de/application/o/rezeptdatenbank/.well-known/openid-configuration` prüfen. Ein Proxy darf diese Serveranfragen nicht mit einer interaktiven Browserprüfung blockieren.

Die App prüft Signatur, Issuer, Audience, State, Nonce und PKCE. Authentik-Gruppen werden nicht automatisch zu App-Administratoren oder Haushaltsrollen. Abmelden beendet die lokale App-Sitzung; ein globaler Authentik-Logout bzw. Back-channel-Logout ist derzeit nicht implementiert.

export const oidcFailures = {
  session: {
    de: "Die Anmeldung ist abgelaufen oder das Anmelde-Cookie fehlt. Bitte starte die Anmeldung erneut und bleibe bei derselben Browseradresse.",
    en: "Sign-in expired or the sign-in cookie is missing. Please start again using the same browser address.",
  },
  registration_disabled: {
    de: "Für dieses Anmeldekonto gibt es noch kein Rezept-Konto. Die Kontoerstellung über SSO ist deaktiviert. Bitte wende dich an den Betreiber oder verknüpfe ein bestehendes Konto in den Einstellungen.",
    en: "This sign-in has no recipe account yet. Creating accounts through SSO is disabled. Contact the operator or link an existing account in Settings.",
  },
  email_unverified: {
    de: "Der Anmeldedienst hat keine bestätigte E-Mail-Adresse übermittelt. Bitte lasse die E-Mail-Verifizierung für dein Konto beim Anmeldedienst prüfen.",
    en: "The sign-in provider did not supply a verified email address. Please have email verification checked for your provider account.",
  },
  email_missing: {
    de: "Der Anmeldedienst hat keine gültige E-Mail-Adresse übermittelt. Bitte lasse die E-Mail-Zuordnung beim Anmeldedienst prüfen.",
    en: "The sign-in provider did not supply a valid email address. Please have its email mapping checked.",
  },
  account_exists: {
    de: "Für diese E-Mail-Adresse besteht bereits ein Rezept-Konto. Melde dich mit dessen Passwort an und wähle in den Einstellungen „Anmeldekonto verknüpfen“.",
    en: "A recipe account already exists for this email address. Sign in with its password, then choose “Link sign-in account” in Settings.",
  },
  link_session: {
    de: "Zum Verknüpfen musst du im ursprünglichen Rezept-Konto angemeldet bleiben. Bitte melde dich erneut an und starte die Verknüpfung in den Einstellungen.",
    en: "Linking requires the original recipe account to remain signed in. Please sign in again and start linking from Settings.",
  },
  identity_in_use: {
    de: "Dieses Anmeldekonto ist bereits mit einem anderen Rezept-Konto verbunden.",
    en: "This sign-in is already linked to another recipe account.",
  },
  account_disabled: {
    de: "Das Rezept-Konto ist gesperrt. Bitte wende dich an den Betreiber.",
    en: "The recipe account is disabled. Please contact the operator.",
  },
  provider: {
    de: "Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut. Wenn das Problem bestehen bleibt, wende dich an den Betreiber.",
    en: "Sign-in could not be completed. Please try again. If the problem continues, contact the operator.",
  },
} as const;

export type OidcFailure = keyof typeof oidcFailures;
export function oidcFailureMessage(code: string, locale: "de" | "en") {
  const reason = Object.hasOwn(oidcFailures, code)
    ? (code as OidcFailure)
    : "provider";
  return oidcFailures[reason][locale];
}

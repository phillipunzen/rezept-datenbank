# Website-Link-Import mit Rezeptbild

Unter Rezepte → Rezept hinzufügen ist der Website-Link-Import verfügbar. Die Vorschau ersetzt auf Wunsch den aktuellen Entwurf; ungespeicherte Änderungen erfordern vorher eine Bestätigung. Es werden erst beim ausdrücklichen Speichern fachliche Daten geschrieben.

## Extraktion

Cheerio liest HTML ohne JavaScript-Ausführung. Unterstützt werden Schema.org Recipe in JSON-LD, Arrays, @graph und @id-Verknüpfungen sowie als Fallback Microdata. HowToStep/HowToSection/ItemList-Schritte werden geordnet übernommen; HTML wird in Text umgewandelt. Titel, Beschreibung, Quelle, Portionen, ISO-8601-Zeiten, Tags, Kategorien und ausdrücklich genannte Ernährungsformen gehen in den Entwurf ein. Bei mehreren Recipe-Objekten wird das erste mit Zutaten und Schritten bevorzugt; die Auswahl wird als Warnung angezeigt.

Zutaten unterstützen Dezimalpunkt/-komma, Brüche, gemischte und Unicode-Brüche sowie geläufige deutsche/englische Einheiten. Bereichsmengen, Verpackungsfaktoren und unklare Angaben bleiben als ursprünglicher Text erhalten. Mengen/Portionen müssen im Editor geprüft werden; keine automatische Gewichts-/Volumen-Schätzung. Fehlende Zutaten/Schritte bleiben leere Formularzeilen, deren Speichern die normale Rezeptvalidierung verhindert.

Ein Bild wird aus Recipe.image (URL/ImageObject) oder og:image übernommen. Relative URLs beziehen sich auf die nach Weiterleitungen tatsächlich geladene Seite. Bis zu drei Kandidaten werden versucht, ein Bild wird übernommen. Der Abruf prüft echte Bildformate, Dateigröße und Pixelzahl. JPEG/PNG/WebP werden nach WebP umkodiert; keine SVGs, aktiven Inhalte oder EXIF-Metadaten. Login-/Paywall-/Bot-Sperren und ausschließlich dynamische Rezeptdaten werden nicht umgangen. Unlesbare Rezeptdaten liefern einen konkreten Fehler, ohne bestehende Formularangaben zu verändern.

## API, Vorschau und Speicherung

`POST /api/v1/recipe-imports/preview` erwartet `{householdId, url}` und liefert `{draft, imageDataUrl, warnings}`. Cookie-Session, passende Origin und Schreibrechte sind erforderlich. Keine neue Datenbanktabelle und keine Migration. Die Vorschau erzeugt keine Rezeptzeile und keine Upload-Datei. Das normalisierte Bild wird begrenzt als WebP-Data-URL an den angemeldeten Browser zurückgegeben.

Beim Speichern verwendet die Oberfläche zuerst den bestehenden Rezeptendpoint und anschließend den zugriffsgeprüften Multipart-Bildendpoint. Scheitert der Bild-Upload, erscheint das bereits gespeicherte Rezept mit einer Meldung und **Bild erneut speichern**. Diese Aktion wiederholt nur den Bild-Upload, keine Rezeptanlage. Ein fehlendes Bild verhindert den Import der Rezepttexte nicht. Beim Verlassen/Neuladen geht ein ungespeicherter Entwurf verloren; keine serverseitige Import-Jobqueue in diesem Einzelimport.

## Netzwerkgrenzen

- HTTP(S), Ports 80/443, keine URL-Zugangsdaten; URL max. 2048 Zeichen.
- Alle DNS-A/AAAA-Ergebnisse müssen öffentlich sein. Private, Loopback-, Link-Local-, Dokumentations-, Multicast-, IPv4-Mapped- und IPv6-Transition-Ranges sind gesperrt. IPv6 ist auf globale Unicast-Adressen begrenzt.
- Der HTTP-Socket verwendet eine bereits geprüfte Adresse, keine zweite unkontrollierte DNS-Auflösung. Alle Weiterleitungen werden erneut validiert; maximal vier Redirects.
- HTML max. 3 MiB und Bild max. 8 MiB, jeweils sowohl im Transfer als auch nach Entpacken. 25 Sekunden Gesamt-Abrufbudget, 10 Sekunden Socket-Inaktivität, begrenzte Bilddekodierung.
- Import-Rate-Limit fünf Anfragen/Minute; Berechtigungsprüfung vor dem ersten Abruf. Keine Browsercookies oder Authorization an fremde Server.

## Verifikation und Quellen

Automatisierte Tests verwenden synthetische Fixtures. API-Test: Vorschau enthält ein echtes normalisiertes Bild, schreibt keine Rezepte und blockiert Fremdhaushalt/VIEWER/anonyme Requests vor Netzwerkzugriff. Native Fetch-Tests prüfen DNS-Pinning, gemischte öffentliche/private DNS-Antworten, private Redirects und eine komprimierte zu große Antwort. Browserworkflow unter einem nicht sicheren HTTP-Origin prüft mobile Vorschau, editierbare Zutaten, Fehler, Speicherung und Bild-Retry nach simuliertem Uploadfehler. Browserfixture simuliert die Vorschau; Speicherung/Uploads laufen gegen die echte separate E2E-DB.

Manueller Netzwerk-Smoke-Test am 01.10.2026: je ein Rezept von Chefkoch und Einfach Backen lieferte Titel, Zutaten, Schritte und normalisiertes Bild. Das ist kein Vollständigkeitsversprechen für die Anbieter oder alle Websites.

Primärquellen:
- https://schema.org/Recipe
- https://schema.org/recipeIngredient
- https://schema.org/recipeInstructions
- https://nodejs.org/api/dns.html
- https://nodejs.org/api/http.html
- https://sharp.pixelplumbing.com/api-constructor/
- https://www.chefkoch.de/rezepte/2529831396465550/Pfannkuchen-Crepe-und-Pancake.html
- https://www.einfachbacken.de/rezepte/bananenbrot

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import ipaddr from "ipaddr.js";
import { RecipeError } from "../services/recipes";

export function publicAddress(value: string): boolean {
  try {
    const address = ipaddr.parse(value);
    if (
      address.kind() === "ipv6" &&
      !(address as ipaddr.IPv6).match(ipaddr.parse("2000::") as ipaddr.IPv6, 3)
    )
      return false;
    // Reject special-use ranges, including IPv4-mapped IPv6 and transition ranges.
    return address.range() === "unicast";
  } catch {
    return false;
  }
}

export function importUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RecipeError(400, "Bitte einen gültigen Website-Link eingeben.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443") ||
    url.href.length > 2048
  )
    throw new RecipeError(
      400,
      "Nur öffentliche HTTP-/HTTPS-Links ohne Zugangsdaten sind erlaubt.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname.toLowerCase() === "localhost" ||
    hostname.toLowerCase().endsWith(".localhost") ||
    (isIP(hostname) && !publicAddress(hostname))
  )
    throw new RecipeError(
      400,
      "Lokale und interne Netzwerkadressen sind nicht erlaubt.",
    );
  url.hash = "";
  return url;
}

export interface FetchedPage {
  body: Buffer;
  url: string;
  contentType: string;
}
export type RemoteFetcher = (
  url: string,
  limit: number,
  signal: AbortSignal,
) => Promise<FetchedPage>;

export const fetchPublic: RemoteFetcher = async (value, limit, signal) => {
  let url = importUrl(value);
  for (let redirect = 0; redirect <= 4; redirect++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let stopLookup = () => {};
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        stopLookup = () =>
          reject(new RecipeError(504, "Die Website antwortet zu langsam."));
        signal.addEventListener("abort", stopLookup, { once: true });
        if (signal.aborted) stopLookup();
      }),
    ]).finally(() => {
      signal.removeEventListener("abort", stopLookup);
    });
    if (
      !addresses.length ||
      addresses.some((address) => !publicAddress(address.address))
    )
      throw new RecipeError(
        400,
        "Lokale und interne Netzwerkadressen sind nicht erlaubt.",
      );
    const address = addresses.find((item) => item.family === 4) ?? addresses[0];
    const result = await new Promise<FetchedPage & { location?: string }>(
      (resolve, reject) => {
        const request = (
          url.protocol === "https:" ? httpsRequest : httpRequest
        )(
          url,
          {
            agent: false,
            family: address.family,
            // Pin the validated address: the socket never performs a second DNS lookup.
            lookup: (_host, _options, callback) =>
              callback(null, address.address, address.family),
            signal,
            headers: {
              "User-Agent": "Rezeptdatenbank/0.2 (+recipe-link-import)",
              Accept:
                "text/html,application/xhtml+xml,image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1",
              "Accept-Encoding": "gzip, deflate, br",
            },
          },
          (response) => {
            const status = response.statusCode ?? 502;
            if ([301, 302, 303, 307, 308].includes(status)) {
              const location = response.headers.location;
              response.destroy();
              if (!location)
                return reject(
                  new RecipeError(
                    422,
                    "Die Website liefert eine ungültige Weiterleitung.",
                  ),
                );
              return resolve({
                body: Buffer.alloc(0),
                url: url.href,
                contentType: "",
                location,
              });
            }
            if (status < 200 || status >= 300) {
              response.destroy();
              return reject(
                new RecipeError(
                  422,
                  "Die Website oder das Bild konnte nicht abgerufen werden. Prüfe den Link; manche Websites sperren automatische Abrufe.",
                ),
              );
            }
            const encoding = response.headers["content-encoding"];
            const decoder =
              encoding === "gzip"
                ? createGunzip()
                : encoding === "deflate"
                  ? createInflate()
                  : encoding === "br"
                    ? createBrotliDecompress()
                    : null;
            if (encoding && encoding !== "identity" && !decoder) {
              response.destroy();
              return reject(
                new RecipeError(
                  422,
                  "Die Website verwendet ein nicht unterstütztes Datenformat.",
                ),
              );
            }
            const stream = decoder ? response.pipe(decoder) : response;
            const chunks: Buffer[] = [];
            let bytes = 0;
            let wireBytes = 0;
            const tooLarge = () => {
              reject(
                new RecipeError(
                  413,
                  "Die Website oder das Bild ist für den Import zu groß.",
                ),
              );
              request.destroy();
              response.destroy();
              decoder?.destroy();
            };
            response.on("data", (chunk: Buffer) => {
              wireBytes += chunk.length;
              if (wireBytes > limit) tooLarge();
            });
            response.on("error", reject);
            stream.on("error", reject);
            stream.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > limit) return tooLarge();
              chunks.push(chunk);
            });
            stream.on("end", () =>
              resolve({
                body: Buffer.concat(chunks),
                url: url.href,
                contentType: String(response.headers["content-type"] ?? "")
                  .split(";")[0]
                  .trim()
                  .toLowerCase(),
              }),
            );
          },
        );
        request.setTimeout(10_000, () =>
          request.destroy(
            new RecipeError(504, "Die Website antwortet zu langsam."),
          ),
        );
        request.on("error", reject);
        request.end();
      },
    );
    if (!result.location) return result;
    url = importUrl(new URL(result.location, url).href);
  }
  throw new RecipeError(422, "Die Website leitet zu häufig weiter.");
};

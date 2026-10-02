import { fromBufferPromise } from "yauzl";
import { RecipeError } from "./errors";
export interface ZipBudget {
  bytes: number;
  entries: number;
  maxBytes: number;
  maxEntries: number;
}
export const zipBudget = (): ZipBudget => ({
  bytes: 0,
  entries: 0,
  maxBytes: 200 * 1024 * 1024,
  maxEntries: 5000,
});
export async function readZip(
  buffer: Buffer,
  budget: ZipBudget,
  maxEntryBytes = 16 * 1024 * 1024,
): Promise<Map<string, Buffer>> {
  let zip;
  try {
    zip = await fromBufferPromise(buffer, {
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new RecipeError(400, "Ungültiges ZIP-Archiv.");
  }
  const files = new Map<string, Buffer>();
  try {
    if (zip.entryCount > budget.maxEntries - budget.entries)
      throw new RecipeError(413, "Zu viele Archiveinträge.");
    for await (const entry of zip.eachEntry()) {
      if (++budget.entries > budget.maxEntries)
        throw new RecipeError(413, "Zu viele Archiveinträge.");
      const name = entry.fileName;
      if (
        name.length > 250 ||
        name.includes("\0") ||
        name.includes("\\") ||
        name.startsWith("/") ||
        name.split("/").some((part) => part === "..") ||
        /^([a-z]:)/i.test(name)
      )
        throw new RecipeError(400, "Unsicherer Archivname.");
      if (entry.isEncrypted())
        throw new RecipeError(
          400,
          "Verschlüsselte ZIP-Dateien werden nicht unterstützt.",
        );
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
        throw new RecipeError(400, "Links im ZIP sind nicht erlaubt.");
      if (
        entry.uncompressedSize > maxEntryBytes ||
        entry.uncompressedSize > budget.maxBytes - budget.bytes ||
        entry.uncompressedSize > Math.max(1, entry.compressedSize) * 200
      )
        throw new RecipeError(
          413,
          "Archiv überschreitet die Größen- oder Entpackgrenze.",
        );
      if (name.endsWith("/")) continue;
      if (files.has(name))
        throw new RecipeError(400, "Doppelte Dateinamen im Archiv.");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += data.length;
          budget.bytes += data.length;
          if (size > maxEntryBytes || budget.bytes > budget.maxBytes)
            throw new RecipeError(
              413,
              "Entpackte Daten überschreiten die Grenze.",
            );
          chunks.push(data);
        }
      } finally {
        stream.destroy();
      }
      files.set(name, Buffer.concat(chunks));
    }
    return files;
  } catch (error) {
    if (error instanceof RecipeError) throw error;
    throw new RecipeError(400, "Beschädigtes ZIP-Archiv.");
  } finally {
    zip.close();
  }
}

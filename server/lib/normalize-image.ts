import sharp from "sharp";
import { RecipeError } from "../services/recipes";

export const imageFormats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
export async function normalizeImage(
  buffer: Buffer,
  mime: string,
): Promise<Buffer> {
  if (!imageFormats[mime])
    throw new RecipeError(415, "Erlaubt sind JPEG, PNG und WebP.");
  if (buffer.length > 8 * 1024 * 1024)
    throw new RecipeError(413, "Das Bild ist zu groß.");
  try {
    const image = sharp(buffer, {
      limitInputPixels: 25_000_000,
      failOn: "error",
    });
    const meta = await image.metadata();
    if (meta.format !== imageFormats[mime] || (meta.pages ?? 1) > 1)
      throw new Error("format");
    const output = await image
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .timeout({ seconds: 5 })
      .toBuffer();
    if (output.length > 8 * 1024 * 1024) throw new Error("size");
    return output;
  } catch {
    throw new RecipeError(
      400,
      "Das Bild ist beschädigt, zu groß oder sein Dateityp stimmt nicht.",
    );
  }
}

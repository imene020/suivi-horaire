/**
 * Réduit une photo dans le navigateur avant l'envoi : les photos de téléphone (5 à 8 Mo,
 * 4000 px) dépassent la limite d'envoi et n'apportent rien de plus à la lecture.
 * 2 576 px de long côté = la résolution maximale exploitée par les modèles de vision récents.
 */
export const MAX_IMAGE_EDGE = 2576;

export function targetSize(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Renvoie une version JPEG réduite si l'image est trop grande ; sinon (ou en cas d'échec) le fichier d'origine. */
export async function shrinkImageForUpload(file: File, maxBytes = 1.5 * 1024 * 1024): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const size = targetSize(bitmap.width, bitmap.height);
    if (size.width === bitmap.width && file.size <= maxBytes) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // fond blanc pour les PNG transparents
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

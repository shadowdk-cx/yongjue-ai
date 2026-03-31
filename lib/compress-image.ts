/**
 * Client-side image compression: resize to max dimension and re-encode as JPEG.
 * Dramatically reduces payload size for image-to-image Gemini calls.
 */

const DEFAULT_MAX_PX = 1024;
const DEFAULT_QUALITY = 0.82;

/**
 * Compress a base64 data-URL image (any format) to a JPEG data-URL
 * whose longest side ≤ maxPx and JPEG quality = quality (0-1).
 *
 * Returns the original if it's already small enough or if canvas is unavailable.
 */
export function compressImageDataUrl(
  dataUrl: string,
  maxPx = DEFAULT_MAX_PX,
  quality = DEFAULT_QUALITY,
): Promise<string> {
  if (typeof document === 'undefined') return Promise.resolve(dataUrl);
  if (!dataUrl.startsWith('data:image/')) return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      const longest = Math.max(width, height);
      if (longest <= maxPx) {
        const rawBytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
        if (rawBytes < 300_000) {
          resolve(dataUrl);
          return;
        }
      }

      if (longest > maxPx) {
        const scale = maxPx / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }

      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', quality);
      resolve(compressed);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Compress an array of base64 data-URL images in parallel.
 */
export function compressImages(
  dataUrls: string[],
  maxPx = DEFAULT_MAX_PX,
  quality = DEFAULT_QUALITY,
): Promise<string[]> {
  return Promise.all(dataUrls.map((u) => compressImageDataUrl(u, maxPx, quality)));
}

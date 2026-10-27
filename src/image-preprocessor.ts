import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { ImagePreprocessor } from "./ocr.ts";

const MAX_DESKEW_DIMENSION = 1200;
const MIN_UPSCALE_WIDTH = 1000;
const MAX_DESKEW_ANGLE = 5;
const DESKEW_STEP = 0.5;

export interface ImagePreprocessOptions {
  /** Rotate small skews back to horizontal using a projection-profile estimate. */
  deskew?: boolean;
  /** Upscale narrow images before OCR; Tesseract works best around 300 dpi. */
  upscale?: boolean;
  /** Grayscale and stretch the 1st..99th percentile to improve faded text. */
  contrast?: boolean;
}

interface InkPixel {
  x: number;
  y: number;
}

function grayscale(data: Uint8ClampedArray, index: number): number {
  return 0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!;
}

/** Otsu threshold on a grayscale histogram. */
function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]!;
  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let bestThreshold = 127;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    weightBackground += histogram[threshold]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += threshold * histogram[threshold]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

function estimateSkew(ink: InkPixel[], width: number, height: number): { angle: number; gain: number } | null {
  if (ink.length < 50) return null;
  const offset = Math.ceil(Math.hypot(width, height)) + 1;
  const rows = new Float64Array(offset * 2 + 1);
  let bestAngle = 0;
  let bestVariance = -1;
  let varianceAtZero = 0;

  for (let angle = -MAX_DESKEW_ANGLE; angle <= MAX_DESKEW_ANGLE + 1e-9; angle += DESKEW_STEP) {
    rows.fill(0);
    const radians = (angle * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    for (const pixel of ink) {
      const row = Math.round(-sin * pixel.x + cos * pixel.y) + offset;
      rows[row] = rows[row]! + 1;
    }
    let count = 0;
    let sum = 0;
    let sumSquares = 0;
    for (const value of rows) {
      if (value === 0) continue;
      count += 1;
      sum += value;
      sumSquares += value * value;
    }
    if (count === 0) continue;
    const variance = sumSquares / count - (sum / count) ** 2;
    if (Math.abs(angle) < 1e-9) varianceAtZero = variance;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  if (bestVariance <= 0 || varianceAtZero <= 0) return null;
  return { angle: bestAngle, gain: bestVariance / varianceAtZero };
}

/**
 * Conservative, opt-in OCR preprocessing. It does not claim to improve every
 * scan; callers should compare it with the original image on their own data.
 * EXIF orientation, perspective correction, and multi-frame images are not
 * handled here.
 */
export async function preprocessImageForOcr(
  imageBytes: Uint8Array,
  options: ImagePreprocessOptions = {},
): Promise<Uint8Array> {
  const image = await loadImage(Buffer.from(imageBytes));
  const deskew = options.deskew ?? true;
  const upscale = options.upscale ?? true;
  const contrast = options.contrast ?? true;

  const scale = upscale && image.width < MIN_UPSCALE_WIDTH
    ? MIN_UPSCALE_WIDTH / image.width
    : 1;
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));

  let canvas = createCanvas(width, height);
  let context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  if (contrast) {
    const data = context.getImageData(0, 0, width, height);
    const total = width * height;
    const grayscaleValues = new Uint8Array(total);
    const histogram = new Uint32Array(256);
    for (let pixel = 0; pixel < total; pixel += 1) {
      const value = Math.round(grayscale(data.data, pixel * 4));
      grayscaleValues[pixel] = value;
      histogram[value] = histogram[value]! + 1;
    }
    // Ignore only the extreme 0.01% on each side. A larger tail can exceed the
    // ink coverage of a sparse page, treating the paper/noise floor as "black"
    // and amplifying noise to the full range.
    const tail = Math.max(1, Math.floor(total * 0.0001));
    let low = 0;
    let high = 255;
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value]!;
      if (seen >= tail) {
        low = value;
        break;
      }
    }
    seen = 0;
    for (let value = 255; value >= 0; value -= 1) {
      seen += histogram[value]!;
      if (seen >= tail) {
        high = value;
        break;
      }
    }
    // A nearly uniform image has no useful contrast range. Skipping is safer
    // than turning a mostly white page into a solid black rectangle.
    if (high - low >= 16) {
      const span = high - low;
      for (let pixel = 0; pixel < total; pixel += 1) {
        const stretched = Math.max(0, Math.min(255, Math.round(((grayscaleValues[pixel]! - low) / span) * 255)));
        data.data[pixel * 4] = stretched;
        data.data[pixel * 4 + 1] = stretched;
        data.data[pixel * 4 + 2] = stretched;
      }
      context.putImageData(data, 0, 0);
    }
  }

  if (deskew) {
    const sampleScale = Math.min(1, MAX_DESKEW_DIMENSION / Math.max(width, height));
    const sampleWidth = Math.max(1, Math.round(width * sampleScale));
    const sampleHeight = Math.max(1, Math.round(height * sampleScale));
    const sample = createCanvas(sampleWidth, sampleHeight);
    const sampleContext = sample.getContext("2d");
    sampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
    const sampleData = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const histogram = new Uint32Array(256);
    for (let i = 0; i < sampleData.length; i += 4) {
      const value = Math.round(grayscale(sampleData, i));
      histogram[value] = histogram[value]! + 1;
    }
    const threshold = otsuThreshold(histogram, sampleWidth * sampleHeight);
    const ink: InkPixel[] = [];
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        if (grayscale(sampleData, (y * sampleWidth + x) * 4) < threshold) ink.push({ x, y });
      }
    }
    const skew = estimateSkew(ink, sampleWidth, sampleHeight);
    // Small projection-profile gains are usually noise, not a text baseline.
    if (skew && skew.gain > 1.05 && Math.abs(skew.angle) >= DESKEW_STEP) {
      const radians = (-skew.angle * Math.PI) / 180;
      const padding = 20;
      const rotatedWidth = Math.ceil(width * Math.cos(radians) + height * Math.abs(Math.sin(radians))) + padding * 2;
      const rotatedHeight = Math.ceil(height * Math.cos(radians) + width * Math.abs(Math.sin(radians))) + padding * 2;
      const rotated = createCanvas(rotatedWidth, rotatedHeight);
      const rotatedContext = rotated.getContext("2d");
      rotatedContext.fillStyle = "white";
      rotatedContext.fillRect(0, 0, rotatedWidth, rotatedHeight);
      rotatedContext.translate(rotatedWidth / 2, rotatedHeight / 2);
      rotatedContext.rotate(radians);
      rotatedContext.drawImage(canvas, -width / 2, -height / 2);
      canvas = rotated;
      context = rotatedContext;
      width = rotatedWidth;
      height = rotatedHeight;
    }
  }

  return new Uint8Array(canvas.toBuffer("image/png"));
}

export const canvasImagePreprocessor: ImagePreprocessor = {
  id: "canvas-deskew-contrast",
  version: "1.0.0",
  process: (imageBytes, _pageNumber) => preprocessImageForOcr(imageBytes),
};

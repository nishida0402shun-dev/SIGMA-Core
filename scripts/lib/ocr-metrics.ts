/** Shared text-error and timing statistics for OCR benchmarks. */

export function normalizeForCer(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

export function normalizeForWer(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function editDistance<T>(reference: T[], hypothesis: T[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let i = 1; i <= reference.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const substitution = previous[j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[hypothesis.length]!;
}

export function cer(reference: string, hypothesis: string): number {
  const ref = Array.from(normalizeForCer(reference));
  const hyp = Array.from(normalizeForCer(hypothesis));
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

export function wer(reference: string, hypothesis: string): number {
  const ref = normalizeForWer(reference).split(" ").filter(Boolean);
  const hyp = normalizeForWer(hypothesis).split(" ").filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

export function rank(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = average;
    i = j + 1;
  }
  return ranks;
}

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return null;
  return numerator / Math.sqrt(denomX * denomY);
}

export function spearman(xs: number[], ys: number[]): number | null {
  return pearson(rank(xs), rank(ys));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Nearest-rank percentile in 0..1 over unsorted values. */
export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

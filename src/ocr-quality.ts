/**
 * Cheap, explainable review signals for OCR output.
 *
 * Engine confidence is not accuracy: it is a word-level model score, so the
 * thresholds below only flag pages for review. They never rewrite text or
 * claim that a flagged page is wrong.
 */
export interface OcrQualityPolicy {
  /** Flag pages whose engine confidence is below this 0..1 value. */
  minConfidence?: number | undefined;
  /** Flag pages whose trimmed text is shorter than this character count. */
  minCharacters?: number | undefined;
}

export interface OcrQualityAssessment {
  needsReview: boolean;
  warnings: string[];
}

export function validateOcrQualityPolicy(policy: OcrQualityPolicy | undefined): void {
  if (!policy) return;
  if (policy.minConfidence !== undefined) {
    if (!Number.isFinite(policy.minConfidence) || policy.minConfidence < 0 || policy.minConfidence > 1) {
      throw new Error("OCR_QUALITY_POLICY_INVALID: minConfidence must be between 0 and 1");
    }
  }
  if (policy.minCharacters !== undefined) {
    if (!Number.isInteger(policy.minCharacters) || policy.minCharacters < 0) {
      throw new Error("OCR_QUALITY_POLICY_INVALID: minCharacters must be a non-negative integer");
    }
  }
}

export function assessOcrQuality(
  pageNumber: number,
  text: string,
  confidence: number | undefined,
  policy: OcrQualityPolicy | undefined,
): OcrQualityAssessment {
  validateOcrQualityPolicy(policy);
  const warnings: string[] = [];
  if (!policy) return { needsReview: false, warnings };

  if (
    policy.minConfidence !== undefined &&
    confidence !== undefined &&
    confidence < policy.minConfidence
  ) {
    warnings.push(
      `OCR_LOW_CONFIDENCE: Page ${pageNumber} engine confidence ${confidence.toFixed(2)} is below the review threshold ${policy.minConfidence.toFixed(2)}.`,
    );
  }

  const length = text.trim().length;
  if (policy.minCharacters !== undefined && length < policy.minCharacters) {
    warnings.push(
      `OCR_TEXT_TOO_SHORT: Page ${pageNumber} produced ${length} characters, below the review threshold ${policy.minCharacters}.`,
    );
  }

  return { needsReview: warnings.length > 0, warnings };
}

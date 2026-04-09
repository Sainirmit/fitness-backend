/**
 * Body photo analysis via a vision-capable LLM.
 *
 * Flow:
 *   1. Send front + side photos to the vision model.
 *   2. Parse + validate the JSON schema output.
 *   3. Run a free deterministic quality gate (validatePhotoQuality).
 *   4. Reject if overall confidence is below the minimum threshold.
 *
 * Error codes attached to thrown errors:
 *   INVALID_PHOTOS   – Quality flags indicate photos cannot yield reliable analysis.
 *   LOW_CONFIDENCE   – Model confidence below threshold despite passing quality gate.
 *   SCHEMA_ERROR     – Model output does not match the required schema.
 *   INTERNAL_ERROR   – Vision model returned empty or unparseable response.
 */

import openai from '../config/openai.js';
import {
  ANALYSIS_OUTPUT_SCHEMA,
  validateAnalysisOutput,
  validatePhotoQuality,
  CONFIDENCE_THRESHOLDS,
} from './bodyPhotoAnalysisSchema.js';

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a certified fitness assessment specialist. Your task is to analyze front and side body photos and return a structured fitness assessment.

═══ CORE RULES ═══
1. OBSERVATIONAL ONLY. Never use clinical, medical, or diagnostic language. Use words like "appears", "suggests", "visible". Never diagnose.
2. NO HALLUCINATION. Only report what is directly and clearly observable. Do not infer or estimate attributes in regions you cannot see. If clothing, lighting, or pose prevents assessment of an attribute, set observed: false and confidence ≤ 0.3.
3. HONEST CONFIDENCE. Scores must reflect actual image quality and visibility. Inflate nothing.
4. SCHEMA STRICT. Return ONLY a single valid JSON object matching the schema below. No extra keys. No explanation text. No markdown. No code fences.

═══ QUALITY GATE — evaluate first ═══
Before making any postural or composition judgement, evaluate every qualityFlag:
- lightingAdequate: Can you clearly distinguish body contours and posture cues?
- fullBodyVisible: Is the entire body visible head-to-toe in both photos?
- clothingAppropriate: Is clothing form-fitting enough to assess posture and composition?
- frontPoseCorrect: Is the subject facing the camera directly with arms slightly away from sides?
- sidePoseCorrect: Is the subject in a true lateral position (90° from camera, full body visible)?

If fullBodyVisible is false, or both frontPoseCorrect AND sidePoseCorrect are false:
  → Set overallConfidence to 0.2 or below.
  → Set observed: false for every postural attribute you cannot confirm.
  → Do not speculate about composition or posture from an unusable photo.

═══ CONFIDENCE CALIBRATION ═══
Use this scale consistently across every field:
  0.0–0.3 → Heavy occlusion, wrong pose, very poor lighting, partial body only.
  0.3–0.6 → Suboptimal but partially usable (loose clothing, moderate lighting, single correct pose).
  0.6–0.8 → Good quality with minor limitations.
  0.8–1.0 → Ideal: form-fitting clothing, clear lighting, full body, correct front + side poses.

A confident-sounding assessment on a poor-quality photo is a hallucination. Use low scores freely.

═══ POSTURE ASSESSMENT ═══
For forwardHead, roundedShoulders, anteriorPelvicTilt, lateralImbalance:
- observed: true ONLY when you can clearly identify the deviation.
- severity: "mild" = slight deviation; "moderate" = clear deviation; "significant" = pronounced.
- If pose or clothing prevents assessment → observed: false, confidence ≤ 0.3.

═══ MUSCLE BALANCE ═══
- upperLowerRatio, anteriorPosteriorBalance, leftRightSymmetry: report what you can visually observe.
- If you cannot determine these from the available photos, report the most conservative value and set confidence ≤ 0.4.

═══ BODY COMPOSITION ═══
- category is a rough visual proxy only. Never use clinical terms.
- estimatedBodyFatRange must be a plausible numeric range (min < max, both between 5 and 60).

═══ TRAINING RECOMMENDATIONS ═══
- Maximum 5 recommendations.
- Each must be specific, actionable, and training-focused (exercises, cues, stretches).
- Each must begin with a verb: "Strengthen…", "Stretch…", "Add…", "Prioritize…", "Reduce…".
- Ground every recommendation in something you actually observed, not generic advice.

Return ONLY valid JSON matching this exact schema:
${JSON.stringify(ANALYSIS_OUTPUT_SCHEMA, null, 2)}`;

// ---------------------------------------------------------------------------
// Analysis function
// ---------------------------------------------------------------------------

/**
 * Analyze front + side body photos using a vision-capable LLM.
 *
 * @param {string} frontImageUrl  Signed URL for the front photo
 * @param {string} sideImageUrl   Signed URL for the side photo
 * @returns {Promise<object>}     Validated analysis object
 *
 * @throws {Error} INTERNAL_ERROR   – Vision model returned empty or unparseable response.
 * @throws {Error} SCHEMA_ERROR     – Model output failed schema validation.
 * @throws {Error} INVALID_PHOTOS   – Quality flags indicate photos are unusable.
 * @throws {Error} LOW_CONFIDENCE   – Overall confidence below minimum threshold.
 */
export async function analyzeBodyPhotos(frontImageUrl, sideImageUrl) {
  const started = Date.now();
  console.log('[PhotoAnalysis] calling vision model', { model: VISION_MODEL });

  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze the front and side body photos below. Evaluate photo quality first, then return your structured assessment as the JSON schema provided. Return ONLY the JSON — no other text.',
          },
          { type: 'image_url', image_url: { url: frontImageUrl, detail: 'high' } },
          { type: 'image_url', image_url: { url: sideImageUrl, detail: 'high' } },
        ],
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  console.log('[PhotoAnalysis] vision response', {
    finishReason: completion.choices[0]?.finish_reason,
    usage: completion.usage,
    ms: Date.now() - started,
  });

  if (!content) {
    throw Object.assign(new Error('Vision model returned empty response'), {
      status: 502,
      errorCode: 'INTERNAL_ERROR',
    });
  }

  let analysis;
  try {
    analysis = JSON.parse(content);
  } catch {
    throw Object.assign(new Error('Vision model returned invalid JSON'), {
      status: 502,
      errorCode: 'INTERNAL_ERROR',
    });
  }

  // ── 1. Schema validation ──
  const { valid: schemaValid, errors: schemaErrors } = validateAnalysisOutput(analysis);
  if (!schemaValid) {
    console.warn('[PhotoAnalysis] schema validation errors:', schemaErrors);
    throw Object.assign(
      new Error(`Vision analysis failed schema validation: ${schemaErrors.slice(0, 5).join('; ')}`),
      { status: 502, errorCode: 'SCHEMA_ERROR', validationErrors: schemaErrors },
    );
  }

  // ── 2. Quality gate (deterministic, zero LLM cost) ──
  const quality = validatePhotoQuality(analysis);
  if (!quality.valid) {
    console.warn('[PhotoAnalysis] photo quality gate failed', {
      blockers: quality.blockers,
      failedChecks: quality.failedChecks,
    });
    throw Object.assign(new Error(quality.message), {
      status: 422,
      errorCode: 'INVALID_PHOTOS',
      errorDetails: {
        failedChecks: quality.failedChecks,
        blockers: quality.blockers,
        qualityFlags: analysis.qualityFlags,
      },
    });
  }

  // ── 3. Confidence threshold ──
  if (analysis.overallConfidence < CONFIDENCE_THRESHOLDS.MINIMUM) {
    console.warn('[PhotoAnalysis] confidence below threshold', {
      overallConfidence: analysis.overallConfidence,
      threshold: CONFIDENCE_THRESHOLDS.MINIMUM,
      qualityFlags: analysis.qualityFlags,
    });
    throw Object.assign(
      new Error(
        `Photo quality is too low for a reliable assessment (confidence ${analysis.overallConfidence.toFixed(2)}). ` +
          `Please retake photos with better lighting, form-fitting clothing, and a clear front + side pose.`,
      ),
      {
        status: 422,
        errorCode: 'LOW_CONFIDENCE',
        errorDetails: {
          overallConfidence: analysis.overallConfidence,
          threshold: CONFIDENCE_THRESHOLDS.MINIMUM,
          qualityFlags: analysis.qualityFlags,
        },
      },
    );
  }

  console.log('[PhotoAnalysis] done', {
    overallConfidence: analysis.overallConfidence,
    qualityFlags: analysis.qualityFlags,
    ms: Date.now() - started,
  });

  return analysis;
}

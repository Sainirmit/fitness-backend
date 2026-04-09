/**
 * Tests for rate-limit middleware profiles, refinement eligibility guard,
 * and the standardized API error envelope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── ApiError + formatErrorResponse ──────────────────────────────────────────

import {
  ApiError,
  generateRequestId,
  formatErrorResponse,
} from "../utils/apiError.js";

describe("ApiError utility", () => {
  it("creates a structured error with all fields", () => {
    const err = new ApiError(409, "CONFLICT", "Already exists", {
      retryable: false,
      details: { field: "email" },
      internal: "Mongo duplicate key on idx_email",
    });

    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("Already exists");
    expect(err.retryable).toBe(false);
    expect(err.details).toEqual({ field: "email" });
    expect(err.internalMessage).toBe("Mongo duplicate key on idx_email");
  });

  it("factory .internal() hides real message from client", () => {
    const err = ApiError.internal("OpenAI timeout after 30s");
    expect(err.status).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).not.toContain("OpenAI");
    expect(err.internalMessage).toBe("OpenAI timeout after 30s");
    expect(err.retryable).toBe(true);
  });

  it("factory .tooMany() returns 429 RATE_LIMITED", () => {
    const err = ApiError.tooMany();
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryable).toBe(true);
  });

  it("factory .notFound() returns 404", () => {
    const err = ApiError.notFound("Photo set not found.");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("generateRequestId", () => {
  it("returns a hex string of 16 chars", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe("formatErrorResponse", () => {
  const reqId = "abc123";

  it("formats ApiError with code, message, retryable, requestId", () => {
    const err = ApiError.conflict("Duplicate", "DUPLICATE_VALUE");
    const body = formatErrorResponse(err, reqId);

    expect(body).toEqual({
      code: "DUPLICATE_VALUE",
      message: "Duplicate",
      retryable: false,
      requestId: reqId,
    });
  });

  it("formats ApiError with details when present", () => {
    const err = new ApiError(400, "BAD_REQUEST", "Invalid", {
      details: { fields: ["email"] },
    });
    const body = formatErrorResponse(err, reqId);
    expect(body.details).toEqual({ fields: ["email"] });
  });

  it("formats Mongoose ValidationError", () => {
    const err = {
      name: "ValidationError",
      errors: {
        age: { message: "age must be positive" },
        weight: { message: "weight is required" },
      },
    };
    const body = formatErrorResponse(err, reqId);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("age must be positive");
    expect(body.message).toContain("weight is required");
    expect(body.retryable).toBe(false);
  });

  it("formats Mongoose CastError", () => {
    const err = { name: "CastError", path: "userId" };
    const body = formatErrorResponse(err, reqId);
    expect(body.code).toBe("INVALID_PARAMETER");
    expect(body.message).toContain("userId");
  });

  it("formats MongoDB duplicate key (code 11000)", () => {
    const err = { code: 11000, keyValue: { email: "a@b.com" } };
    const body = formatErrorResponse(err, reqId);
    expect(body.code).toBe("DUPLICATE_VALUE");
    expect(body.message).toContain("email");
  });

  it("never leaks raw message for unknown 500 errors", () => {
    const err = new Error("Connection to OpenAI timed out");
    const body = formatErrorResponse(err, reqId);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).not.toContain("OpenAI");
    expect(body.retryable).toBe(true);
    expect(body.requestId).toBe(reqId);
  });

  it("passes through message for known client errors (status < 500)", () => {
    const err = Object.assign(new Error("Plan not found"), { status: 404 });
    const body = formatErrorResponse(err, reqId);
    expect(body.code).toBe("ERROR");
    expect(body.message).toBe("Plan not found");
    expect(body.retryable).toBe(false);
  });
});

// ── Refinement eligibility guard ────────────────────────────────────────────

describe("checkRefinementEligibility", () => {
  let checkRefinementEligibility;
  let WorkoutPlanMock;

  beforeEach(async () => {
    vi.resetModules();

    WorkoutPlanMock = {
      _findOneResults: [],
      _callIndex: 0,
      findOne() {
        const result = WorkoutPlanMock._findOneResults[WorkoutPlanMock._callIndex++];
        const chain = {
          sort: () => chain,
          select: () => chain,
          lean: () => Promise.resolve(result ?? null),
        };
        return chain;
      },
    };

    vi.doMock("../models/WorkoutPlan.js", () => ({
      default: WorkoutPlanMock,
    }));

    const mod = await import("../middleware/refinementGuard.js");
    checkRefinementEligibility = mod.checkRefinementEligibility;
  });

  it("returns eligible when no active plan exists", async () => {
    WorkoutPlanMock._findOneResults = [null];
    const result = await checkRefinementEligibility("user123");
    expect(result.eligible).toBe(true);
  });

  it("returns eligible when active plan has no endDate", async () => {
    WorkoutPlanMock._findOneResults = [
      { _id: "plan1", startDate: new Date(), endDate: null },
    ];
    const result = await checkRefinementEligibility("user123");
    expect(result.eligible).toBe(true);
  });

  it("returns eligible when plan window has passed", async () => {
    const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
    WorkoutPlanMock._findOneResults = [
      { _id: "plan1", startDate: new Date("2026-01-01"), endDate: pastEnd },
    ];
    const result = await checkRefinementEligibility("user123");
    expect(result.eligible).toBe(true);
  });

  it("returns eligible when active plan exists but no refinement yet", async () => {
    const futureEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    WorkoutPlanMock._findOneResults = [
      { _id: "plan1", startDate: new Date(), endDate: futureEnd },
      null,
    ];
    const result = await checkRefinementEligibility("user123");
    expect(result.eligible).toBe(true);
  });

  it("returns ineligible when refinement already used in current window", async () => {
    const futureEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    WorkoutPlanMock._findOneResults = [
      { _id: "plan1", startDate: new Date(), endDate: futureEnd },
      { _id: "refined1" },
    ];
    const result = await checkRefinementEligibility("user123");
    expect(result.eligible).toBe(false);
    expect(result.code).toBe("REFINEMENT_ALREADY_USED");
    expect(result.retryAfter).toBeTruthy();
  });
});

// ── Rate-limit middleware profiles ──────────────────────────────────────────

describe("rate-limit middleware exports", () => {
  it("exports all named limiter functions", async () => {
    const mod = await import("../middleware/rateLimit.js");
    expect(typeof mod.globalApiLimiter).toBe("function");
    expect(typeof mod.authLimiter).toBe("function");
    expect(typeof mod.aiGenerationLimiter).toBe("function");
    expect(typeof mod.photoUploadLimiter).toBe("function");
    expect(typeof mod.pollingLimiter).toBe("function");
  });
});

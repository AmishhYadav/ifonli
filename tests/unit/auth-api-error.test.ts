import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { authErrorStatus, isAuthApiError } from "@/server/auth/api-error";

describe("isAuthApiError", () => {
  it("recognises Better Auth errors, including a copy of the class from before a hot reload", () => {
    expect(isAuthApiError(new APIError("UNAUTHORIZED", { message: "Invalid email or password" }))).toBe(true);
    const otherCopy = Object.assign(new Error("Invalid email or password"), { name: "APIError", statusCode: 401 });
    expect(isAuthApiError(otherCopy)).toBe(true);
    expect(authErrorStatus(otherCopy)).toBe(401);
  });

  it("does not swallow other errors", () => {
    expect(isAuthApiError(new Error("connection terminated"))).toBe(false);
    expect(isAuthApiError(new TypeError("x"))).toBe(false);
    expect(isAuthApiError("APIError")).toBe(false);
    expect(authErrorStatus(null)).toBeNull();
  });
});

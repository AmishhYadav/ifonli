import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth/auth";

/**
 * Better Auth HTTP handler (email OTP for customers, the admin plugin's endpoints and the
 * two-factor endpoints). Resolved per request so building never needs a database or secret.
 * Admin sign-in itself goes through the Server Actions in `src/app/admin/(auth)/actions.ts`.
 */
export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request);

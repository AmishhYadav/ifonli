import { z } from "zod";

/**
 * Side-effect module: import it BEFORE any schema is constructed in code that also ships to the
 * browser (checkout form, admin forms). Zod 4 probes `new Function("")` to decide whether it may
 * compile a fast-path parser; with a Content-Security-Policy that blocks eval the browser reports the
 * (caught) probe as a violation. In the browser we run the interpreter instead: forms validate a few
 * fields, so the lost speed is irrelevant. The server keeps the JIT.
 */
if (typeof window !== "undefined") z.config({ jitless: true });

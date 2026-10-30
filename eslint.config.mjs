import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // No raw hex colours in components: colours come from design tokens (src/features/vibe/tokens.ts).
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["src/features/vibe/tokens.ts", "src/app/dev/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "Raw hex colour in a string. Use a design token (bg-surface, text-ink, var(--accent)...).",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Raw hex colour in a template string. Use a design token.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

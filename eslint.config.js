import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Flat ESLint config (v0.5). Lean on purpose: TypeScript recommended rules
 * (non-type-checked, to stay fast and avoid churn) plus the React Hooks
 * rules. Scoped to the publishable library (`src`) and the demo — the
 * legacy `components/`/`shared/` reference files (pre-extraction Minuta
 * code, not in tsconfig) are out of scope.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "demo/dist/**", "node_modules/**", "coverage/**", "components/**", "shared/**", "scripts/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "demo/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Allow `_`-prefixed discards (rest-destructuring to omit a key).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);

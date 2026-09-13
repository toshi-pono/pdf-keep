import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "output/**",
      "tmp/**",
      "docs/work/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Figma mocks and low-level font/WASM adapters expose dynamic structures.
      "@typescript-eslint/no-explicit-any": "off",
      // The Figma sandbox targets ES2020, before ErrorOptions.cause.
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  prettier,
);

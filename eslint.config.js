import parser from "@typescript-eslint/parser";
import plugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": plugin },
    rules: {
      ...plugin.configs["eslint-recommended"].overrides?.[0]?.rules,
      ...plugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
];

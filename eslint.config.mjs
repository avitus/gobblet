import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Package boundary rules (see docs/architecture.md):
 * - packages/game-core must stay pure: no network, database, UI or nondeterministic APIs.
 * - packages/protocol must not depend on runtime infrastructure.
 */
const GAME_CORE_FORBIDDEN_IMPORTS = [
  {
    group: ["react", "react-dom", "react/*", "react-dom/*"],
    message: "game-core must not depend on UI libraries.",
  },
  {
    group: ["three", "@react-three/*"],
    message: "game-core must not depend on rendering libraries.",
  },
  {
    group: ["socket.io", "socket.io-client", "ws"],
    message: "game-core must not depend on transports.",
  },
  { group: ["fastify", "fastify/*"], message: "game-core must not depend on the HTTP framework." },
  {
    group: ["pg", "drizzle-orm", "drizzle-orm/*", "@gobblet/db"],
    message: "game-core must not depend on persistence.",
  },
  {
    group: ["zod"],
    message: "game-core must stay dependency free; validation belongs to @gobblet/protocol.",
  },
  {
    group: ["node:*"],
    message: "game-core must not depend on Node built-ins so it runs unchanged in the browser.",
  },
  {
    group: ["@gobblet/*"],
    message: "game-core is the lowest layer and must not import other workspace packages.",
  },
];

/**
 * A workspace package is reached through its `exports` surface only, including the
 * browser-only packages that ship TypeScript source (see ADR-0016 and ADR-0024).
 */
const WORKSPACE_DEEP_IMPORTS = [
  {
    group: ["@gobblet/*/src", "@gobblet/*/src/*", "@gobblet/*/dist", "@gobblet/*/dist/*"],
    message: "Import a workspace package through its exports surface, not by file path.",
  },
];

/** The server renders nothing (see docs/architecture.md section 6). */
const SERVER_FORBIDDEN_IMPORTS = [
  ...WORKSPACE_DEEP_IMPORTS,
  {
    group: [
      "react",
      "react-dom",
      "react/*",
      "react-dom/*",
      "three",
      "@react-three/*",
      "@gobblet/game-ui",
      "@gobblet/design-system",
    ],
    message: "The server must not depend on client rendering packages.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/src-tauri/target/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "*.js", "scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-coercion": "error",
      "prefer-const": "error",
      "no-restricted-imports": ["error", { patterns: WORKSPACE_DEEP_IMPORTS }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.recommendedTypeChecked],
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["packages/game-core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: GAME_CORE_FORBIDDEN_IMPORTS }],
      "no-restricted-globals": [
        "error",
        {
          name: "Date",
          message: "game-core must not read wall-clock time; pass time in as an argument.",
        },
        { name: "performance", message: "game-core must be deterministic." },
        { name: "crypto", message: "game-core must be deterministic." },
        { name: "fetch", message: "game-core must not perform I/O." },
        { name: "process", message: "game-core must not read the environment." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "game-core must be deterministic; randomness is supplied by callers.",
        },
        {
          selector: "MemberExpression[object.name='Date']",
          message: "game-core must not read wall-clock time.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "game-core must not read wall-clock time.",
        },
      ],
    },
  },
  {
    files: ["apps/server/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: SERVER_FORBIDDEN_IMPORTS }],
    },
  },
  {
    files: [
      "apps/web/**/*.ts",
      "apps/web/**/*.tsx",
      "packages/design-system/**/*.ts",
      "packages/design-system/**/*.tsx",
      "packages/game-ui/**/*.ts",
      "packages/game-ui/**/*.tsx",
    ],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**/*.ts", "**/test/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  {
    files: ["**/*.mjs", "**/*.js", "scripts/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);

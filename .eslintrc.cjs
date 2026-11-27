/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client", "build/", ".react-router/"],
  extends: ["eslint:recommended"],
  globals: {
    shopify: "readonly",
  },
  rules: {
    "no-empty": ["error", { allowEmptyCatch: true }],
    // CSV exports and theme files start with a byte-order mark on purpose.
    "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipRegExps: true }],
    "no-unused-vars": ["warn", { args: "none" }],
  },
  overrides: [
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: { version: "detect" },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": { typescript: {} },
      },
      rules: {
        "react/prop-types": "off",
        "react/no-unescaped-entities": "off",
        "jsx-a11y/no-static-element-interactions": "warn",
        "jsx-a11y/interactive-supports-focus": "warn",
        "jsx-a11y/click-events-have-key-events": "warn",
        "jsx-a11y/no-autofocus": "off",
        "react/no-unknown-property": ["error", { ignore: ["slot", "variant", "loading", "commandFor", "command", "interestFor"] }],
      },
    },
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: { extensions: [".ts", ".tsx"] },
          typescript: { alwaysTryTypes: true },
        },
      },
      extends: ["plugin:@typescript-eslint/recommended", "plugin:import/recommended", "plugin:import/typescript"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      },
    },
    {
      files: [".eslintrc.cjs", "*.config.{js,cjs,mjs}", "ecosystem.config.cjs"],
      env: { node: true },
    },
  ],
};

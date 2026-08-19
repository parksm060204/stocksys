import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "engine-server/dist/**",
    "scratch.js",
    "scratch_*.js",
    "engine-server/check_dups.js",
    "engine-server/purge-all-orders.ts",
    "engine-server/purge-lp-orders.ts",
    "engine-server/check-db.ts",
    ".github/**",
    ".agents/**",
    ".agent/**",
    ".codex/**",
    ".gemini/**",
    ".impeccable/**",
    "vm-db/**",
  ]),
  // 치명적이지 않고, 실무에서 널리 허용되는 rule들을 비활성화 또는 조정.
  // - no-explicit-any: 주로 bot config / supabase 응답 디코딩에 사용되어 엄격한 타입 정의가 비효율적.
  // - set-state-in-effect: React 19에서 도입된 rule로, 일반적인 데이터 로딩 패턴을 차단하지 않도록 off.
  // - unused-vars: 매개변수/변수명이 _ 접두사로 시작하면 unused 로 취급하지 않음 (함수 시그니처 호환성 유지용).
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;

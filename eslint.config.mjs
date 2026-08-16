import nextTs from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

const syntaxRules = [
  {
    selector: 'JSXOpeningElement[name.name="head"]',
    message:
      '禁止使用 head 标签，优先使用 metadata。三方 CSS、字体等资源可以在 globals.css 中顶部通过 @import 引入或者使用 next/font；preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入；json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld',
  },
];

const nextConfigRestrictedSyntaxRules = [
  {
    selector:
      'Property[key.name=/^(root|outputFileTracingRoot)$/] > Literal[value=/^\\//]',
    message:
      '禁止在 next.config 中写死绝对路径，请改用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。',
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'no-restricted-syntax': ['error', ...syntaxRules],
    },
  },
  {
    files: ['next.config.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...nextConfigRestrictedSyntaxRules],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build artifacts:
    'server.js',
    'dist/**',
    'dist-workers/**',
    '.tmp/**',
    // 走查/调试临时脚本（CommonJS，非交付代码）:
    'tmp/**',
    // Script files (CommonJS):
    'scripts/**/*.js',
    // Boss search skill assets (Python venv, generated resumes, worker scripts):
    'assets/**',
  ]),
]);

export default eslintConfig;

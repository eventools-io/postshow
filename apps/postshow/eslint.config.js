import baseConfig from '@eventools/config/eslint';

export default [
  ...baseConfig,
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'vitest.setup.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in test files for mocking
    },
  },
  {
    files: ['**/*.config.ts'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
      },
    },
  },
  {
    ignores: ['dist', 'node_modules', '.turbo'],
  },
];

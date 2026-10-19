// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@murmur/shared',
              message: 'Import from "@murmur/shared/client": the main entry pulls zod (~0.5 MB) into the app bundle.',
            },
          ],
        },
      ],
    },
  },
]);

const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  { ignores: ['dist/'] },
  // Any other config imports go at the top
  eslintPluginPrettierRecommended,
];

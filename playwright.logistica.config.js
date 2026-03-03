const baseConfig = require('./playwright.config');

module.exports = {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: undefined
};

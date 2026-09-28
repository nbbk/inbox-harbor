const { defineConfig } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  workers: 1,
  timeout: 30000,
  use: { baseURL: process.env.INBOXHARBOR_TEST_URL || 'http://127.0.0.1:5555', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['line'], ['html', {open:'never'}]],
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:5555',
    reuseExistingServer: !process.env.CI,
    env: {
      DATA_DIR: process.env.INBOXHARBOR_TEST_DATA_DIR || path.join(os.tmpdir(), 'inboxharbor-e2e-' + process.pid),
      HOST: '127.0.0.1', PORT: '5555', NODE_ENV: 'test',
      INBOXHARBOR_ADMIN_TOKEN: process.env.INBOXHARBOR_ADMIN_TOKEN || 'qa-local-token',
      AUTH_RATE_LIMIT: '1000'
    }
  }
});

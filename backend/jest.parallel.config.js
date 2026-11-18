/**
 * Every backend test file except the schema-changing ones, in parallel
 * workers. Those run afterwards, alone: see jest.serial-files.js.
 * The base config stays in package.json, so `npx jest <file>` still runs any
 * single file, serial-listed or not.
 */
const base = require('./package.json').jest;
const { SERIAL_TEST_FILES } = require('./jest.serial-files');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  ...base,
  testPathIgnorePatterns: [
    '/node_modules/',
    ...SERIAL_TEST_FILES.map((file) => `/${escape(file)}$`),
  ],
};

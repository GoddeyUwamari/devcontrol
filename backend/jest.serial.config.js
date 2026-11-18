/**
 * Only the schema-changing backend test files (jest.serial-files.js). Run it
 * with --runInBand, after the parallel run, so no other file holds locks on
 * the tables these files ALTER, DROP or roll back.
 */
const base = require('./package.json').jest;
const { SERIAL_TEST_FILES } = require('./jest.serial-files');

module.exports = {
  ...base,
  testMatch: SERIAL_TEST_FILES.map((file) => `<rootDir>/${file}`),
};

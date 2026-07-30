// Runs every *.test.js file in this directory. No dependencies, no runner
// binary — just `node test/run.js`.
const fs = require('fs');
const path = require('path');

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const file of files) {
  require(path.join(__dirname, file));
}

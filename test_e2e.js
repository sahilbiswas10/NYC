// Run only against a temporary app, database and storage; never the configured LMS.
const { spawn } = require('node:child_process');
const path = require('node:path');
const child = spawn(process.execPath, ['--test', path.join(__dirname, 'tests/e2e.test.js')], {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit'
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code === 0 ? 0 : 1; });

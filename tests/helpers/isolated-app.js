const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const root = path.resolve(__dirname, '../..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = async () => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
};
const startProcess = (command, args, options) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    child.output = '';
    child.on('error', (error) => { child.startError = error; });
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (data) => { child.output = (child.output + data.toString()).slice(-10000); });
    }
    return child;
};
const stopProcess = async (child) => {
    if (!child || child.exitCode !== null || child.signalCode || child.startError) return;
    child.kill('SIGTERM');
    const exited = once(child, 'exit').catch(() => {});
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && !child.signalCode) {
        child.kill('SIGKILL');
        await exited;
    }
};
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
    const child = startProcess(command, args, options);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${child.output}`)));
});

// Every run has its own MongoDB process, source copy, secrets and storage. Never
// reads .env or connects to a configured/production database.
exports.startIsolatedApp = async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nyc-lms-audit-'));
    const appRoot = path.join(directory, 'app');
    let mongo;
    let server;
    let db;
    const close = async () => {
        await stopProcess(server);
        if (db) await db.close();
        await stopProcess(mongo);
        await fs.rm(directory, { recursive: true, force: true });
    };
    try {
        await fs.mkdir(appRoot);
        await Promise.all(['backend', 'frontend'].map((name) => fs.cp(path.join(root, name), path.join(appRoot, name), {
            recursive: true, filter: (source) => path.basename(source) !== '.jwt-secret'
        })));
        await fs.symlink(path.join(root, 'node_modules'), path.join(appRoot, 'node_modules'), 'dir');
        await fs.mkdir(path.join(directory, 'db'));
        const mongoPort = await freePort();
        const appPort = await freePort();
        const mongoUri = `mongodb://127.0.0.1:${mongoPort}/nyc_audit`;
        mongo = startProcess(process.env.NYC_TEST_MONGOD || 'mongod', [
            '--dbpath', path.join(directory, 'db'), '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--nounixsocket', '--quiet'
        ]);
        for (let i = 0; i < 100; i++) {
            if (mongo.startError || mongo.exitCode !== null) throw new Error(`Isolated MongoDB could not start: ${mongo.startError?.message || mongo.output}`);
            try {
                db = await mongoose.createConnection(mongoUri, { serverSelectionTimeoutMS: 200 }).asPromise();
                break;
            } catch { await delay(100); }
        }
        if (!db) throw new Error('Timed out starting isolated MongoDB');
        // Explicit environment: paid provider credentials and real MONGO_URI are
        // deliberately excluded. No external payment request can be made.
        const env = {
            PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
            NODE_ENV: 'test', PORT: String(appPort), MONGO_URI: mongoUri,
            JWT_SECRET: crypto.randomBytes(48).toString('hex'),
            MAX_UPLOAD_SIZE_MB: '1', MAX_CONCURRENT_JOBS: '2'
        };
        server = startProcess(process.execPath, ['backend/server.js'], { cwd: appRoot, env });
        const baseUrl = `http://127.0.0.1:${appPort}`;
        for (let i = 0; i < 100; i++) {
            if (server.startError || server.exitCode !== null) throw new Error(`Isolated LMS could not start: ${server.startError?.message || server.output}`);
            try {
                const response = await fetch(`${baseUrl}/api/health`);
                if (response.ok) return { baseUrl, appRoot, directory, db, close, server, run, delay };
            } catch {}
            await delay(100);
        }
        throw new Error(`Isolated LMS did not become healthy: ${server.output}`);
    } catch (error) {
        await close();
        throw error;
    }
};

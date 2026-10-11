const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load only the module under test; no server, MongoDB, or user media is touched.
const load = (file, dependencies = {}, globals = {}) => {
    const filename = path.resolve(__dirname, '..', file);
    const module = { exports: {} };
    const context = vm.createContext({
        module, exports: module.exports, __dirname: path.dirname(filename),
        require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
        console, Buffer, process, AbortController, setTimeout, clearTimeout, ...globals
    });
    new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
    return module.exports;
};

const select = (data) => ({ select: () => Promise.resolve(data) });
const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {},
    sendFile(filename) { this.filename = filename; }
});
const mediaId = '0123456789abcdef01234567';

test('shared lesson media authorizes any enrolled course and its owning instructor', async () => {
    const courses = [{ _id: 'first', instructor: 'other' }, { _id: 'second', instructor: 'owner' }];
    const lessons = [{ course: 'first' }, { course: 'second' }];
    const access = load('backend/utils/mediaAccess.js', {
        '../models/Lesson': { findOne: () => select(lessons[0]), find: () => select(lessons) },
        '../models/Course': {
            findById: () => select(courses[0]), findOne: () => select(null), find: () => select(courses)
        },
        '../models/Enrollment': {
            exists: (query) => Boolean(query.course?.$in?.includes('second') || query.course === 'second')
        }
    });
    assert.equal(await access.canStreamMedia({ _id: mediaId }, { id: 'student', role: 'student' }), true);
    assert.equal(await access.canStreamMedia({ _id: mediaId }, { id: 'owner', role: 'instructor' }), true);
    assert.equal(await access.canManageMedia({ _id: mediaId }, { id: 'owner', role: 'instructor' }), true);
    assert.equal(await access.canStreamMedia({ _id: mediaId }, { id: 'outsider', role: 'instructor' }), false);
    assert.equal(await access.canStreamMedia({ _id: mediaId }, null), false);
});

test('published demo placement remains accessible when media is also in a lesson', async () => {
    const courses = [{ _id: 'course', instructor: 'owner', status: 'published', demoVideo: mediaId }];
    const access = load('backend/utils/mediaAccess.js', {
        '../models/Lesson': { findOne: () => select({ course: 'course' }), find: () => select([{ course: 'course' }]) },
        '../models/Course': { findById: () => select(courses[0]), findOne: () => select(courses[0]), find: () => select(courses) },
        '../models/Enrollment': { exists: () => false }
    });
    assert.equal(await access.canStreamMedia({ _id: mediaId }, null), true);
    assert.equal(await access.canStreamMedia({ _id: mediaId }, { id: 'unenrolled', role: 'student' }), true);
});

const stream = (promises = {}) => load('backend/controllers/streamController.js', {
    '../models/Media': { findById: async () => ({ _id: mediaId, processingStatus: 'ready', hlsManifestPath: path.resolve(__dirname, '../storage/hls', mediaId, 'master.m3u8') }) },
    '../utils/mediaAccess': { canStreamMedia: async () => true },
    '../config/jwt': 'a-test-key-that-never-loads-the-project-secret',
    mongoose: { isValidObjectId: (id) => /^[a-f\d]{24}$/i.test(id) },
    fs: { constants: fs.constants, promises: {
        access: async () => {}, realpath: async (filename) => filename, ...promises
    } }
});

test('segment delivery rejects traversal and files outside the generated segment format', async () => {
    const controller = stream();
    for (const filename of ['../secret.ts', 'master.m3u8', 'secret.txt', '.', '..', 'segment_00000.ts/other', 'segment_00000.ts%00']) {
        const res = response();
        await controller.getSegment({ params: { mediaId, filename } }, res);
        assert.equal(res.statusCode, 400, filename);
        assert.equal(res.filename, undefined, filename);
    }
    const res = response();
    await controller.getSegment({ params: { mediaId, filename: 'segment_00000.ts' } }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.filename.endsWith('segment_00000.ts'));
});

test('segment delivery rejects a file symlink escaping its media directory', async () => {
    const controller = stream({ realpath: async (filename) => filename.endsWith('.ts') ? '/private/tmp/outside.ts' : filename });
    const res = response();
    await controller.getSegment({ params: { mediaId, filename: 'segment_00000.ts' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.filename, undefined);
});

test('stream tickets cannot authenticate another media through the bearer path', async () => {
    const middleware = load('backend/middleware/streamAuth.js', {
        jsonwebtoken: { verify: () => ({ id: 'user', purpose: 'hls', mediaId: 'different-media' }) },
        '../models/User': { findById: () => select({ id: 'user', role: 'student' }) },
        '../config/jwt': 'test-key'
    });
    const res = response();
    let next = false;
    await middleware({ headers: { authorization: 'Bearer scoped-ticket' }, params: { mediaId } }, res, () => { next = true; });
    assert.equal(next, false);
    assert.equal(res.statusCode, 401);
});

test('normal login cookie and a matching public ticket support native HLS requests', async () => {
    const middleware = load('backend/middleware/streamAuth.js', {
        jsonwebtoken: { verify: (token) => token === 'login' ? { id: 'user' } : { purpose: 'hls', mediaId, publicPreview: true } },
        '../models/User': { findById: () => select({ id: 'user', role: 'student' }) },
        '../config/jwt': 'test-key'
    });
    for (const cookie of ['token=login', 'streamTicket=public']) {
        let next = false;
        const res = response();
        await middleware({ headers: { cookie }, params: { mediaId } }, res, () => { next = true; });
        assert.equal(next, true, cookie);
    }
});

test('queue preserves standalone ready uploads after processing and limits active jobs', async () => {
    const running = new Map();
    const timers = [];
    const cleaned = [];
    const queue = load('backend/utils/queueManager.js', {
        '../models/Media': { findById: async (id) => ({ _id: id, processingStatus: 'ready' }) },
        '../workers/mediaProcessor': { processMedia: (id) => new Promise((resolve) => { running.set(id, resolve); }) },
        './mediaCleanup': { isCleanupPending: () => false, cleanupMedia: async (media) => { cleaned.push(media._id); } }
    }, { process: { env: { MAX_CONCURRENT_JOBS: '2' } }, setTimeout: (callback) => { timers.push(callback); return { unref() {} }; } });
    queue.addToQueue('one'); queue.addToQueue('one'); queue.addToQueue('two'); queue.addToQueue('three');
    assert.equal(running.size, 2);
    running.get('one')();
    await new Promise(setImmediate);
    assert.equal(running.size, 3);
    for (const callback of timers) await callback();
    assert.deepEqual(cleaned, []);
    running.get('two')(); running.get('three')();
    await new Promise(setImmediate);
});

test('cleanup preserves referenced/shared files and defers detached media until processing ends', async () => {
    let referenced = false;
    let shared = true;
    const removed = [];
    const cleanup = load('backend/utils/mediaCleanup.js', {
        'fs/promises': { rm: async (filename) => { removed.push(filename); }, realpath: async (filename) => filename },
        '../models/Lesson': { exists: async () => referenced },
        '../models/Course': { exists: async () => false },
        '../models/Media': { exists: async () => shared, findById: async () => media }
    });
    let deleted = 0;
    const media = { _id: mediaId, processingStatus: 'processing', originalPath: path.resolve(__dirname, '../storage/originals/shared.mp4'), deleteOne: async () => { deleted++; } };
    assert.equal(await cleanup.cleanupMedia(media), false);
    assert.equal(cleanup.isCleanupPending(mediaId), true);
    media.processingStatus = 'ready';
    referenced = true;
    await cleanup.cleanupMedia(media);
    assert.equal(deleted, 0);
    referenced = false;
    await cleanup.cleanupMedia(media);
    assert.equal(deleted, 1);
    assert.equal(removed.some((filename) => filename.endsWith('shared.mp4')), false);
    shared = false;
});

test('cleanup does not remove an original reached through a symlink outside originals storage', async () => {
    const removed = [];
    const cleanup = load('backend/utils/mediaCleanup.js', {
        'fs/promises': { rm: async (filename) => { removed.push(filename); }, realpath: async (filename) => filename.endsWith('.mp4') ? '/private/tmp/outside.mp4' : filename },
        '../models/Lesson': { exists: async () => false },
        '../models/Course': { exists: async () => false },
        '../models/Media': { exists: async () => false }
    });
    const media = { _id: mediaId, processingStatus: 'ready', originalPath: path.resolve(__dirname, '../storage/originals/link/other.mp4'), deleteOne: async () => {} };
    await cleanup.cleanupMedia(media);
    assert.equal(removed.some((filename) => filename.endsWith('other.mp4')), false);
});

test('native HLS renews its short ticket during playback and destroy cancels renewal', async () => {
    const listeners = new Map();
    const timers = new Map();
    let timerId = 0;
    const requests = [];
    const video = {
        canPlayType: () => 'probably',
        addEventListener: (event, callback) => { listeners.set(event, callback); },
        removeEventListener: (event) => { listeners.delete(event); },
        pause() {}, getAttribute() { return this.url; }, removeAttribute() { this.url = null; }, load() {},
        set src(url) { this.url = url; queueMicrotask(() => listeners.get('loadedmetadata')?.()); }
    };
    const window = {};
    load('frontend/js/streaming.js', {}, {
        window, document: { getElementById: () => video },
        localStorage: { getItem: () => null },
        fetch: async (url, options) => { requests.push({ url, options }); return { ok: true }; },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: (id) => timers.delete(id)
    });
    const player = new window.StreamingPlayer('video');
    await player.loadManifest(mediaId);
    assert.equal(requests.length, 1);
    assert.equal(timers.size, 1);
    const renewal = [...timers.values()][0];
    assert.ok(renewal.delay < 300_000);
    timers.clear();
    await renewal.callback();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].url.includes('token='), false);
    player.destroy();
    assert.equal(timers.size, 0);
});

test('worker rejects original symlink escapes before calling FFprobe', async () => {
    let probed = false;
    const media = { _id: mediaId, originalPath: path.resolve(__dirname, '../storage/originals/link.mp4'), save: async () => {} };
    const { processMedia } = load('backend/workers/mediaProcessor.js', {
        '../models/Media': { findById: async () => media },
        'fluent-ffmpeg': { ffprobe: (_filename, callback) => { probed = true; callback(new Error('must not run')); } },
        fs: { constants: fs.constants, promises: {
            realpath: async (filename) => filename.endsWith('.mp4') ? '/private/tmp/external.mp4' : filename,
            access: async () => {}, rm: async () => {}
        } }
    });
    await assert.rejects(processMedia(mediaId), /Original media path is invalid/);
    assert.equal(probed, false);
    assert.equal(media.processingStatus, 'failed');
});

test('upload signature validation accepts WAV and removes a renamed non-media file', async () => {
    const directory = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'nyc-media-validation-'));
    try {
        const validate = load('backend/middleware/validateMediaUpload.js');
        for (const [name, contents, expected] of [
            ['valid.wav', Buffer.from('RIFF\x04\x00\x00\x00WAVEfmt '), 200],
            ['renamed.mp4', Buffer.from('this is not a video'), 400]
        ]) {
            const filename = path.join(directory, name);
            await fs.promises.writeFile(filename, contents);
            const res = response();
            let continued = false;
            await validate({ file: { path: filename, originalname: name } }, res, () => { continued = true; });
            assert.equal(res.statusCode, expected);
            assert.equal(continued, expected === 200);
            assert.equal(fs.existsSync(filename), expected === 200);
        }
    } finally {
        await fs.promises.rm(directory, { recursive: true, force: true });
    }
});

test('delete reports a conflict if media becomes referenced before final cleanup', async () => {
    const controller = load('backend/controllers/mediaController.js', {
        '../models/Media': { findById: async () => ({ _id: mediaId, processingStatus: 'ready' }) },
        '../models/Lesson': { exists: async () => false },
        '../models/Course': { exists: async () => false },
        '../utils/mediaAccess': { canManageMedia: async () => true },
        '../utils/mediaCleanup': { cleanupMedia: async () => false },
        mongoose: { isValidObjectId: () => true }
    });
    const res = response();
    await controller.deleteMedia({ params: { id: mediaId }, user: { id: 'admin', role: 'admin' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
});

test('upload restricts declared formats and extensions, size, and generated filenames', async () => {
    let options;
    const multer = (config) => { options = config; return config; };
    multer.diskStorage = (config) => config;
    load('backend/middleware/upload.js', {
        multer,
        fs: { existsSync: () => true },
        crypto: { randomUUID: () => 'test-generated-id' }
    }, { process: { env: { MAX_UPLOAD_SIZE_MB: '1' } } });
    assert.equal(options.limits.fileSize, 1024 * 1024);
    let accepted;
    options.fileFilter({}, { originalname: 'clip.mp4', mimetype: 'video/mp4' }, (error, valid) => { accepted = !error && valid; });
    assert.equal(accepted, true);
    options.fileFilter({}, { originalname: 'script.js', mimetype: 'video/mp4' }, (error, valid) => { accepted = !error && valid; });
    assert.equal(accepted, false);
    let filename;
    options.storage.filename({}, { originalname: '../../user-file.MP4' }, (_error, value) => { filename = value; });
    assert.equal(filename, 'media-test-generated-id.mp4');
});

test('recovery rejects HLS paths, unexpected extensions, and escaped segment symlinks', async () => {
    const root = path.resolve(__dirname, '../storage/hls');
    const manifestPath = path.join(root, mediaId, 'master.m3u8');
    let segment = 'segment_00000.ts';
    let escaped = false;
    const queue = load('backend/utils/queueManager.js', {
        '../models/Media': {},
        '../workers/mediaProcessor': {},
        'fs/promises': {
            constants: fs.constants,
            readFile: async () => `#EXTM3U\n${segment}\n`, access: async () => {},
            realpath: async (filename) => escaped && filename.endsWith('.ts') ? '/private/tmp/outside.ts' : filename
        }
    });
    const media = { _id: mediaId, hlsManifestPath: manifestPath };
    assert.equal(await queue.hasValidHls(media), true);
    segment = 'secret.txt';
    assert.equal(await queue.hasValidHls(media), false);
    segment = '../segment_00000.ts';
    assert.equal(await queue.hasValidHls(media), false);
    segment = 'segment_00000.ts'; escaped = true;
    assert.equal(await queue.hasValidHls(media), false);
    assert.equal(await queue.hasValidHls({ _id: '../outside', hlsManifestPath: manifestPath }), false);
});

test('queue runs cleanup only for explicitly detached processing media', async () => {
    const cleaned = [];
    let finish;
    const queue = load('backend/utils/queueManager.js', {
        '../models/Media': { findById: async (id) => ({ _id: id, processingStatus: 'ready' }) },
        '../workers/mediaProcessor': { processMedia: () => new Promise((resolve) => { finish = resolve; }) },
        './mediaCleanup': { isCleanupPending: () => true, cleanupMedia: async (media) => { cleaned.push(media._id); } }
    });
    queue.addToQueue(mediaId);
    finish();
    await new Promise(setImmediate);
    assert.deepEqual(cleaned, [mediaId]);
});

const streamingFixture = ({ metadata = true } = {}) => {
    const timers = new Map();
    const requests = [];
    const errors = [];
    let timerId = 0;
    let now = 0;
    let respond = async () => ({ ok: true });
    const video = new class extends EventTarget {
        constructor() { super(); this.attributes = new Map(); this.pauseCount = 0; this.loadCount = 0; }
        canPlayType() { return 'probably'; }
        set src(value) { this.attributes.set('src', value); if (metadata) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        removeAttribute(name) { this.attributes.delete(name); }
        pause() { this.pauseCount++; }
        load() { this.loadCount++; }
    };
    const window = {};
    load('frontend/js/streaming.js', {}, {
        window, document: { getElementById: () => video }, localStorage: { getItem: () => null },
        Date: { now: () => now }, console: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
        fetch: async (url, options) => { requests.push({ url, options }); return respond(); },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: (id) => timers.delete(id)
    });
    return {
        player: new window.StreamingPlayer('video'), video, timers, requests, errors,
        respond: (callback) => { respond = callback; }, time: (value) => { now = value; },
        fire: async () => { const [id, timer] = [...timers][0]; timers.delete(id); await timer.callback(); }
    };
};

test('ticket renewal retries transient network and server failures without pausing valid playback', async () => {
    for (const fail of [
        async () => { throw new TypeError('Temporary network failure'); },
        async () => ({ ok: false, status: 503, text: async () => 'Temporarily unavailable' })
    ]) {
        const fixture = streamingFixture();
        await fixture.player.loadManifest(mediaId);
        fixture.time(240_000); fixture.respond(fail);
        await fixture.fire();
        assert.equal(fixture.video.pauseCount, 0);
        assert.equal(fixture.timers.size, 1);
        assert.ok([...fixture.timers.values()][0].delay <= 30_000);
        fixture.respond(async () => ({ ok: true }));
        await fixture.fire();
        assert.equal(fixture.requests.length, 3);
        assert.equal([...fixture.timers.values()][0].delay, 240_000);
        fixture.player.destroy();
    }
});

test('ticket renewal stops on authorization denial, unavailable media, and expired retry window', async () => {
    for (const status of [400, 401, 403, 404]) {
        const fixture = streamingFixture();
        await fixture.player.loadManifest(mediaId);
        fixture.time(240_000); fixture.respond(async () => ({ ok: false, status, text: async () => 'Unavailable' }));
        await fixture.fire();
        assert.equal(fixture.video.pauseCount, 1);
        assert.equal(fixture.timers.size, 0);
        fixture.player.destroy();
    }
    const fixture = streamingFixture();
    await fixture.player.loadManifest(mediaId);
    fixture.time(240_000); fixture.respond(async () => { throw new TypeError('Network unavailable'); });
    await fixture.fire();
    fixture.time(300_000); await fixture.fire();
    assert.equal(fixture.video.pauseCount, 1);
    assert.equal(fixture.timers.size, 0);
    fixture.player.destroy();
});

test('native destroy stops its own media source and rejects an unfinished load', async () => {
    const fixture = streamingFixture();
    await fixture.player.loadManifest(mediaId);
    fixture.player.destroy();
    assert.equal(fixture.video.pauseCount, 1);
    assert.equal(fixture.video.getAttribute('src'), null);
    assert.equal(fixture.video.loadCount, 1);
    const pending = streamingFixture({ metadata: false });
    const loading = pending.player.loadManifest(mediaId);
    await new Promise(setImmediate);
    pending.player.destroy();
    await assert.rejects(loading, /cancelled/i);
});

test('native destroy preserves a source subsequently attached by another player', async () => {
    const fixture = streamingFixture();
    await fixture.player.loadManifest(mediaId);
    fixture.video.src = '/some-other-media';
    fixture.player.destroy();
    assert.equal(fixture.video.getAttribute('src'), '/some-other-media');
    assert.equal(fixture.video.pauseCount, 0);
});

test('cleanup refreshes stale processing media after the queue has already finished', async () => {
    let deleted = 0;
    const ready = { _id: mediaId, processingStatus: 'ready', deleteOne: async () => { deleted++; } };
    const stale = { ...ready, processingStatus: 'processing' };
    const cleanup = load('backend/utils/mediaCleanup.js', {
        'fs/promises': { rm: async () => {} },
        '../models/Lesson': { exists: async () => false }, '../models/Course': { exists: async () => false },
        '../models/Media': { exists: async () => false, findById: async () => ready }
    });
    assert.equal(await cleanup.cleanupMedia(stale), true);
    assert.equal(deleted, 1);
    assert.equal(cleanup.isCleanupPending(mediaId), false);
});

test('cleanup registers before refresh and preserves media attached during the refresh', async () => {
    let referenced = false;
    let registeredBeforeRefresh = false;
    let deleted = 0;
    const ready = { _id: mediaId, processingStatus: 'ready', deleteOne: async () => { deleted++; } };
    const cleanup = load('backend/utils/mediaCleanup.js', {
        'fs/promises': { rm: async () => {} },
        '../models/Lesson': { exists: async () => referenced }, '../models/Course': { exists: async () => false },
        '../models/Media': {
            exists: async () => false,
            findById: async () => { registeredBeforeRefresh = cleanup.isCleanupPending(mediaId); referenced = true; return ready; }
        }
    });
    assert.equal(await cleanup.cleanupMedia({ ...ready, processingStatus: 'processing' }), false);
    assert.equal(registeredBeforeRefresh, true);
    assert.equal(deleted, 0);
    assert.equal(cleanup.isCleanupPending(mediaId), false);
});

test('worker kills a transcode cancelled during startup as soon as FFmpeg starts', async () => {
    const controller = new AbortController();
    const handlers = new Map();
    let started = false;
    let killed = false;
    const command = {
        outputOptions() { return this; }, output() { return this; },
        on(event, callback) { handlers.set(event, callback); return this; },
        kill() { if (started) { killed = true; handlers.get('error')?.(new Error('FFmpeg killed')); } return this; },
        run() { queueMicrotask(() => { controller.abort(); started = true; handlers.get('start')?.(); }); }
    };
    const ffmpeg = () => command;
    ffmpeg.ffprobe = (_filename, callback) => callback(null, { streams: [{ codec_type: 'video' }], format: { duration: 1 } });
    const media = { _id: mediaId, mediaType: 'video', originalPath: path.resolve(__dirname, '../storage/originals/queued.mp4'), save: async () => {} };
    const { processMedia } = load('backend/workers/mediaProcessor.js', {
        '../models/Media': { findById: async () => media }, 'fluent-ffmpeg': ffmpeg,
        fs: { constants: fs.constants, promises: { realpath: async (filename) => filename, access: async () => {}, rm: async () => {}, mkdir: async () => {} } }
    });
    const processing = processMedia(mediaId, { signal: controller.signal });
    // Handle rejection promptly while observing that cancellation actually killed the process.
    const outcome = processing.then(() => null, (error) => error);
    await new Promise(setImmediate);
    assert.equal(killed, true);
    assert.match((await outcome).message, /killed/);
});

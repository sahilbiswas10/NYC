const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const courseId = '0123456789abcdef01234567';
const mediaId = '123456789abcdef012345678';
const demoId = '23456789abcdef0123456789';
const select = (data) => ({ select: () => Promise.resolve(data) });
const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const controller = ({ lessons = [], media = [], course = {}, authorized = true } = {}) => {
    let created = false;
    let saved = false;
    const current = { _id: courseId, instructor: 'owner', description: 'Course description', status: 'draft', ...course, save: async () => { saved = true; } };
    const dependencies = {
        mongoose: { isValidObjectId: (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id) },
        '../models/Course': { findById: async () => current, create: async (data) => { created = true; return data; } },
        '../models/Module': { countDocuments: async () => 1 },
        '../models/Lesson': { find: () => select(lessons) },
        '../models/Media': {
            findById: async (id) => media.find((item) => item._id === id),
            find: () => select(media),
            exists: async (query) => media.some((item) => (query._id === item._id || query._id.$in?.includes(item._id)) && item.processingStatus !== 'ready')
        },
        '../models/Instructor': {}, '../models/Enrollment': {}, '../models/CourseReview': {},
        '../utils/mediaAccess': { canManageMedia: async () => authorized },
        '../utils/mediaCleanup': { cleanupMedia: async () => {} }
    };
    const filename = path.resolve(__dirname, '../backend/controllers/courseController.js');
    const module = { exports: {} };
    const context = vm.createContext({
        module, exports: module.exports, __dirname: path.dirname(filename), console,
        require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)
    });
    new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
    return { exports: module.exports, created: () => created, saved: () => saved, course: current };
};
const user = { id: 'owner', role: 'instructor' };
const publish = async (options) => {
    const loaded = controller(options);
    const res = response();
    await loaded.exports.updateCourse({ params: { id: courseId }, body: { status: 'published' }, user }, res);
    return { ...loaded, res };
};

test('course creation rejects nonexistent, audio, invalid, and unauthorized demo media', async () => {
    for (const options of [
        { media: [] },
        { media: [{ _id: mediaId, mediaType: 'audio' }] },
        { media: [{ _id: mediaId, mediaType: 'video' }], authorized: false },
        { invalid: true }
    ]) {
        const loaded = controller(options);
        const res = response();
        await loaded.exports.createCourse({ body: { title: 'Draft', demoVideo: options.invalid ? '../file' : mediaId }, user }, res);
        assert.equal(res.statusCode, 400, JSON.stringify(options));
        assert.equal(loaded.created(), false);
    }
});

test('authorized video and blank content remain valid when creating drafts', async () => {
    const loaded = controller({ media: [{ _id: mediaId, mediaType: 'video', processingStatus: 'processing' }] });
    const res = response();
    await loaded.exports.createCourse({ body: { title: 'Draft', demoVideo: mediaId }, user }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(loaded.created(), true);
    assert.equal(res.body.data.status, 'draft');
});

test('publication rejects a deleted lesson media reference and type mismatch', async () => {
    for (const media of [[], [{ _id: mediaId, mediaType: 'audio', processingStatus: 'ready' }]]) {
        const result = await publish({ lessons: [{ type: 'video', media: mediaId, isRequired: true }], media });
        assert.equal(result.res.statusCode, 400);
        assert.equal(result.saved(), false);
    }
});

test('publication waits for video and audio processing', async () => {
    for (const type of ['video', 'audio']) {
        const result = await publish({ lessons: [{ type, media: mediaId, isRequired: true }], media: [{ _id: mediaId, mediaType: type, processingStatus: 'processing' }] });
        assert.equal(result.res.statusCode, 409);
        assert.equal(result.saved(), false);
    }
});

test('publication validates demo existence, type and readiness', async () => {
    for (const [demo, expected] of [
        [null, 400],
        [{ _id: demoId, mediaType: 'audio', processingStatus: 'ready' }, 400],
        [{ _id: demoId, mediaType: 'video', processingStatus: 'processing' }, 409]
    ]) {
        const result = await publish({ lessons: [{ type: 'text', content: 'Written lesson', isRequired: true }], course: { demoVideo: demoId }, media: demo ? [demo] : [] });
        assert.equal(result.res.statusCode, expected);
        assert.equal(result.saved(), false);
    }
});

test('publication requires nonblank written content, including optional lessons', async () => {
    for (const type of ['text', 'document']) {
        const result = await publish({ lessons: [
            { type: 'text', content: 'Required content', isRequired: true },
            { type, content: '   ', isRequired: false }
        ] });
        assert.equal(result.res.statusCode, 400);
        assert.equal(result.saved(), false);
    }
});

test('complete ready mixed curriculum and demo publish successfully', async () => {
    const result = await publish({
        lessons: [
            { type: 'video', media: mediaId, isRequired: true },
            { type: 'audio', media: demoId, isRequired: false },
            { type: 'text', content: 'Written content', isRequired: true },
            { type: 'document', content: 'Document instructions', isRequired: true }
        ],
        media: [{ _id: mediaId, mediaType: 'video', processingStatus: 'ready' }, { _id: demoId, mediaType: 'audio', processingStatus: 'ready' }],
        course: { demoVideo: mediaId }
    });
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.saved(), true);
    assert.equal(result.course.status, 'published');
});

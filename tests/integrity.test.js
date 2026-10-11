const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// This suite uses model and filesystem stubs. It never connects to MongoDB or removes files.
process.env.JWT_SECRET = 'nyc-integrity-regression-test-secret-only';
const User = require('../backend/models/User');
const Course = require('../backend/models/Course');
const Module = require('../backend/models/Module');
const Lesson = require('../backend/models/Lesson');
const Media = require('../backend/models/Media');
const Enrollment = require('../backend/models/Enrollment');
const LessonProgress = require('../backend/models/LessonProgress');
const CourseReview = require('../backend/models/CourseReview');
const DiscussionPost = require('../backend/models/DiscussionPost');
const { recalculateEnrollment } = require('../backend/utils/courseProgress');
const { protect, optionalProtect } = require('../backend/middleware/auth');
const { updatePassword } = require('../backend/controllers/authController');
const progressRouter = require('../backend/routes/progressRoutes');
const certificateRouter = require('../backend/routes/certificateRoutes');
const courseRouter = require('../backend/routes/courseRoutes');
const adminRouter = require('../backend/routes/adminRoutes');

const ids = {
    student: '111111111111111111111111',
    course: '222222222222222222222222',
    lesson: '333333333333333333333333',
    module: '444444444444444444444444'
};
const response = () => ({
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    set() { return this; }
});
const handler = (router, route, method) => router.stack.find((layer) => layer.route?.path === route && layer.route.methods[method]).route.stack.at(-1).handle;

const stubCompletion = (t, lessons, completedIds) => {
    t.mock.method(Lesson, 'find', (query) => ({
        select: async () => lessons.filter((lesson) => !query.isRequired || lesson.isRequired !== false)
    }));
    t.mock.method(LessonProgress, 'countDocuments', async (query) => query.lesson.$in.filter((id) => completedIds.includes(String(id))).length);
};

test('course completion requires required lessons and excludes optional lessons', async (t) => {
    stubCompletion(t, [{ _id: ids.lesson, isRequired: true }, { _id: 'optional', isRequired: false }], [ids.lesson]);
    const enrollment = { student: ids.student, course: ids.course, status: 'active', progress: 0, save: async () => {} };
    await recalculateEnrollment(enrollment);
    assert.equal(enrollment.status, 'completed');
    assert.equal(enrollment.progress, 100);
    assert.ok(enrollment.completedAt instanceof Date);
});

test('legacy lessons without isRequired remain required and incomplete lessons block completion', async (t) => {
    stubCompletion(t, [{ _id: ids.lesson }, { _id: 'other', isRequired: true }], [ids.lesson]);
    const enrollment = { student: ids.student, course: ids.course, status: 'completed', progress: 100, completedAt: new Date(), save: async () => {} };
    await recalculateEnrollment(enrollment);
    assert.equal(enrollment.status, 'active');
    assert.equal(enrollment.progress, 50);
    assert.equal(enrollment.completedAt, undefined);
});

test('a course without required lessons does not become completed', async (t) => {
    stubCompletion(t, [{ _id: ids.lesson, isRequired: false }], [ids.lesson]);
    const enrollment = { student: ids.student, course: ids.course, status: 'active', progress: 0, save: async () => {} };
    await recalculateEnrollment(enrollment);
    assert.equal(enrollment.status, 'active');
    assert.equal(enrollment.progress, 0);
});

test('recalculation does not restore a cancelled enrollment', async (t) => {
    const find = t.mock.method(Lesson, 'find', () => ({ select: async () => [] }));
    let saves = 0;
    const enrollment = { student: ids.student, course: ids.course, status: 'cancelled', progress: 0, save: async () => { saves++; } };
    await recalculateEnrollment(enrollment);
    assert.equal(enrollment.status, 'cancelled');
    assert.equal(find.mock.callCount(), 0);
    assert.equal(saves, 0);
});

test('unchanged completion reads avoid an extra enrollment write', async (t) => {
    stubCompletion(t, [{ _id: ids.lesson, isRequired: true }], []);
    const enrollment = Enrollment.hydrate({ _id: '555555555555555555555555', student: ids.student, course: ids.course, status: 'active', progress: 0 });
    const save = t.mock.method(enrollment, 'save', async () => enrollment);
    await recalculateEnrollment(enrollment);
    assert.equal(save.mock.callCount(), 0);
});

test('auth tolerates malformed unrelated cookies and still accepts a valid session cookie', async (t) => {
    const token = jwt.sign({ id: ids.student }, process.env.JWT_SECRET);
    t.mock.method(User, 'findById', () => ({ select: async () => ({ id: ids.student, role: 'student' }) }));
    const res = response();
    let called = false;
    await protect({ headers: { cookie: `broken=%E0%A4%A; token=${token}` } }, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
});

for (const [name, middleware] of [['protect', protect], ['optionalProtect', optionalProtect]]) {
    test(`${name} rejects HLS tickets presented as an API bearer token`, async (t) => {
        const ticket = jwt.sign({ id: ids.student, purpose: 'hls', mediaId: ids.lesson }, process.env.JWT_SECRET);
        const find = t.mock.method(User, 'findById', () => ({ select: async () => ({ id: ids.student, role: 'student' }) }));
        const res = response();
        let called = false;
        await middleware({ headers: { authorization: `Bearer ${ticket}` } }, res, () => { called = true; });
        assert.equal(called, false);
        assert.equal(res.statusCode, 401);
        assert.equal(find.mock.callCount(), 0);
    });
    test(`${name} accepts a normal session token and uses the current database role`, async (t) => {
        const token = jwt.sign({ id: ids.student, role: 'admin' }, process.env.JWT_SECRET);
        t.mock.method(User, 'findById', () => ({ select: async () => ({ id: ids.student, role: 'student' }) }));
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = response();
        let called = false;
        await middleware(req, res, () => { called = true; });
        assert.equal(called, true);
        assert.equal(req.user.role, 'student');
    });
}

test('password changes reject more than 72 UTF-8 bytes before bcrypt can truncate them', async (t) => {
    const user = { password: 'current-hash', save: async () => {} };
    t.mock.method(User, 'findById', async () => user);
    t.mock.method(bcrypt, 'compare', async () => true);
    t.mock.method(bcrypt, 'genSalt', async () => 'salt');
    const hash = t.mock.method(bcrypt, 'hash', async () => 'truncated-hash');
    const res = response();
    await updatePassword({ user: { id: ids.student }, body: { currentPassword: 'current', newPassword: '😀'.repeat(19) } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(hash.mock.callCount(), 0);
    assert.equal(user.password, 'current-hash');
});

test('playback progress uses the probed duration and saves enrollment once', async (t) => {
    let saves = 0;
    const enrollment = { student: ids.student, course: ids.course, status: 'active', progress: 0, save: async () => { saves++; } };
    t.mock.method(Lesson, 'findById', async () => ({ _id: ids.lesson, course: ids.course, module: ids.module, type: 'video', media: ids.lesson, duration: 120 }));
    t.mock.method(Enrollment, 'findOne', async () => enrollment);
    t.mock.method(Media, 'findById', () => ({ select: async () => ({ duration: 120, processingStatus: 'ready' }) }));
    t.mock.method(LessonProgress, 'findOneAndUpdate', async (_query, update) => update.$set);
    stubCompletion(t, [{ _id: ids.lesson, isRequired: true }], []);
    const res = response();
    await handler(progressRouter, '/lessons/:lessonId/progress', 'put')({ user: { id: ids.student, role: 'student' }, params: { lessonId: ids.lesson }, body: { currentTime: 60, duration: 1 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.duration, 120);
    assert.equal(res.body.data.currentTime, 60);
    assert.equal(res.body.data.percentage, 50);
    assert.equal(String(enrollment.lastAccessedLesson), ids.lesson);
    assert.equal(saves, 1);
});

for (const [route, method] of [['/lessons/:lessonId/progress', 'put'], ['/lessons/:lessonId/complete', 'post']]) {
    test(`${method.toUpperCase()} ${route} rejects non-student roles before reading lessons`, async (t) => {
        const find = t.mock.method(Lesson, 'findById', async () => null);
        const res = response();
        await handler(progressRouter, route, method)({ user: { id: ids.student, role: 'instructor' }, params: { lessonId: ids.lesson }, body: { currentTime: 1, duration: 120 } }, res);
        assert.equal(res.statusCode, 403);
        assert.equal(find.mock.callCount(), 0);
    });
}

test('course deletion cleans only validated notes filenames even though modules are bulk deleted', async (t) => {
    t.mock.method(Lesson, 'find', async () => []);
    t.mock.method(Module, 'find', () => ({ select: async () => [{ notesStorageFilename: 'module-notes-aaaa.pdf' }, { notesStorageFilename: '../../outside.txt' }] }));
    t.mock.method(Module, 'exists', async () => false);
    for (const model of [LessonProgress, Enrollment, DiscussionPost, CourseReview, Lesson, Module]) t.mock.method(model, 'deleteMany', async () => ({ deletedCount: 1 }));
    t.mock.method(Media, 'findById', async () => null);
    const unlinked = [];
    t.mock.method(fs, 'unlink', async (filename) => { unlinked.push(filename); });
    const course = { _id: ids.course, $locals: {} };
    const pre = Course.schema.s.hooks._pres.get('deleteOne').find((hook) => hook.document && hook.fn.name === '').fn;
    const post = Course.schema.s.hooks._posts.get('deleteOne').find((hook) => hook.document && hook.fn.name === '').fn;
    await pre.call(course);
    await post.call(course);
    assert.deepEqual(unlinked, [path.resolve(__dirname, '../storage/module-notes/module-notes-aaaa.pdf')]);
});

test('public verification does not validate a certificate for an incomplete enrollment', async (t) => {
    t.mock.method(Enrollment, 'findOne', () => ({ populate() { return this; }, lean: async () => ({ status: 'active', certificateId: 'NYC-12345678-1234-1234-1234-123456789ABC', certificateIssuedAt: new Date() }) }));
    const res = response();
    await handler(certificateRouter, '/verify/:certificateId', 'get')({ params: { certificateId: 'NYC-12345678-1234-1234-1234-123456789ABC' } }, res);
    assert.equal(res.statusCode, 404);
});

test('public verification still validates a completed enrollment with its issued certificate', async (t) => {
    const certificate = { status: 'completed', certificateId: 'NYC-12345678-1234-1234-1234-123456789ABC', certificateIssuedAt: new Date(), certificateStudentName: 'Learner', certificateCourseTitle: 'Course' };
    t.mock.method(Enrollment, 'findOne', () => ({ populate() { return this; }, lean: async () => certificate }));
    const res = response();
    await handler(certificateRouter, '/verify/:certificateId', 'get')({ params: { certificateId: certificate.certificateId.toLowerCase() } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.valid, true);
    assert.equal(res.body.data.certificateId, certificate.certificateId);
});

test('course deletion preserves a notes file still referenced by a surviving module', async (t) => {
    t.mock.method(Module, 'exists', async () => ({ _id: ids.module }));
    const unlink = t.mock.method(fs, 'unlink', async () => {});
    const post = Course.schema.s.hooks._posts.get('deleteOne').find((hook) => hook.document && hook.fn.name === '').fn;
    await post.call({ $locals: { notesStorageFilenames: ['module-notes-aaaa.pdf'] } });
    assert.equal(unlink.mock.callCount(), 0);
});

test('Continue Watching includes an unfinished optional lesson after required course completion', async (t) => {
    const rows = [{ lesson: { _id: ids.lesson, title: 'Optional lesson' }, course: { _id: ids.course, title: 'Completed course' }, percentage: 25, currentTime: 30 }];
    t.mock.method(LessonProgress, 'find', () => ({ sort() { return this; }, limit() { return this; }, populate() { return this; }, then(resolve, reject) { return Promise.resolve(rows).then(resolve, reject); } }));
    t.mock.method(Enrollment, 'find', (query) => ({ select() { return this; }, lean: async () => query.status?.$in?.includes('completed') ? [{ course: ids.course }] : [] }));
    const res = response();
    await handler(progressRouter, '/student/continue-watching', 'get')({ user: { id: ids.student, role: 'student' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(String(res.body.data[0].lessonId), ids.lesson);
    assert.equal(res.body.data[0].currentTime, 30);
});

test('certificate issuance rejects a stale completed flag when a required lesson is unfinished', async (t) => {
    const enrollment = { _id: '555555555555555555555555', student: ids.student, course: { _id: ids.course, title: 'Course' }, status: 'completed', progress: 100, save: async () => {} };
    t.mock.method(Enrollment, 'findOne', () => ({ populate: async () => enrollment }));
    const update = t.mock.method(Enrollment, 'updateOne', async (_query, values) => { Object.assign(enrollment, values.$set); return { modifiedCount: 1 }; });
    t.mock.method(Enrollment, 'findById', () => ({ populate: async () => enrollment }));
    stubCompletion(t, [{ _id: ids.lesson, isRequired: true }], []);
    const res = response();
    await handler(courseRouter, '/:id/certificate', 'get')({ user: { _id: ids.student, role: 'student', name: 'Learner' }, params: { id: ids.course } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(update.mock.callCount(), 0);
    assert.equal(enrollment.status, 'active');
});

test('certificate issuance recalculates an active enrollment from required lesson progress', async (t) => {
    const enrollment = { _id: '555555555555555555555555', student: ids.student, course: { _id: ids.course, title: 'Course' }, status: 'active', progress: 0, save: async () => {} };
    t.mock.method(Enrollment, 'findOne', (query) => ({ populate: async () => query.status?.$in?.includes('active') ? enrollment : null }));
    t.mock.method(Enrollment, 'updateOne', async (query, values) => {
        assert.equal(query.status, 'completed');
        Object.assign(enrollment, values.$set);
        return { modifiedCount: 1 };
    });
    t.mock.method(Enrollment, 'findById', () => ({ populate: async () => enrollment }));
    stubCompletion(t, [{ _id: ids.lesson, isRequired: true }, { _id: 'optional', isRequired: false }], [ids.lesson]);
    const res = response();
    await handler(courseRouter, '/:id/certificate', 'get')({ user: { _id: ids.student, role: 'student', name: 'Learner' }, params: { id: ids.course } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.data.certificateId, /^NYC-/);
    assert.equal(enrollment.status, 'completed');
    assert.equal(enrollment.progress, 100);
});

test('admin user deletion supports the installed Mongoose counter update pipeline', async (t) => {
    const user = { _id: ids.student, role: 'student', deleteOne: async () => {} };
    const deleteUser = t.mock.method(user, 'deleteOne', async () => {});
    t.mock.method(User, 'findById', async () => user);
    t.mock.method(Enrollment, 'aggregate', async () => [{ _id: ids.course, count: 1 }]);
    t.mock.method(Media, 'find', async () => []);
    t.mock.method(DiscussionPost, 'find', () => ({ distinct: async () => [] }));
    for (const model of [Enrollment, LessonProgress, CourseReview, DiscussionPost]) t.mock.method(model, 'deleteMany', async () => ({ deletedCount: 1 }));
    t.mock.method(Course, 'updateMany', async () => ({ modifiedCount: 0 }));
    // Keep Course.updateOne real so Mongoose validates the pipeline options.
    // Only the driver operation is stubbed; no connection or database writes occur.
    const updateCounter = t.mock.method(Course.collection, 'updateOne', async (_query, update) => {
        assert.ok(Array.isArray(update));
        assert.ok(update[0].$set.totalStudents.$max);
        return { acknowledged: true, modifiedCount: 1 };
    });
    t.mock.method(console, 'error', () => {});
    const res = response();
    await handler(adminRouter, '/users/:id', 'delete')({ user: { id: ids.module, role: 'admin' }, params: { id: ids.student } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(updateCounter.mock.callCount(), 1);
    assert.equal(deleteUser.mock.callCount(), 1);
});

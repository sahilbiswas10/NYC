const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ObjectId } = require('mongoose').Types;
const { startIsolatedApp } = require('./helpers/isolated-app');

test('LMS workflows against isolated MongoDB, FFmpeg and HTTP server', { timeout: 300000 }, async (t) => {
    const app = await startIsolatedApp();
    t.after(() => app.close());
    const request = async (route, { user, method = 'GET', body, cookie, raw = false } = {}) => {
        const headers = {};
        if (user) headers.Authorization = `Bearer ${user.token}`;
        if (cookie) headers.Cookie = cookie;
        if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
        const response = await fetch(app.baseUrl + route, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        if (raw) return { status: response.status, data, headers: response.headers };
        assert.ok(response.ok, `${method} ${route}: HTTP ${response.status} ${text}`);
        return data;
    };
    const password = 'Isolated-testing-123!';
    const account = async (name, role = 'student') => {
        const email = `${name.toLowerCase()}@audit.invalid`;
        const registered = await request('/api/auth/register', { method: 'POST', body: { name, email, password, role: 'admin' } });
        assert.equal(registered.user.role, 'student', 'Registration must ignore requested admin role');
        if (role !== 'student') await app.db.collection('users').updateOne({ _id: new ObjectId(registered.user._id) }, { $set: { role } });
        const login = await request('/api/auth/login', { method: 'POST', body: { email, password } });
        assert.equal(login.user.role, role);
        return { token: login.token, ...login.user, password };
    };
    const admin = await account('Admin', 'admin');
    const owner = await account('Owner', 'instructor');
    const other = await account('Other', 'instructor');
    const student = await account('Learner');
    const stranger = await account('Stranger');
    const post = (route, user, body) => request(route, { method: 'POST', user, body });
    const put = (route, user, body) => request(route, { method: 'PUT', user, body });
    const remove = (route, user) => request(route, { method: 'DELETE', user });
    let course;
    let module1;
    let module2;
    let videoLesson;
    let audioLesson;
    let textLesson;
    let optionalLesson;
    let videoMedia;
    let audioMedia;
    let ticketCookie;
    let manifest;
    let certificate;

    await t.test('Authentication validates credentials, ignores elevated roles, and rejects HLS-token replay', async () => {
        assert.equal((await request('/api/auth/me', { raw: true })).status, 401);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: student.email, password: 'incorrect' }, raw: true })).status, 401);
        assert.equal((await request('/api/auth/me', { cookie: 'unrelated=%ZZ', raw: true })).status, 401);
        assert.equal((await request('/api/auth/me', { user: student })).user.role, 'student');
        assert.equal((await request('/api/admin/users', { user: owner, raw: true })).status, 403);
        assert.equal((await request('/api/auth/password', { method: 'PUT', user: student, body: { currentPassword: password, newPassword: 'x'.repeat(73) }, raw: true })).status, 400);
    });
    await t.test('Instructor can create and edit own course; guest/student/other instructor cannot modify it', async () => {
        course = (await post('/api/courses', owner, { title: 'Isolated Course', description: 'Generated audit content', price: 0, level: 'beginner' })).data;
        assert.equal(course.status, 'draft');
        await put(`/api/courses/${course._id}`, owner, { title: 'Isolated Updated Course' });
        for (const [user, status] of [[null, 401], [student, 403], [other, 403]]) {
            assert.equal((await request(`/api/courses/${course._id}`, { method: 'PUT', user, body: { title: 'Forbidden' }, raw: true })).status, status);
        }
        assert.equal((await request(`/api/courses/${course._id}`, { raw: true })).status, 404);
        assert.equal((await request(`/api/courses/${course._id}`, { method: 'PUT', user: owner, body: { status: 'published' }, raw: true })).status, 400);
    });
    await t.test('Module and lesson CRUD, ordering and nested ownership are enforced', async () => {
        module1 = (await post(`/api/courses/${course._id}/modules`, owner, { title: 'Media module' })).data;
        module2 = (await post(`/api/courses/${course._id}/modules`, owner, { title: 'Reading module' })).data;
        videoLesson = (await post(`/api/modules/${module1._id}/lessons`, owner, { title: 'Video lesson', type: 'video' })).data;
        audioLesson = (await post(`/api/modules/${module1._id}/lessons`, owner, { title: 'Audio lesson', type: 'audio' })).data;
        textLesson = (await post(`/api/modules/${module2._id}/lessons`, owner, { title: 'Text lesson', type: 'text', content: 'Read this generated lesson.' })).data;
        optionalLesson = (await post(`/api/modules/${module2._id}/lessons`, owner, { title: 'Optional reading', type: 'text', content: 'Optional material.', isRequired: false })).data;
        await put(`/api/modules/${module1._id}/lessons/${audioLesson._id}`, owner, { order: 0, description: 'Audio description' });
        await put(`/api/modules/${module1._id}/lessons/${videoLesson._id}`, owner, { order: 1 });
        assert.equal((await request(`/api/modules/${module1._id}/lessons`, { user: owner })).data[0]._id, audioLesson._id);
        assert.equal((await request(`/api/modules/${module1._id}/lessons`, { method: 'POST', user: other, body: { title: 'Forbidden', type: 'text' }, raw: true })).status, 403);
        assert.equal((await request(`/api/modules/${module2._id}/lessons/${videoLesson._id}`, { method: 'PUT', user: owner, body: { title: 'Wrong module' }, raw: true })).status, 404);
    });
    const upload = async (file, type, user = owner) => {
        const form = new FormData();
        form.append('media', new Blob([await fs.readFile(file)], { type }), path.basename(file));
        return (await request('/api/media/upload', { method: 'POST', user, body: form })).data;
    };
    const waitReady = async (media) => {
        for (let i = 0; i < 100; i++) {
            const result = await request(`/api/media/${media._id}/status`, { user: owner });
            assert.notEqual(result.data.status, 'failed', result.data.error);
            if (result.data.status === 'ready') return;
            await app.delay(200);
        }
        assert.fail('FFmpeg processing did not complete in 20 seconds');
    };
    await t.test('Video/audio uploads run real FFmpeg processing and attach to lessons', async () => {
        const video = path.join(app.directory, 'sample.mp4');
        const audio = path.join(app.directory, 'sample.mp3');
        await app.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
        await app.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '2', audio]);
        videoMedia = await upload(video, 'video/mp4');
        audioMedia = await upload(audio, 'audio/mpeg');
        await put(`/api/modules/${module1._id}/lessons/${videoLesson._id}`, owner, { media: videoMedia._id });
        await put(`/api/modules/${module1._id}/lessons/${audioLesson._id}`, owner, { media: audioMedia._id });
        await Promise.all([waitReady(videoMedia), waitReady(audioMedia)]);
        const lessons = (await request(`/api/modules/${module1._id}/lessons`, { user: owner })).data;
        assert.ok(lessons.every((lesson) => lesson.duration > 0));
        assert.equal((await request(`/api/media/${videoMedia._id}/status`, { user: other, raw: true })).status, 403);
    });
    await t.test('Uploads reject bad signatures, incompatible MIME/extensions, oversized files and student writes', async () => {
        const send = async (bytes, filename, type, user) => {
            const form = new FormData();
            form.append('media', new Blob([bytes], { type }), filename);
            return request('/api/media/upload', { method: 'POST', user, body: form, raw: true });
        };
        assert.equal((await send('fake', 'fake.mp4', 'video/mp4', owner)).status, 400);
        assert.equal((await send('fake', 'bad.exe', 'video/mp4', owner)).status, 400);
        assert.equal((await send(Buffer.alloc(1048577), 'big.mp4', 'video/mp4', owner)).status, 413);
        assert.equal((await send('fake', 'fake.mp4', 'video/mp4', student)).status, 403);
        assert.equal((await send('fake', 'fake.mp4', 'video/mp4', null)).status, 401);
    });
    await t.test('Course creation cannot adopt another instructor’s uploaded demo', async () => {
        const result = await request('/api/courses', { method: 'POST', user: other, body: { title: 'Stolen demo', demoVideo: videoMedia._id }, raw: true });
        assert.equal(result.status, 400);
    });
    await t.test('Publishing rejects missing referenced media and empty text lessons', async () => {
        const broken = (await post('/api/courses', owner, { title: 'Broken draft', description: 'Draft validation' })).data;
        const mod = (await post(`/api/courses/${broken._id}/modules`, owner, { title: 'Broken' })).data;
        const lesson = (await post(`/api/modules/${mod._id}/lessons`, owner, { title: 'Broken video', type: 'video' })).data;
        await app.db.collection('lessons').updateOne({ _id: new ObjectId(lesson._id) }, { $set: { media: new ObjectId() } });
        assert.equal((await request(`/api/courses/${broken._id}`, { method: 'PUT', user: owner, body: { status: 'published' }, raw: true })).status, 400);
        await remove(`/api/modules/${mod._id}/lessons/${lesson._id}`, owner);
        await post(`/api/modules/${mod._id}/lessons`, owner, { title: 'Empty text', type: 'text', content: '' });
        assert.equal((await request(`/api/courses/${broken._id}`, { method: 'PUT', user: owner, body: { status: 'published' }, raw: true })).status, 400);
        await remove(`/api/courses/${broken._id}`, owner);
    });
    await t.test('Rejected notes uploads do not leave files behind', async () => {
        const notesRoot = path.join(app.appRoot, 'storage/module-notes');
        const before = await fs.readdir(notesRoot);
        const notes = new FormData();
        notes.append('notes', new Blob(['Invalid-ID audit notes'], { type: 'text/plain' }), 'invalid.txt');
        assert.equal((await request(`/api/courses/not-an-id/modules/not-an-id/notes`, { method: 'POST', user: owner, body: notes, raw: true })).status, 404);
        assert.deepEqual(await fs.readdir(notesRoot), before);
    });
    await t.test('Notes/thumbnail upload and valid publishing preserve the existing course authoring flow', async () => {
        const notes = new FormData();
        notes.append('notes', new Blob(['Generated module notes'], { type: 'text/plain' }), 'audit.txt');
        await request(`/api/courses/${course._id}/modules/${module1._id}/notes`, { method: 'POST', user: owner, body: notes });
        assert.equal((await request(`/api/courses/${course._id}/modules/${module1._id}/notes`, { user: owner, raw: true })).data, 'Generated module notes');
        const image = new FormData();
        image.append('thumbnail', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'audit.png');
        await request(`/api/courses/${course._id}/thumbnail`, { method: 'POST', user: owner, body: image });
        assert.equal((await fetch(`${app.baseUrl}/api/courses/${course._id}/thumbnail`)).status, 200);
        await put(`/api/courses/${course._id}`, owner, { demoVideo: videoMedia._id, status: 'published' });
        assert.ok((await request('/api/courses')).data.some((item) => item._id === course._id));
    });
    await t.test('Published demo is public but curriculum and lesson streams require enrollment', async () => {
        assert.equal((await request(`/api/courses/${course._id}/modules`, { raw: true })).status, 403);
        const demo = await request(`/api/media/play/${videoMedia._id}/ticket`, { method: 'POST', raw: true });
        assert.equal(demo.status, 200, 'A separately declared published demo remains public even if reused by a lesson');
        assert.equal((await request(`/api/media/play/${audioMedia._id}/ticket`, { method: 'POST', raw: true })).status, 403);
        assert.equal((await request(`/api/media/play/${audioMedia._id}/ticket`, { method: 'POST', user: stranger, raw: true })).status, 403);
        await post(`/api/courses/${course._id}/enroll`, student);
        assert.ok((await request(`/api/courses/${course._id}/modules`, { user: student })).data.length);
        assert.equal((await request(`/api/courses/${course._id}/modules/${module1._id}/notes`, { user: stranger, raw: true })).status, 403);
    });
    await t.test('Private lesson HLS enforces the full guest/student/instructor/admin access matrix', async () => {
        for (const [user, status] of [[null, 401], [stranger, 403], [other, 403], [owner, 200], [admin, 200], [student, 200]]) {
            assert.equal((await request(`/api/media/play/${audioMedia._id}/manifest`, { user, raw: true })).status, status);
        }
    });
    await t.test('Bearer and cookie-only native-HLS requests authorize manifests and segments without query tokens', async () => {
        const response = await request(`/api/media/play/${audioMedia._id}/ticket`, { method: 'POST', user: student, raw: true });
        assert.equal(response.status, 200);
        const setCookie = response.headers.get('set-cookie');
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);
        ticketCookie = setCookie.split(';')[0];
        const hls = await request(`/api/media/play/${audioMedia._id}/manifest`, { cookie: ticketCookie, raw: true });
        assert.equal(hls.status, 200);
        manifest = hls.data;
        assert.match(manifest, /#EXTM3U/);
        const segment = manifest.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
        assert.match(segment, /^\/api\/media\/play\/[a-f0-9]+\/segment\/segment_\d+\.ts$/);
        assert.equal((await fetch(app.baseUrl + segment, { headers: { Cookie: ticketCookie } })).status, 200);
        assert.equal((await fetch(app.baseUrl + segment)).status, 401);
        assert.equal((await request(`/api/media/play/${videoMedia._id}/manifest`, { cookie: ticketCookie, raw: true })).status, 401, 'Ticket cannot be used for another media asset');
        const token = decodeURIComponent(ticketCookie.slice(ticketCookie.indexOf('=') + 1));
        assert.equal((await request('/api/auth/me', { user: { token }, raw: true })).status, 401);
        assert.equal((await request(`/api/courses/${course._id}/modules`, { user: { token }, raw: true })).status, 401);
    });
    await t.test('Segment endpoint rejects traversal, arbitrary files and symlinks outside HLS storage', async () => {
        const segmentDir = path.join(app.appRoot, 'storage/hls', audioMedia._id);
        await fs.writeFile(path.join(segmentDir, 'secret.txt'), 'Private test file');
        assert.equal((await request(`/api/media/play/${audioMedia._id}/segment/secret.txt`, { user: student, raw: true })).status, 400);
        assert.equal((await request(`/api/media/play/${audioMedia._id}/segment/..%2Fsecret.txt`, { user: student, raw: true })).status, 400);
        assert.equal((await request(`/api/media/play/${audioMedia._id}/segment/segment_99999.ts`, { user: student, raw: true })).status, 404);
        const outside = path.join(app.directory, 'outside.ts');
        await fs.writeFile(outside, 'Private outside file');
        await fs.symlink(outside, path.join(segmentDir, 'segment_99998.ts'));
        assert.notEqual((await request(`/api/media/play/${audioMedia._id}/segment/segment_99998.ts`, { user: student, raw: true })).status, 200);
        assert.equal((await request('/storage/hls/private.ts', { raw: true })).status, 404);
    });
    await t.test('Progress persists in MongoDB and Continue Watching resumes the saved lesson/time', async () => {
        const saved = await put(`/api/lessons/${videoLesson._id}/progress`, student, { currentTime: 1.25, duration: 3 });
        assert.equal(saved.data.currentTime, 1.25);
        assert.equal(saved.data.completed, false);
        const stored = await app.db.collection('lessonprogresses').findOne({ student: new ObjectId(student._id), lesson: new ObjectId(videoLesson._id) });
        assert.equal(stored.currentTime, 1.25);
        const resume = await request('/api/student/continue-watching', { user: student });
        assert.equal(resume.data[0].lessonId, videoLesson._id);
        assert.equal(resume.data[0].currentTime, 1.25);
        assert.equal((await request(`/api/lessons/${videoLesson._id}/progress`, { method: 'PUT', user: stranger, body: { currentTime: 1, duration: 3 }, raw: true })).status, 403);
        assert.equal((await request(`/api/lessons/${videoLesson._id}/progress`, { method: 'PUT', user: owner, body: { currentTime: 1, duration: 3 }, raw: true })).status, 403);
    });
    await t.test('Required completion gates certificate issuance using fresh backend progress', async () => {
        assert.equal((await request(`/api/courses/${course._id}/certificate`, { user: student, raw: true })).status, 403);
        // A stale completed flag must not bypass required progress checks.
        await app.db.collection('enrollments').updateOne({ student: new ObjectId(student._id), course: new ObjectId(course._id) }, { $set: { status: 'completed', progress: 100 } });
        assert.equal((await request(`/api/courses/${course._id}/certificate`, { user: student, raw: true })).status, 403);
        for (const lesson of [videoLesson, audioLesson, textLesson]) await post(`/api/lessons/${lesson._id}/complete`, student, { duration: 3 });
        const state = (await request(`/api/courses/${course._id}/progress`, { user: student })).data;
        assert.equal(state.courseCompleted, true);
        assert.equal(state.completedLessonIds.length, 3);
        assert.ok(!state.completedLessonIds.includes(optionalLesson._id));
        certificate = (await request(`/api/courses/${course._id}/certificate`, { user: student })).data;
        assert.equal(certificate.studentName, student.name);
        assert.equal(certificate.courseTitle, 'Isolated Updated Course');
        const verified = (await request(`/api/certificates/verify/${certificate.certificateId}`)).data;
        assert.equal(verified.valid, true);
        assert.equal(verified.studentName, student.name);
    });
    await t.test('Reviews, ratings and course discussion honor enrollment and admin moderation', async () => {
        assert.equal((await request(`/api/courses/${course._id}/reviews`)).data.reviewCount, 0);
        assert.equal((await request(`/api/courses/${course._id}/reviews`, { method: 'POST', user: stranger, body: { rating: 5, comment: 'Not enrolled' }, raw: true })).status, 403);
        const review = (await post(`/api/courses/${course._id}/reviews`, student, { rating: 5, comment: 'Generated audit feedback.' })).data;
        await post(`/api/courses/${course._id}/reviews`, student, { rating: 4, comment: 'Updated feedback.' });
        const ratings = (await request(`/api/courses/${course._id}/reviews`)).data;
        assert.equal(ratings.reviewCount, 1);
        assert.equal(ratings.averageRating, 4);
        const discussion = (await post(`/api/courses/${course._id}/discussions`, student, { message: 'Generated question.' })).data;
        assert.equal((await request(`/api/courses/${course._id}/discussions`, { user: stranger, raw: true })).status, 403);
        await remove(`/api/admin/community/reviews/${review._id}`, admin);
        await remove(`/api/admin/community/discussions/${discussion._id}`, admin);
        assert.equal((await request(`/api/courses/${course._id}/reviews`)).data.reviewCount, 0);
    });
    await t.test('Paid courses cannot use free enrollment or unconfigured checkout', async () => {
        await put(`/api/courses/${course._id}`, owner, { price: 100 });
        assert.equal((await request(`/api/courses/${course._id}/enroll`, { method: 'POST', user: stranger, raw: true })).status, 402);
        assert.equal((await request(`/api/payments/courses/${course._id}/order`, { method: 'POST', user: stranger, raw: true })).status, 503);
        await put(`/api/courses/${course._id}`, owner, { price: 0 });
    });

    if (process.env.NYC_TEST_BROWSER === '1') {
        await t.test('Actual Chromium: authoring, navigation, enrollment, HLS, progress, resume and completion', { timeout: 180000 }, async () => {
            const browserWorkflows = require('./helpers/browser-workflows');
            const report = await browserWorkflows({
                app, accounts: { admin, owner, student }, course, module1, module2,
                videoLesson, audioLesson, textLesson, optionalLesson, videoMedia, audioMedia
            });
            console.log('Browser validation:', JSON.stringify(report));
        });
    }
    await t.test('Admin revocation blocks streaming and certificate verification; restore/reset preserves access rules', async () => {
        const enrollments = (await request('/api/admin/enrollments', { user: admin })).data;
        const enrollment = enrollments.find((item) => item.student?._id === student._id && item.course?._id === course._id);
        await put(`/api/admin/enrollments/${enrollment._id}`, admin, { action: 'revoke' });
        assert.equal((await request(`/api/media/play/${audioMedia._id}/manifest`, { cookie: ticketCookie, raw: true })).status, 403);
        assert.equal((await request(`/api/certificates/verify/${certificate.certificateId}`, { raw: true })).status, 404);
        await put(`/api/admin/enrollments/${enrollment._id}`, admin, { action: 'restore' });
        await put(`/api/admin/enrollments/${enrollment._id}`, admin, { action: 'reset-progress' });
        assert.equal((await request(`/api/courses/${course._id}/progress`, { user: student })).data.courseCompleted, false);
    });
    await t.test('Course deletion cascades only its own lesson/progress/notes/thumbnail/media data', async () => {
        const notes = await app.db.collection('modules').findOne({ _id: new ObjectId(module1._id) });
        const notesPath = path.join(app.appRoot, 'storage/module-notes', notes.notesStorageFilename);
        await fs.access(notesPath);
        assert.equal((await request(`/api/media/${audioMedia._id}`, { method: 'DELETE', user: owner, raw: true })).status, 409);
        await remove(`/api/courses/${course._id}`, owner);
        assert.equal(await app.db.collection('lessons').countDocuments({ course: new ObjectId(course._id) }), 0);
        assert.equal(await app.db.collection('modules').countDocuments({ course: new ObjectId(course._id) }), 0);
        assert.equal(await app.db.collection('lessonprogresses').countDocuments({ course: new ObjectId(course._id) }), 0);
        assert.equal(await app.db.collection('enrollments').countDocuments({ course: new ObjectId(course._id) }), 0);
        await assert.rejects(fs.access(notesPath));
        await assert.rejects(fs.access(path.join(app.appRoot, 'storage/hls', audioMedia._id)));
        assert.equal((await request('/api/admin/users', { user: admin })).data.length, 5);
    });
    await t.test('Admin user deletion clears test enrollments, progress, reviews and discussion threads', async () => {
        const victim = await account('DeletionStudent');
        const deletionCourse = (await post('/api/courses', owner, { title: 'Deletion test', description: 'Generated cleanup fixture' })).data;
        const deletionModule = (await post(`/api/courses/${deletionCourse._id}/modules`, owner, { title: 'Cleanup module' })).data;
        const deletionLesson = (await post(`/api/modules/${deletionModule._id}/lessons`, owner, { title: 'Cleanup text', type: 'text', content: 'Generated reading' })).data;
        await put(`/api/courses/${deletionCourse._id}`, owner, { status: 'published' });
        await post(`/api/courses/${deletionCourse._id}/enroll`, victim);
        await post(`/api/lessons/${deletionLesson._id}/complete`, victim, {});
        await post(`/api/courses/${deletionCourse._id}/reviews`, victim, { rating: 5, comment: 'Generated deletion fixture' });
        const thread = (await post(`/api/courses/${deletionCourse._id}/discussions`, victim, { message: 'Generated thread' })).data;
        await post(`/api/courses/${deletionCourse._id}/enroll`, student);
        await post(`/api/courses/${deletionCourse._id}/discussions`, student, { message: 'Generated reply', parentId: thread._id });
        assert.equal((await request(`/api/admin/users/${victim._id}`, { method: 'DELETE', user: student, raw: true })).status, 403);
        await remove(`/api/admin/users/${victim._id}`, admin);
        const studentId = new ObjectId(victim._id);
        for (const collection of ['users', 'enrollments', 'lessonprogresses', 'coursereviews']) {
            assert.equal(await app.db.collection(collection).countDocuments(collection === 'users' ? { _id: studentId } : { student: studentId }), 0);
        }
        assert.equal(await app.db.collection('discussionposts').countDocuments({ course: new ObjectId(deletionCourse._id) }), 0);
        assert.equal((await request('/api/auth/me', { user: victim, raw: true })).status, 401);
        assert.equal((await request(`/api/courses/${deletionCourse._id}`)).data.totalStudents, 1);
        await remove(`/api/courses/${deletionCourse._id}`, owner);
    });
});

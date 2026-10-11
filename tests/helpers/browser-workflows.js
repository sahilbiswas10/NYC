const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ObjectId } = require('mongoose').Types;
const puppeteer = require('puppeteer');

const execute = promisify(execFile);

// Uses the actual pages, APIs, database and generated media of startIsolatedApp.
// No application methods or CDN libraries are mocked or replaced.
module.exports = async function browserWorkflows({
    app, accounts: { admin, owner, student }, course, module1, module2,
    videoLesson, audioLesson, textLesson, optionalLesson, videoMedia, audioMedia
}) {
    assert.match(path.basename(app.directory), /^nyc-lms-audit-/);
    assert.equal(app.db.name, 'nyc_audit');
    assert.equal(new URL(app.baseUrl).hostname, '127.0.0.1');
    const actions = [];
    const pageErrors = [];
    const consoleErrors = [];
    const resourceFailures = [];
    const streamResponses = [];
    const ownerLessonWrites = [];
    const contexts = [];
    let createdCourseId;
    let currentStep = 'Launch Chromium';
    const browser = await puppeteer.launch({ headless: true });
    const report = { browser: await browser.version(), actions, pageErrors, consoleErrors, resourceFailures, qr: null, print: null };

    const step = async (name, work) => {
        currentStep = name;
        await work();
        actions.push(name);
        console.log(`Browser workflow passed: ${name}`);
    };
    const api = async (route, user = owner, options = {}) => {
        const response = await fetch(app.baseUrl + route, {
            ...options,
            headers: { Authorization: `Bearer ${user.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
        });
        const body = await response.text();
        assert.ok(response.ok, `${options.method || 'GET'} ${route}: HTTP ${response.status} ${body}`);
        return JSON.parse(body);
    };
    const newPage = async () => {
        const context = await browser.createBrowserContext();
        contexts.push(context);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(25000);
        await page.setViewport({ width: 1440, height: 900 });
        page.on('pageerror', error => pageErrors.push(`${page.url()}: ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(`${page.url()}: ${message.text()}`); });
        page.on('requestfailed', request => resourceFailures.push({ url: request.url(), error: request.failure()?.errorText }));
        page.on('response', response => {
            const url = new URL(response.url());
            if (/\/api\/media\/play\/[^/]+\/(manifest|segment\/)/.test(url.pathname)) streamResponses.push({ path: url.pathname, status: response.status() });
        });
        return page;
    };
    const goto = (page, route) => page.goto(app.baseUrl + route, { waitUntil: 'domcontentloaded' });
    const waitForFiniteAnimations = async (page, selector) => page.$eval(selector, async node => {
        const animations = new Set();
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
            for (const animation of ancestor.getAnimations()) {
                const iterations = animation.effect?.getTiming().iterations;
                if (animation.playState === 'running' && Number.isFinite(iterations)) animations.add(animation);
            }
        }
        await Promise.all([...animations].map(animation => animation.finished.catch(() => {})));
    });
    const actionable = async (page, selector) => {
        await page.bringToFront();
        await page.waitForSelector(selector, { visible: true });
        await (await page.$(selector)).scrollIntoView();
        await waitForFiniteAnimations(page, selector);
        await page.hover(selector);
        await waitForFiniteAnimations(page, selector);
        await page.waitForFunction(selector => {
            const node = document.querySelector(selector);
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            if (!hit || !node.contains(hit)) return false;
            for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
                if (Number(getComputedStyle(ancestor).opacity) < 0.98) return false;
            }
            const coordinates = [rect.x, rect.y, rect.width, rect.height];
            window.__auditStableRects ||= {};
            const previous = window.__auditStableRects[selector];
            const now = performance.now();
            if (!previous || coordinates.some((value, index) => Math.abs(value - previous.coordinates[index]) > 0.5)) {
                window.__auditStableRects[selector] = { coordinates, time: now };
                return false;
            }
            return now - previous.time > 80;
        }, { polling: 'raf' }, selector);
    };
    const click = async (page, selector, options) => {
        try {
            await actionable(page, selector);
            await page.click(selector, options);
        } catch (error) {
            await page.screenshot({ path: '/private/tmp/nyc-browser-failure.png' }).catch(() => {});
            console.error(JSON.stringify({ clickFailure: { selector, url: page.url(), screenshot: '/private/tmp/nyc-browser-failure.png' } }));
            throw error;
        }
    };
    const navigate = async (page, selector) => {
        await actionable(page, selector);
        const before = await page.evaluate(selector => {
            const node = document.querySelector(selector);
            const rect = node.getBoundingClientRect();
            const describe = target => target ? { tag: target.tagName, id: target.id, classes: target.className?.baseVal ?? target.className, href: target.closest('a')?.href, text: target.textContent.trim().slice(0, 120) } : null;
            window.__auditLastClick = null;
            document.addEventListener('click', event => {
                window.__auditLastClick = { target: describe(event.target), x: event.clientX, y: event.clientY, button: event.button, defaultPrevented: event.defaultPrevented };
            }, { capture: true, once: true });
            return {
                url: location.href,
                visibilityState: document.visibilityState,
                focused: document.hasFocus(),
                target: describe(node),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                hit: describe(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
                animations: node.closest('nav')?.getAnimations().map(animation => ({ state: animation.playState, time: animation.currentTime }))
            };
        }, selector);
        try {
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click(selector)]);
        } catch (error) {
            const after = await page.evaluate(selector => {
                const node = document.querySelector(selector);
                const rect = node?.getBoundingClientRect();
                return {
                    url: location.href,
                    lastClick: window.__auditLastClick,
                    pageLeaving: document.documentElement.classList.contains('page-leaving'),
                    target: node ? { href: node.href, text: node.textContent.trim(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null,
                    hit: rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 500) : null
                };
            }, selector).catch(readError => ({ error: readError.message }));
            await page.screenshot({ path: '/private/tmp/nyc-browser-failure.png' }).catch(() => {});
            console.error(JSON.stringify({ navigationFailure: { selector, before, after, screenshot: '/private/tmp/nyc-browser-failure.png' } }, null, 2));
            throw error;
        }
    };
    const replaceInput = async (page, selector, value) => {
        await click(page, selector, { count: 3 });
        await page.keyboard.press('Backspace');
        if (value) await page.type(selector, String(value));
    };
    const classVisible = (page, selector) => page.waitForFunction(selector => {
        const node = document.querySelector(selector);
        return node && !node.classList.contains('hidden');
    }, {}, selector);
    const waitText = (page, selector, expected, timeout = 15000) => page.waitForFunction((selector, expected) => document.querySelector(selector)?.textContent.includes(expected), { timeout }, selector, expected);
    const waitResponse = (page, route, method) => page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === method);
    const assertResponse = async response => {
        const body = await response.text();
        assert.ok(response.ok(), `Browser ${response.request().method()} ${new URL(response.url()).pathname}: HTTP ${response.status()} ${body}`);
        return JSON.parse(body);
    };
    const login = async (page, account, dashboard) => {
        await goto(page, '/login.html');
        await page.type('#email', account.email);
        await page.type('#password', account.password);
        await navigate(page, '#login-form button[type="submit"]');
        assert.equal(new URL(page.url()).pathname, dashboard);
        await navigate(page, '#nav-links a[href="/courses.html"]');
        assert.equal(new URL(page.url()).pathname, '/courses.html');
        await page.waitForSelector('.course-card');
        await page.goBack({ waitUntil: 'domcontentloaded' });
        assert.equal(new URL(page.url()).pathname, dashboard);
        await page.waitForFunction(() => !document.documentElement.classList.contains('page-leaving'));
    };

    try {
        let adminPage;
        let ownerPage;
        let studentPage;
        await step('Admin, instructor and student login, Courses navigation and browser Back', async () => {
            adminPage = await newPage();
            ownerPage = await newPage();
            ownerPage.on('request', request => {
                const pathname = new URL(request.url()).pathname;
                if (/\/api\/lessons\/[^/]+\/(progress|complete)$/.test(pathname) && ['PUT', 'POST'].includes(request.method())) ownerLessonWrites.push(pathname);
            });
            studentPage = await newPage();
            await login(adminPage, admin, '/admin/dashboard.html');
            await login(ownerPage, owner, '/instructor/dashboard.html');
            await login(studentPage, student, '/student/dashboard.html');
        });

        await step('Management menu supports keyboard, outside dismissal, active links and mobile width', async () => {
            await adminPage.bringToFront();
            await adminPage.focus('#management-toggle');
            await adminPage.keyboard.press('Enter');
            await adminPage.waitForFunction(() => document.getElementById('management-toggle').getAttribute('aria-expanded') === 'true');
            await adminPage.keyboard.press('Tab');
            assert.equal(await adminPage.evaluate(() => document.activeElement.getAttribute('href')), '/admin/users.html');
            await adminPage.keyboard.press('Escape');
            assert.equal(await adminPage.$eval('#admin-management', node => node.open), false);
            assert.equal(await adminPage.evaluate(() => document.activeElement.id), 'management-toggle');
            await click(adminPage, '#management-toggle');
            await adminPage.focus('#theme-toggle');
            assert.equal(await adminPage.$eval('#admin-management', node => node.open), false);
            await click(adminPage, '#management-toggle');
            await navigate(adminPage, '#management-links a[href="/admin/media.html"]');
            await adminPage.waitForSelector('#management-links a[aria-current="page"]');
            assert.equal(await adminPage.$eval('#management-links a[aria-current="page"]', node => node.getAttribute('href')), '/admin/media.html');
            await adminPage.setViewport({ width: 390, height: 844 });
            await click(adminPage, '#management-toggle');
            const bounds = await adminPage.$eval('#management-links', node => {
                const rect = node.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: innerWidth };
            });
            assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, 'Mobile menu must fit the viewport');
            assert.equal(await adminPage.$$eval('#management-links a', links => links.length), 5);
            await waitForFiniteAnimations(adminPage, '#management-links');
            await adminPage.screenshot({ path: '/private/tmp/nyc-ui-management-mobile.png' });
            await adminPage.mouse.click(5, 300);
            assert.equal(await adminPage.$eval('#admin-management', node => node.open), false);
            await adminPage.setViewport({ width: 1440, height: 900 });
            assert.equal(await studentPage.$('#admin-management'), null);
            assert.equal(await ownerPage.$('#admin-management'), null);
        });

        await step('Instructor creates and edits a course, module and lesson through forms', async () => {
            await navigate(ownerPage, 'a[href="create-course.html"]');
            await ownerPage.type('#title', 'Browser Authored Course');
            await ownerPage.type('#description', 'Generated browser workflow course.');
            await ownerPage.type('#objectives', 'Streaming, Browser workflow');
            await ownerPage.type('#category', 'Audit');
            await ownerPage.select('#level', 'Beginner');
            await navigate(ownerPage, '#create-course-form button[type="submit"]');
            assert.equal(new URL(ownerPage.url()).pathname, '/instructor/edit-course.html');
            createdCourseId = new URL(ownerPage.url()).searchParams.get('id');
            assert.match(createdCourseId, /^[a-f\d]{24}$/);
            await ownerPage.waitForFunction(() => document.getElementById('title').value === 'Browser Authored Course');
            await replaceInput(ownerPage, '#title', 'Browser Edited Course');
            const savedCourse = waitResponse(ownerPage, `/api/courses/${createdCourseId}`, 'PUT');
            await click(ownerPage, '#course-details-form button[type="submit"]');
            await assertResponse(await savedCourse);
            await waitText(ownerPage, '#course-save-toast', 'COURSE SAVED');

            await click(ownerPage, '#add-module-btn');
            await classVisible(ownerPage, '#new-module-modal');
            await ownerPage.type('#module-title', 'Browser module');
            await ownerPage.type('#module-description', 'Created using the module form.');
            const moduleCreated = waitResponse(ownerPage, `/api/courses/${createdCourseId}/modules`, 'POST');
            await click(ownerPage, '#new-module-form button[type="submit"]');
            const module = (await assertResponse(await moduleCreated)).data;
            await ownerPage.waitForSelector(`[data-action="module-edit"][data-module="${module._id}"]`);
            await click(ownerPage, `[data-action="module-edit"][data-module="${module._id}"]`);
            await classVisible(ownerPage, '#new-module-modal');
            await replaceInput(ownerPage, '#module-title', 'Browser edited module');
            const moduleSaved = waitResponse(ownerPage, `/api/courses/${createdCourseId}/modules/${module._id}`, 'PUT');
            await click(ownerPage, '#new-module-form button[type="submit"]');
            await assertResponse(await moduleSaved);
            await waitText(ownerPage, '#modules-container', 'Browser edited module');

            await click(ownerPage, `[data-action="lesson-add"][data-module="${module._id}"]`);
            await classVisible(ownerPage, '#new-lesson-modal');
            await ownerPage.type('#lesson-title', 'Browser video lesson');
            await ownerPage.type('#lesson-description', 'Generated short video.');
            const lessonCreated = waitResponse(ownerPage, `/api/modules/${module._id}/lessons`, 'POST');
            await click(ownerPage, '#new-lesson-form button[type="submit"]');
            const lesson = (await assertResponse(await lessonCreated)).data;
            await ownerPage.waitForSelector(`[data-action="lesson-edit"][data-lesson="${lesson._id}"]`);
            await click(ownerPage, `[data-action="lesson-edit"][data-lesson="${lesson._id}"]`);
            await classVisible(ownerPage, '#new-lesson-modal');
            await replaceInput(ownerPage, '#lesson-title', 'Browser edited video lesson');
            const lessonSaved = waitResponse(ownerPage, `/api/modules/${module._id}/lessons/${lesson._id}`, 'PUT');
            await click(ownerPage, '#new-lesson-form button[type="submit"]');
            await assertResponse(await lessonSaved);
            await waitText(ownerPage, '#modules-container', 'Browser edited video lesson');
            report.authoredModule = module._id;
            report.authoredLesson = lesson._id;
        });

        await step('Instructor uploads generated video and sees real FFmpeg Ready status', async () => {
            const filename = path.join(app.directory, 'browser-upload.mp4');
            await app.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', filename]);
            await click(ownerPage, `[data-action="lesson-upload"][data-lesson="${report.authoredLesson}"]`);
            await classVisible(ownerPage, '#upload-media-modal');
            await (await ownerPage.$('#media-file')).uploadFile(filename);
            const upload = waitResponse(ownerPage, '/api/media/upload', 'POST');
            await click(ownerPage, '#upload-submit-btn');
            const media = (await assertResponse(await upload)).data;
            report.authoredMedia = media._id;
            await waitText(ownerPage, '#upload-status', 'Media is ready to play.', 25000);
            await waitText(ownerPage, `[data-media-status="${media._id}"]`, 'READY');
            assert.equal((await api(`/api/media/${media._id}/status`)).data.status, 'ready');
            await click(ownerPage, '#close-upload-modal');
        });

        await step('Instructor previews uploaded HLS and publishes using Save Course', async () => {
            await navigate(ownerPage, `a[href="../learn.html?course=${createdCourseId}&lesson=${report.authoredLesson}"]`);
            await ownerPage.waitForFunction(() => document.getElementById('course-video').readyState >= 2);
            assert.equal(await ownerPage.$eval('#lesson-title', node => node.textContent), 'Browser edited video lesson');
            await ownerPage.$eval('#course-video', video => { video.muted = true; return video.play(); });
            await ownerPage.waitForFunction(() => document.getElementById('course-video').currentTime > 0.2);
            await ownerPage.$eval('#course-video', video => video.pause());
            await ownerPage.waitForNetworkIdle({ idleTime: 250, timeout: 5000 });
            assert.deepEqual(ownerLessonWrites, [], 'Instructor previews must not submit student progress or completion writes');
            assert.equal(await ownerPage.$eval('#lesson-progress-status', node => node.classList.contains('hidden')), true);
            for (const selector of ['#previous-lesson', '#next-lesson']) {
                assert.equal(await ownerPage.$eval(selector, node => node.hasAttribute('href')), false);
                assert.equal(await ownerPage.$eval(selector, node => node.getAttribute('aria-disabled')), 'true');
            }
            await ownerPage.goBack({ waitUntil: 'domcontentloaded' });
            await ownerPage.waitForFunction(() => document.getElementById('title').value === 'Browser Edited Course');
            await ownerPage.select('#status', 'published');
            const published = waitResponse(ownerPage, `/api/courses/${createdCourseId}`, 'PUT');
            await click(ownerPage, '#course-details-form button[type="submit"]');
            await assertResponse(await published);
            await waitText(ownerPage, '#course-save-toast', 'COURSE PUBLISHED');
            assert.equal((await api(`/api/courses/${createdCourseId}`)).data.status, 'published');
            await navigate(ownerPage, '#preview-course-link');
            await ownerPage.waitForSelector('.curriculum-module');
            assert.equal(new URL(ownerPage.url()).searchParams.get('course'), createdCourseId);
        });

        await step('Long course title, demo and paid enrollment fit desktop and mobile in both themes', async () => {
            // Only the generated fixture is changed, then restored before enrollment.
            const title = 'Advanced Generative AI and Large Language Model Engineering: From Foundations to Production';
            await api(`/api/courses/${createdCourseId}`, owner, {
                method: 'PUT', body: JSON.stringify({ title, price: 1299, demoVideo: report.authoredMedia })
            });
            const guest = await newPage();
            await goto(guest, `/course.html?course=${createdCourseId}`);
            await classVisible(guest, '#course-price');
            await actionable(guest, '#login-enroll-link');
            const desktop = await guest.evaluate(() => {
                const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, bottom: r.bottom }; };
                const description = getComputedStyle(document.getElementById('course-description'));
                return { title: rect('#course-title'), demo: rect('.course-demo-card'), access: rect('.course-access-summary'), description: { weight: description.fontWeight, family: description.fontFamily, casing: description.textTransform }, navAnimation: getComputedStyle(document.querySelector('nav')).animationDuration };
            });
            assert.ok(desktop.title.width > desktop.demo.width + 200, 'Title should use the full overview width');
            assert.ok(desktop.title.bottom <= desktop.demo.y);
            assert.ok(desktop.access.x > desktop.demo.x + desktop.demo.width);
            assert.ok(Math.abs(desktop.access.y - desktop.demo.y) < 2, 'Price and enrollment should start beside the demo');
            assert.equal(desktop.description.weight, '400');
            assert.equal(desktop.description.casing, 'none');
            assert.match(desktop.description.family, /system-ui/);
            assert.ok(parseFloat(desktop.navAnimation) <= .2);
            await guest.screenshot({ path: '/private/tmp/nyc-ui-course-desktop.png' });
            for (const dark of [false, true]) {
                await guest.setViewport({ width: 390, height: 844 });
                await guest.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
                await actionable(guest, '#login-enroll-link');
                const mobile = await guest.evaluate(() => {
                    const demo = document.querySelector('.course-demo-card').getBoundingClientRect();
                    const access = document.querySelector('.course-access-summary').getBoundingClientRect();
                    const description = document.getElementById('course-description').getBoundingClientRect();
                    return { demoBottom: demo.bottom, accessTop: access.top, accessBottom: access.bottom, descriptionTop: description.top, width: document.documentElement.scrollWidth, viewport: innerWidth };
                });
                assert.ok(mobile.accessTop >= mobile.demoBottom);
                assert.ok(mobile.accessBottom <= mobile.descriptionTop);
                assert.ok(mobile.width <= mobile.viewport + 1, 'Course overview must not overflow horizontally');
            }
            await guest.screenshot({ path: '/private/tmp/nyc-ui-course-mobile.png', fullPage: true });
            await guest.close();
            await api(`/api/courses/${createdCourseId}`, owner, { method: 'PUT', body: JSON.stringify({ title: 'Browser Edited Course', price: 0 }) });
        });

        await step('Student enrolls in a free course using the enrollment button', async () => {
            await navigate(studentPage, '#nav-links a[href="/courses.html"]');
            await studentPage.waitForSelector(`a[href="course.html?course=${createdCourseId}"]`);
            await navigate(studentPage, `a[href="course.html?course=${createdCourseId}"]`);
            await classVisible(studentPage, '#enroll-button');
            await waitText(studentPage, '#enrollment-message', 'Enroll to unlock');
            const enrolled = waitResponse(studentPage, `/api/courses/${createdCourseId}/enroll`, 'POST');
            await click(studentPage, '#enroll-button');
            await assertResponse(await enrolled);
            await classVisible(studentPage, '#curriculum-section');
            await studentPage.waitForSelector(`a[href="learn.html?course=${createdCourseId}&lesson=${report.authoredLesson}"]`);
            assert.equal(await studentPage.$eval('#course-enrollment-card', node => node.classList.contains('hidden')), true);
            assert.ok((await api('/api/student/courses', student)).data.some(enrollment => String(enrollment.course?._id) === createdCourseId));
        });

        await step('Catalog filters and search work; ordinary course entry opens preview', async () => {
            await navigate(studentPage, '#nav-links a[href="/courses.html"]');
            await studentPage.waitForSelector('.course-card');
            await click(studentPage, '#open-course-filters');
            assert.equal(await studentPage.$eval('#course-filter-dialog', node => node.open), true);
            await studentPage.select('#filter-price', 'free');
            await click(studentPage, '#apply-course-filters');
            assert.equal(await studentPage.$eval('#course-filter-dialog', node => node.open), false);
            assert.equal(await studentPage.$eval('#active-filter-count', node => node.textContent), '1');
            await replaceInput(studentPage, '#course-search', 'no-such-browser-course');
            await studentPage.waitForFunction(() => document.querySelectorAll('.course-card').length === 0);
            await click(studentPage, '#open-course-filters');
            await click(studentPage, '#reset-course-filters');
            await click(studentPage, '#apply-course-filters');
            await studentPage.waitForSelector('.course-card');
            assert.equal(await studentPage.$eval('#active-filter-count', node => node.textContent), '0');
            await navigate(studentPage, `a[href="course.html?course=${course._id}"]`);
            await classVisible(studentPage, '#course-content-tabs');
            assert.equal(await studentPage.$eval('#course-overview-section', node => node.classList.contains('hidden')), false);
            assert.equal(await studentPage.$eval('#curriculum-section', node => node.classList.contains('hidden')), true);
            assert.equal(await studentPage.$eval('[data-course-tab="preview"]', node => node.getAttribute('aria-selected')), 'true');
        });

        await step('Dashboard course entry opens curriculum; enrolled discussion posts through UI', async () => {
            await navigate(studentPage, '#nav-links a[href="/student/dashboard.html"]');
            await studentPage.waitForSelector(`a[href="../course.html?course=${course._id}&view=curriculum"]`);
            await navigate(studentPage, `a[href="../course.html?course=${course._id}&view=curriculum"]`);
            await classVisible(studentPage, '#curriculum-section');
            await studentPage.waitForSelector('.curriculum-module');
            assert.equal(await studentPage.$eval('.curriculum-module', node => node.tagName), 'DETAILS');
            assert.equal(await studentPage.$eval('#course-overview-section', node => node.classList.contains('hidden')), true);
            await click(studentPage, '[data-course-tab="discussion"]');
            await classVisible(studentPage, '#discussion-section');
            const message = 'Browser workflow discussion post.';
            await studentPage.type('#discussion-message', message);
            const posted = waitResponse(studentPage, `/api/courses/${course._id}/discussions`, 'POST');
            await click(studentPage, '#discussion-submit');
            await assertResponse(await posted);
            await waitText(studentPage, '#discussion-list', message);
        });

        await step('HLS video playback pause persists progress and Continue Watching resumes it', async () => {
            // Reset only the generated fixture's progress, retaining its issued
            // certificate ID so later parent checks still use the same fixture.
            const studentId = new ObjectId(student._id);
            const courseId = new ObjectId(course._id);
            await app.db.collection('lessonprogresses').deleteMany({ student: studentId, course: courseId });
            await app.db.collection('enrollments').updateOne({ student: studentId, course: courseId }, { $set: { status: 'active', progress: 0 }, $unset: { completedAt: '' } });
            await click(studentPage, '[data-course-tab="curriculum"]');
            await navigate(studentPage, `a[href="learn.html?course=${course._id}&lesson=${videoLesson._id}"]`);
            await studentPage.waitForFunction(() => document.getElementById('course-video').readyState >= 2);
            const back = await studentPage.$eval('#back-dashboard-btn', anchor => ({ href: anchor.href, text: anchor.textContent }));
            assert.match(back.text, /Back to course/i);
            assert.equal(new URL(back.href).searchParams.get('course'), course._id);
            assert.equal(await studentPage.$eval('#player-course-completed', node => node.classList.contains('hidden')), true);
            // The earlier HTTP ordering check put audio before video.
            assert.equal(await studentPage.$eval('#previous-lesson', node => new URL(node.href).searchParams.get('lesson')), audioLesson._id);
            assert.equal(await studentPage.$eval('#next-lesson', node => new URL(node.href).searchParams.get('lesson')), textLesson._id);
            await studentPage.$eval('#course-video', video => { video.muted = true; return video.play(); });
            await studentPage.waitForFunction(() => document.getElementById('course-video').currentTime > 0.6);
            const saved = waitResponse(studentPage, `/api/lessons/${videoLesson._id}/progress`, 'PUT');
            await studentPage.$eval('#course-video', video => video.pause());
            const response = await assertResponse(await saved);
            const savedTime = response.data.currentTime;
            assert.ok(savedTime >= 0.6 && savedTime < 3);
            const stored = await app.db.collection('lessonprogresses').findOne({ student: studentId, lesson: new ObjectId(videoLesson._id) });
            assert.equal(stored.completed, false);
            assert.ok(Math.abs(stored.currentTime - savedTime) < 0.05);
            await navigate(studentPage, '#back-dashboard-btn');
            await navigate(studentPage, '#nav-links a[href="/student/dashboard.html"]');
            const continueSelector = `#continue-watching a[href*="lesson=${videoLesson._id}"]`;
            await studentPage.waitForSelector(continueSelector);
            const resumeHref = await studentPage.$eval(continueSelector, anchor => anchor.href);
            assert.ok(Math.abs(Number(new URL(resumeHref).searchParams.get('time')) - savedTime) < 0.15);
            await navigate(studentPage, continueSelector);
            await studentPage.waitForFunction(time => {
                const video = document.getElementById('course-video');
                return video.readyState >= 2 && video.currentTime >= time - 0.2;
            }, {}, savedTime);
            report.savedResumeTime = savedTime;
        });

        await step('Lesson navigation stays below the player and works on mobile without completing lessons', async () => {
            assert.equal(await studentPage.$eval('#next-lesson', node => new URL(node.href).searchParams.has('time')), false);
            await studentPage.setViewport({ width: 390, height: 844 });
            await actionable(studentPage, '#next-lesson');
            const bounds = await studentPage.evaluate(() => {
                const player = document.getElementById('player-frame').getBoundingClientRect();
                const links = document.getElementById('lesson-navigation').getBoundingClientRect();
                return { playerBottom: player.bottom, linksTop: links.top, linksRight: links.right, width: innerWidth, overflow: document.documentElement.scrollWidth };
            });
            assert.ok(bounds.linksTop >= bounds.playerBottom);
            assert.ok(bounds.linksRight <= bounds.width && bounds.overflow <= bounds.width + 1);
            await studentPage.screenshot({ path: '/private/tmp/nyc-ui-lesson-mobile.png' });
            await navigate(studentPage, '#previous-lesson');
            await waitText(studentPage, '#lesson-title', audioLesson.title);
            assert.equal(new URL(studentPage.url()).searchParams.get('lesson'), audioLesson._id);
            assert.equal(await studentPage.$eval('#previous-lesson', node => node.hasAttribute('href')), false);
            await navigate(studentPage, '#next-lesson');
            await waitText(studentPage, '#lesson-title', videoLesson.title);
            assert.equal((await api(`/api/courses/${course._id}/progress`, student)).data.completedLessonIds.length, 0);
            await studentPage.setViewport({ width: 1440, height: 900 });
            await studentPage.waitForFunction(() => document.getElementById('course-video').readyState >= 2);
        });

        await step('Natural video/audio completion and text completion update required course status', async () => {
            const playToEnd = async lesson => {
                const completed = waitResponse(studentPage, `/api/lessons/${lesson._id}/complete`, 'POST');
                await studentPage.$eval('#course-video', video => { video.muted = true; return video.play(); });
                await studentPage.waitForFunction(() => document.getElementById('course-video').ended);
                assert.equal((await assertResponse(await completed)).data.completed, true);
                await studentPage.waitForSelector(`[data-player-lesson="${lesson._id}"] .completion-check`);
            };
            await playToEnd(videoLesson);
            assert.equal((await api(`/api/courses/${course._id}/progress`, student)).data.courseCompleted, false);
            await navigate(studentPage, '#previous-lesson');
            await studentPage.waitForFunction(() => document.getElementById('course-video').readyState >= 2);
            await playToEnd(audioLesson);
            assert.equal((await api(`/api/courses/${course._id}/progress`, student)).data.courseCompleted, false);
            await navigate(studentPage, '#next-lesson');
            await waitText(studentPage, '#lesson-title', videoLesson.title);
            await navigate(studentPage, '#next-lesson');
            await classVisible(studentPage, '#text-lesson-panel');
            assert.equal(await studentPage.$eval(`[data-player-module="${module2._id}"]`, node => node.open), true);
            await navigate(studentPage, '#next-lesson');
            await waitText(studentPage, '#lesson-title', optionalLesson.title);
            assert.equal(await studentPage.$eval('#next-lesson', node => node.hasAttribute('href')), false);
            assert.equal(await studentPage.$eval('#next-lesson', node => node.getAttribute('aria-disabled')), 'true');
            await navigate(studentPage, '#previous-lesson');
            await classVisible(studentPage, '#text-lesson-panel');
            assert.match(await studentPage.$eval('#text-lesson-content', node => node.textContent), /Read this generated lesson/);
            const textComplete = waitResponse(studentPage, `/api/lessons/${textLesson._id}/complete`, 'POST');
            await click(studentPage, '#complete-text-lesson');
            assert.equal((await assertResponse(await textComplete)).data.completed, true);
            await classVisible(studentPage, '#player-course-completed');
            assert.equal(await studentPage.$eval(`[data-player-module="${module1._id}"] [data-module-count]`, node => node.textContent), '2/2');
            assert.equal(await studentPage.$eval(`[data-player-module="${module2._id}"] [data-module-count]`, node => node.textContent), '1/1');
            assert.equal(await studentPage.$(`[data-player-lesson="${optionalLesson._id}"] .completion-check`), null);
            const completion = (await api(`/api/courses/${course._id}/progress`, student)).data;
            assert.equal(completion.courseCompleted, true);
            assert.equal(completion.completedLessonIds.includes(optionalLesson._id), false);
            for (const media of [videoMedia, audioMedia]) {
                assert.ok(streamResponses.some(response => response.path === `/api/media/play/${media._id}/manifest` && response.status === 200), 'Browser must request the protected HLS manifest');
                assert.ok(streamResponses.some(response => response.path.startsWith(`/api/media/play/${media._id}/segment/`) && response.status === 200), 'Browser must receive real HLS segments');
            }
        });

        await step('Certificate displays an actual QR, verifies publicly and prints one PDF page', async () => {
            await navigate(studentPage, '#back-dashboard-btn');
            await navigate(studentPage, '#nav-links a[href="/student/dashboard.html"]');
            await navigate(studentPage, `a[href="../certificate.html?course=${course._id}"]`);
            await classVisible(studentPage, '#certificate-sheet');
            assert.equal(await studentPage.$eval('#certificate-student', node => node.textContent), student.name);
            const certificateId = await studentPage.$eval('#certificate-id', node => node.textContent);
            const verificationUrl = `${app.baseUrl}/certificate-verify.html?id=${encodeURIComponent(certificateId)}`;
            const qr = await studentPage.evaluate(() => {
                const canvas = document.querySelector('.certificate-qr canvas');
                const image = document.querySelector('.certificate-qr-image');
                if (image?.complete && image.naturalWidth > 0) return { rendered: true, type: 'image', encodedUrl: new URL(image.src).searchParams.get('data') };
                if (canvas && window.QRCode?.toCanvas) {
                    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                    return { rendered: pixels.some((value, index) => index % 4 === 3 && value > 0), type: 'canvas' };
                }
                return { rendered: false, fallback: document.querySelector('.certificate-verify-link')?.href };
            });
            assert.equal(qr.rendered, true, `Certificate QR did not render; verification-link fallback: ${qr.fallback || 'none'}`);
            if (qr.encodedUrl) assert.equal(qr.encodedUrl, verificationUrl);
            await studentPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
            // Read the displayed QR after the normal page entrance animation,
            // just as a person scanning a settled certificate would.
            await actionable(studentPage, '.certificate-qr-image, #certificate-qr-canvas');
            const qrPng = path.join(app.directory, 'certificate-qr.png');
            await (await studentPage.$('.certificate-qr-image, #certificate-qr-canvas')).screenshot({ path: qrPng });
            qr.decode = 'unavailable';
            // CoreImage is available on the macOS host without adding a dependency.
            if (process.platform === 'darwin') {
                const decoder = `function run(args) {
                    ObjC.import('Foundation');
                    ObjC.import('CoreImage');
                    var image = $.CIImage.imageWithContentsOfURL($.NSURL.fileURLWithPath(args[0]));
                    var detector = $.CIDetector.detectorOfTypeContextOptions(
                        $.CIDetectorTypeQRCode, $.CIContext.contextWithOptions($({})),
                        $({CIDetectorAccuracy: $.CIDetectorAccuracyHigh})
                    );
                    var features = detector.featuresInImage(image);
                    var messages = [];
                    for (var i = 0; i < features.count; i++) {
                        messages.push(ObjC.unwrap(features.objectAtIndex(i).messageString));
                    }
                    return messages.join('\\n');
                }`;
                const decoderFile = path.join(app.directory, 'decode-qr.js');
                await fs.writeFile(decoderFile, decoder);
                try {
                    const decoded = await execute('/usr/bin/osascript', ['-l', 'JavaScript', decoderFile, qrPng], { timeout: 15000, maxBuffer: 100000 });
                    if (decoded.stdout.trim() !== verificationUrl) await fs.copyFile(qrPng, '/private/tmp/nyc-browser-qr-failure.png');
                    assert.equal(decoded.stdout.trim(), verificationUrl, 'The rendered certificate QR must decode to its verification URL');
                    qr.decode = 'passed';
                } catch (error) {
                    if (error.code === 'ERR_ASSERTION') throw error;
                    qr.decode = `unavailable: ${error.code || error.message}`;
                }
            }
            report.qr = qr;
            await studentPage.evaluate(() => { window.addEventListener('beforeprint', () => { window.__auditPrintTriggered = true; }, { once: true }); });
            await click(studentPage, '#print-certificate');
            await studentPage.waitForFunction(() => window.__auditPrintTriggered === true);
            const pdfPath = path.join(app.directory, 'certificate-print.pdf');
            const pdf = await studentPage.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
            const pages = Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || [];
            assert.equal(pages.length, 1, 'Certificate print output must occupy one page');
            assert.ok(pdf.byteLength > 1000);
            report.print = { pages: pages.length, bytes: pdf.byteLength };
            await goto(studentPage, `/certificate-verify.html?id=${encodeURIComponent(certificateId)}`);
            await waitText(studentPage, '#verification-status', 'CERTIFICATE VERIFIED');
            assert.equal(await studentPage.$eval('#verification-student', node => node.textContent), student.name);
        });

        await step('Every exercised page runs without uncaught JavaScript errors', async () => {
            assert.deepEqual(pageErrors, [], pageErrors.join('\n'));
        });
        return report;
    } catch (error) {
        error.message = `Browser workflow failed at "${currentStep}": ${error.message}`;
        error.browserActions = actions;
        error.browserPageErrors = pageErrors;
        error.browserConsoleErrors = consoleErrors;
        error.browserResourceFailures = resourceFailures;
        console.error(JSON.stringify({ failedStep: currentStep, completedActions: actions, pageErrors, consoleErrors, resourceFailures }, null, 2));
        throw error;
    } finally {
        // Only the course created by this helper is removed. Shared parent
        // fixtures and any original project/database/media stay untouched.
        if (createdCourseId) await api(`/api/courses/${createdCourseId}`, owner, { method: 'DELETE' });
        await Promise.all(contexts.map(context => context.close()));
        await browser.close();
    }
};

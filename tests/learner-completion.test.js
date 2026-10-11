const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the existing page scripts against a small DOM and API fixture. This
// tests their rendered state and completion events without MongoDB or real media.
class TestElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.className = '';
        this.dataset = {};
        this.children = [];
        this.listeners = new Map();
        this.attributes = {};
        this.textContent = '';
        this.innerHTML = '';
        this.classList = {
            contains: value => this.className.split(/\s+/).includes(value),
            add: (...values) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
            remove: (...values) => { this.className = this.className.split(/\s+/).filter(value => !values.includes(value)).join(' '); },
            toggle: (value, force) => {
                const present = force ?? !this.classList.contains(value);
                if (present) this.classList.add(value);
                else this.classList.remove(value);
                return present;
            }
        };
    }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    pause() {}
    matches(selector) {
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        const match = selector.match(/^\[data-([a-z-]+)\]$/);
        if (!match) return false;
        const key = match[1].replace(/-([a-z])/g, (_whole, letter) => letter.toUpperCase());
        return Object.hasOwn(this.dataset, key);
    }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function renderPage(scriptName, { modules, progress, view, role = 'student', lessonId } = {}) {
    const elements = new Map();
    const documentEvents = new Map();
    const windowEvents = new Map();
    const logs = [];
    const trackers = [];
    let progressReads = 0;
    const element = id => {
        if (!elements.has(id)) {
            const node = new TestElement();
            node.className = 'hidden';
            elements.set(id, node);
        }
        return elements.get(id);
    };
    element('course-overview-section').classList.remove('hidden');
    element('course-reviews').classList.remove('hidden');
    element('complete-text-lesson').classList.remove('hidden');
    for (const courseTab of ['preview', 'curriculum', 'discussion']) {
        const tab = new TestElement('button');
        tab.dataset.courseTab = courseTab;
        element('course-content-tabs').appendChild(tab);
    }
    const search = `?course=course-id${view ? `&view=${view}` : ''}${lessonId ? `&lesson=${lessonId}` : ''}`;
    const course = { _id: 'course-id', title: 'Test course', description: 'Test description', price: 0 };
    const api = {
        courses: { getById: async () => ({ data: course }), getModules: async () => ({ data: modules.map(module => ({ _id: module._id, title: module.title || module._id })) }) },
        modules: { getLessons: async id => ({ data: modules.find(module => module._id === id).lessons }) },
        progress: { getCourseLessons: async () => { progressReads++; return { data: typeof progress === 'function' ? progress(progressReads) : progress }; } },
        student: { getEnrolled: async () => ({ data: [{ course: { _id: course._id } }] }) }
    };
    const context = vm.createContext({
        document: { getElementById: element, createElement: tag => new TestElement(tag), addEventListener: (name, listener) => documentEvents.set(name, listener) },
        window: {
            location: { search, pathname: '/course.html', replace() {} },
            api,
            addEventListener: (name, listener) => windowEvents.set(name, listener),
            dispatchEvent: event => windowEvents.get(event.type)?.(event),
            lucide: { createIcons() {} }
        },
        localStorage: { getItem: name => name === 'token' ? 'test-token' : JSON.stringify({ _id: 'student-id', role }) },
        StreamingPlayer: class { async loadManifest() {} },
        ProgressTracker: class { constructor(_video, id) { trackers.push(id); } },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        URLSearchParams,
        Intl,
        console: { error: (...args) => logs.push(args) }
    });
    context.lucide = context.window.lucide;
    const source = fs.readFileSync(path.join(__dirname, '../frontend/js', scriptName), 'utf8');
    vm.runInContext(source, context);
    await documentEvents.get('DOMContentLoaded')();
    assert.deepEqual(logs, [], 'Page must render without script errors');
    return { element, trackers, progressReads: () => progressReads, event: async detail => windowEvents.get('lesson:completed')({ detail }) };
}

const required = { _id: 'required', title: 'Required lesson', type: 'text', isRequired: true };
const optional = { _id: 'optional', title: 'Optional lesson', type: 'text', isRequired: false };
const legacy = { _id: 'legacy', title: 'Legacy required lesson', type: 'text' };

test('lesson navigation follows curriculum order across empty modules and optional lessons', async () => {
    const modules = [
        { _id: 'module-1', lessons: [required] },
        { _id: 'empty-module', lessons: [] },
        { _id: 'module-2', lessons: [optional, legacy] }
    ];
    for (const [lessonId, previous, next] of [
        ['required', undefined, optional],
        ['optional', required, legacy],
        ['legacy', optional, undefined]
    ]) {
        const page = await renderPage('player.js', { modules, lessonId, progress: { completedLessonIds: [] } });
        assert.equal(page.element('lesson-navigation').classList.contains('hidden'), false);
        for (const [direction, adjacent] of [['previous', previous], ['next', next]]) {
            const link = page.element(`${direction}-lesson`);
            assert.equal(link.attributes['aria-disabled'], String(!adjacent));
            assert.equal(link.href, adjacent ? `learn.html?course=course-id&lesson=${adjacent._id}` : undefined);
            if (adjacent) {
                assert.equal(link.attributes.tabindex, '0');
                assert.equal(page.element(`${direction}-lesson-title`).textContent, adjacent.title);
            }
        }
        assert.equal(page.element('player-course-completed').classList.contains('hidden'), true);
    }
});

test('single-lesson course has no adjacent destinations; invalid or unselected lessons hide navigation', async () => {
    for (const lessonId of ['required', 'not-in-course', undefined]) {
        const page = await renderPage('player.js', {
            modules: [{ _id: 'module-1', lessons: [required] }],
            lessonId, progress: { completedLessonIds: [] }
        });
        assert.equal(page.element('lesson-navigation').classList.contains('hidden'), lessonId !== 'required');
        assert.equal(page.element('previous-lesson').href, undefined);
        assert.equal(page.element('next-lesson').href, undefined);
    }
});

for (const scriptName of ['course.js', 'player.js']) {
    test(`${scriptName} required completion excludes optional lessons and optional-only modules`, async () => {
        const page = await renderPage(scriptName, {
            modules: [{ _id: 'module-1', lessons: [required, optional] }, { _id: 'module-2', lessons: [{ ...optional, _id: 'other-optional' }] }],
            progress: { completedLessonIds: ['required'], courseCompleted: true },
            view: 'curriculum'
        });
        if (scriptName === 'course.js') {
            const html = page.element('course-curriculum').innerHTML;
            assert.match(html, /curriculum-module-count">1\/1<\/span>/);
            assert.match(html, /curriculum-module-count">0\/0<\/span>/);
            assert.equal((html.match(/aria-label="Module completed"/g) || []).length, 1);
            assert.equal((html.match(/aria-label="Lesson completed"/g) || []).length, 1);
            assert.equal(page.element('course-completion-state').classList.contains('hidden'), false);
        } else {
            const modules = page.element('curriculum-container').querySelectorAll('[data-player-module]');
            assert.equal(modules[0].querySelector('[data-module-count]').textContent, '1/1');
            assert.equal(modules[0].querySelector('[data-module-check]').classList.contains('hidden'), false);
            assert.equal(modules[1].querySelector('[data-module-count]').textContent, '0/0');
            assert.equal(modules[1].querySelector('[data-module-check]').classList.contains('hidden'), true);
            assert.equal(modules[0].querySelectorAll('[data-player-lesson]')[1].querySelector('.completion-check'), null);
            assert.equal(page.element('player-course-completed').classList.contains('hidden'), false);
        }
    });

    test(`${scriptName} server courseCompleted overrides a locally complete lesson list`, async () => {
        const page = await renderPage(scriptName, {
            modules: [{ _id: 'module-1', lessons: [required] }],
            progress: { completedLessonIds: ['required'], courseCompleted: false }
        });
        const indicator = page.element(scriptName === 'course.js' ? 'course-completion-state' : 'player-course-completed');
        assert.equal(indicator.classList.contains('hidden'), true);
    });

    test(`${scriptName} legacy lessons remain required while completed optional lessons keep their ticks`, async () => {
        const page = await renderPage(scriptName, {
            modules: [{ _id: 'module-1', lessons: [required, legacy, optional] }],
            progress: { completedLessonIds: ['required', 'optional'] }
        });
        if (scriptName === 'course.js') {
            const html = page.element('course-curriculum').innerHTML;
            assert.match(html, /curriculum-module-count">1\/2<\/span>/);
            assert.equal((html.match(/aria-label="Lesson completed"/g) || []).length, 2);
            assert.doesNotMatch(html, /aria-label="Module completed"/);
            assert.equal(page.element('course-completion-state').classList.contains('hidden'), true);
        } else {
            const module = page.element('curriculum-container').querySelector('[data-player-module]');
            assert.equal(module.querySelector('[data-module-count]').textContent, '1/2');
            assert.equal(module.querySelectorAll('[data-player-lesson]').filter(lesson => lesson.querySelector('.completion-check')).length, 2);
            assert.equal(module.querySelector('[data-module-check]').classList.contains('hidden'), true);
            assert.equal(page.element('player-course-completed').classList.contains('hidden'), true);
        }
    });

    test(`${scriptName} no required lessons does not complete a course in the legacy response fallback`, async () => {
        const page = await renderPage(scriptName, {
            modules: [{ _id: 'module-1', lessons: [optional] }],
            progress: { completedLessonIds: ['optional'] }
        });
        assert.equal(page.element(scriptName === 'course.js' ? 'course-completion-state' : 'player-course-completed').classList.contains('hidden'), true);
    });

    test(`${scriptName} courses with all default required lessons preserve completion`, async () => {
        const page = await renderPage(scriptName, {
            modules: [{ _id: 'module-1', lessons: [required, legacy] }],
            progress: { completedLessonIds: ['required', 'legacy'] }
        });
        assert.equal(page.element(scriptName === 'course.js' ? 'course-completion-state' : 'player-course-completed').classList.contains('hidden'), false);
    });
}

test('player completion event refreshes the backend course state once per new completed lesson', async () => {
    const page = await renderPage('player.js', {
        modules: [{ _id: 'module-1', lessons: [required, optional] }],
        progress: reads => ({ completedLessonIds: reads === 1 ? [] : ['required'], courseCompleted: reads > 1 })
    });
    assert.equal(page.element('player-course-completed').classList.contains('hidden'), true);
    await page.event({ lessonId: 'required' });
    assert.equal(page.element('player-course-completed').classList.contains('hidden'), false);
    assert.equal(page.progressReads(), 2);
    await page.event({ lessonId: 'required' });
    assert.equal(page.progressReads(), 2);
});

test('course page keeps dashboard curriculum links and ordinary preview entry unchanged', async () => {
    for (const view of ['curriculum', undefined]) {
        const page = await renderPage('course.js', { modules: [{ _id: 'module-1', lessons: [required] }], progress: { completedLessonIds: [] }, view });
        assert.equal(page.element('course-overview-section').classList.contains('hidden'), view === 'curriculum');
        assert.equal(page.element('curriculum-section').classList.contains('hidden'), view !== 'curriculum');
        const tab = page.element('course-content-tabs').querySelectorAll('[data-course-tab]').find(tab => tab.classList.contains('is-active'));
        assert.equal(tab.dataset.courseTab, view === 'curriculum' ? 'curriculum' : 'preview');
    }
});

for (const role of ['student', 'instructor', 'admin']) {
    test(`player creates media progress tracking only for student playback (${role})`, async () => {
        const lesson = { _id: 'video', title: 'Video preview', type: 'video', media: 'video-media' };
        const page = await renderPage('player.js', {
            role, lessonId: lesson._id,
            modules: [{ _id: 'module-1', lessons: [lesson] }],
            progress: { completedLessonIds: [], courseCompleted: false }
        });
        assert.deepEqual(page.trackers, role === 'student' ? [lesson._id] : []);
        assert.equal(page.element('lesson-title').textContent, 'Video preview');
    });

    test(`text preview keeps student completion actions restricted to students (${role})`, async () => {
        const page = await renderPage('player.js', {
            role, lessonId: required._id,
            modules: [{ _id: 'module-1', lessons: [required] }],
            progress: { completedLessonIds: [], courseCompleted: false }
        });
        const button = page.element('complete-text-lesson');
        assert.equal(page.element('text-lesson-panel').classList.contains('hidden'), false);
        assert.equal(button.classList.contains('hidden'), role !== 'student');
        assert.equal(button.listeners.has('click'), role === 'student');
    });
}

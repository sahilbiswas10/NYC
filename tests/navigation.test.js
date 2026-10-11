const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.join(__dirname, '..', 'frontend');
const navbarSource = fs.readFileSync(path.join(frontend, 'js', 'navbar.js'), 'utf8');
const authSource = fs.readFileSync(path.join(frontend, 'js', 'auth.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(frontend, 'js', 'api.js'), 'utf8');

// Exercise the real navigation script without a database, network or animation loop.
function renderNavbar(pagePath, userValue, token = 'test-token') {
    const documentEvents = new Map();
    const windowEvents = new Map();
    const pendingTimers = [];
    const navigation = [];
    const classes = new Set(['page-leaving']);
    const navLinks = { innerHTML: '', closest: () => ({ classList: { add() {} } }) };
    const location = new URL(pagePath, 'http://localhost:5000');
    class Element {
        constructor(href, attributes = {}) {
            this.href = new URL(href, location).href;
            this.target = attributes.target || '';
            this.attributes = attributes;
        }
        closest() { return this; }
        hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    }
    const document = {
        documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
        addEventListener: (name, listener) => documentEvents.set(name, listener),
        querySelector: selector => selector === 'footer' ? {} : null,
        querySelectorAll: () => [],
        getElementById: id => id === 'nav-links' ? navLinks : null,
        createElement: () => ({ setAttribute() {}, getContext: () => null }),
        body: { prepend() {}, appendChild() {} }
    };
    const context = vm.createContext({
        document,
        window: {
            location: { href: location.href, origin: location.origin, pathname: location.pathname, search: location.search, assign: value => navigation.push(value) },
            addEventListener: (name, listener) => windowEvents.set(name, listener),
            setTimeout: listener => pendingTimers.push(listener)
        },
        localStorage: { getItem: name => name === 'token' ? token : name === 'user' ? userValue : null },
        MutationObserver: class { observe() {} },
        Element,
        URL,
        Promise,
        lucide: { createIcons() {} }
    });
    vm.runInContext(navbarSource, context);
    documentEvents.get('DOMContentLoaded')();
    return {
        navLinks,
        classes,
        navigation,
        windowEvents,
        click(href, options = {}) {
            const event = { target: new Element(href, options.attributes), button: 0, preventDefault() { this.defaultPrevented = true; }, ...options };
            documentEvents.get('click')(event);
            pendingTimers.splice(0).forEach(listener => listener());
            return event;
        }
    };
}

for (const role of ['student', 'instructor', 'admin']) {
    test(`${role} dashboard Courses navigation reaches the catalog`, () => {
        const navbar = renderNavbar(`/${role}/dashboard.html`, JSON.stringify({ role }));
        const match = navbar.navLinks.innerHTML.match(/<a href="([^"]+)"[^>]*>Courses<\/a>/);
        assert.ok(match, 'Courses link must be rendered');
        assert.equal(match[1], '/courses.html');
        assert.ok(navbar.navLinks.innerHTML.includes(`href="/${role}/dashboard.html"`));
        const event = navbar.click(match[1]);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(navbar.navigation, ['http://localhost:5000/courses.html']);
        assert.equal(navbar.classes.has('page-leaving'), true);
        navbar.windowEvents.get('pageshow')();
        assert.equal(navbar.classes.has('page-leaving'), false);
    });
}

test('guest navigation renders when cached user data is malformed or null', () => {
    for (const cachedUser of ['{invalid', 'null', '"invalid"', '[]']) {
        const navbar = renderNavbar('/index.html', cachedUser);
        assert.match(navbar.navLinks.innerHTML, /href="\/courses\.html"/);
        assert.match(navbar.navLinks.innerHTML, /href="\/login\.html"/);
        assert.doesNotMatch(navbar.navLinks.innerHTML, /Dashboard/);
    }
});

test('navigation preserves same-page anchors, external links and browser click modifiers', () => {
    const navbar = renderNavbar('/courses.html', null, null);
    for (const [href, options] of [
        ['#catalog', {}],
        ['https://example.com/', {}],
        ['/index.html', { ctrlKey: true }],
        ['/index.html', { button: 1 }],
        ['/index.html', { attributes: { target: '_blank' } }],
        ['/index.html', { attributes: { download: '' } }]
    ]) {
        assert.notEqual(navbar.click(href, options).defaultPrevented, true);
    }
    assert.deepEqual(navbar.navigation, []);
});

test('all static local HTML links resolve to existing frontend files', () => {
    function visit(directory) {
        return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const filename = path.join(directory, entry.name);
            return entry.isDirectory() ? visit(filename) : entry.name.endsWith('.html') ? [filename] : [];
        });
    }
    for (const filename of visit(frontend)) {
        const pagePath = '/' + path.relative(frontend, filename).split(path.sep).join('/');
        const contents = fs.readFileSync(filename, 'utf8');
        for (const match of contents.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
            const href = match[1];
            if (!href || href.startsWith('#')) continue;
            const destination = new URL(href, `http://localhost:5000${pagePath}`);
            if (destination.origin !== 'http://localhost:5000') continue;
            assert.ok(fs.existsSync(path.join(frontend, destination.pathname)), `${pagePath} links to missing ${destination.pathname}`);
        }
    }
});

test('authentication return destinations retain course context and reject external URLs', () => {
    function returnDestination(requested) {
        const location = new URL(`/login.html?returnTo=${encodeURIComponent(requested)}`, 'http://localhost:5000');
        const context = vm.createContext({ window: { location }, document: { addEventListener() {} }, URL, URLSearchParams });
        vm.runInContext(authSource, context);
        return vm.runInContext('getSafeReturnTo()', context);
    }
    assert.equal(returnDestination('/learn.html?course=course-id&lesson=lesson-id#player'), '/learn.html?course=course-id&lesson=lesson-id#player');
    for (const requested of ['//example.com', 'https://example.com', '/\\example.com', '/login.html', '/register.html']) {
        assert.equal(returnDestination(requested), null);
    }
});

function loadApi(status, pagePath = '/learn.html?course=course-id&lesson=lesson-id#player') {
    const location = new URL(pagePath, 'http://localhost:5000');
    const navigation = [];
    const storage = new Map([['token', 'test-token'], ['user', '{"role":"student"}']]);
    const requests = [];
    const context = vm.createContext({
        window: { location: { pathname: location.pathname, search: location.search, hash: location.hash, replace: value => navigation.push(value) } },
        localStorage: { getItem: name => storage.get(name), removeItem: name => storage.delete(name) },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: false, status, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Request rejected' }) };
        },
        URL,
        Error,
        TypeError
    });
    vm.runInContext(apiSource, context);
    return { api: context.window.api, navigation, storage, requests };
}

test('expired API authentication returns to the same lesson after login', async () => {
    const client = loadApi(401);
    await assert.rejects(client.api.auth.getMe(), { status: 401 });
    assert.equal(client.storage.has('token'), false);
    assert.equal(client.storage.has('user'), false);
    assert.equal(client.requests[1].url, '/api/auth/logout');
    assert.deepEqual(client.navigation, ['/login.html?returnTo=%2Flearn.html%3Fcourse%3Dcourse-id%26lesson%3Dlesson-id%23player']);
});

test('failed login and password change keep existing authentication without a redirect', async () => {
    for (const operation of [api => api.auth.login({}), api => api.auth.updatePassword({})]) {
        const client = loadApi(401);
        await assert.rejects(operation(client.api), { status: 401 });
        assert.equal(client.storage.has('token'), true);
        assert.deepEqual(client.navigation, []);
    }
});

test('API permission failures and login pages do not enter redirect loops', async () => {
    for (const [status, pagePath] of [[403, '/learn.html'], [401, '/login.html'], [401, '/register.html']]) {
        const client = loadApi(status, pagePath);
        await assert.rejects(client.api.auth.getMe(), { status });
        assert.deepEqual(client.navigation, []);
    }
});

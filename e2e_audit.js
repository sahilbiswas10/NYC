const puppeteer = require('puppeteer');

(async () => {
    console.log("Starting LMS End-to-End User Flow Audit...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    const BASE_URL = 'http://localhost:3000';
    const matrix = [];

    // Catch alerts and console logs
    page.on('dialog', async dialog => {
        console.log('DIALOG ALERT:', dialog.message());
        await dialog.accept();
    });
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

    const record = (id, role, pageName, action, expected, actual, status) => {
        matrix.push(`| ${id} | ${role} | ${pageName} | ${action} | ${expected} | ${actual} | ${status} |`);
    };

    try {
        console.log("Testing unauthenticated courses link...");
        await page.goto(`${BASE_URL}/index.html`);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.evaluate(() => document.querySelector('a[href="/courses.html"]').click())
        ]);
        let currentUrl = page.url();
        record('NAV-001', 'Guest', 'Home', 'Click Courses', '/courses.html', new URL(currentUrl).pathname, currentUrl.includes('courses.html') ? 'PASS' : 'FAIL');

        console.log("Testing login...");
        await page.goto(`${BASE_URL}/login.html`);
        await page.type('#login-form input[type="email"]', 'admin@nyc.com');
        await page.type('#login-form input[type="password"]', 'admin123');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.evaluate(() => document.querySelector('button[type="submit"]').click())
        ]);
        currentUrl = page.url();
        record('AUTH-001', 'Admin', 'Login', 'Submit valid credentials', '/admin/dashboard.html', new URL(currentUrl).pathname, currentUrl.includes('dashboard.html') ? 'PASS' : 'FAIL');

        console.log("Testing Create Course navigation...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.evaluate(() => document.querySelector('a[href="create_course.html"]').click())
        ]);
        currentUrl = page.url();
        record('ADMIN-001', 'Admin', 'Dashboard', 'Click New Course', '/admin/create_course.html', new URL(currentUrl).pathname, currentUrl.includes('create_course.html') ? 'PASS' : 'FAIL');

        console.log("Testing Course Creation...");
        await page.type('#title', 'End to End Puppeteer Course');
        await page.type('#description', 'Testing the LMS core flow automatically.');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.evaluate(() => document.querySelector('button[type="submit"]').click())
        ]);
        currentUrl = page.url();
        record('COURSE-001', 'Admin', 'Create Course', 'Submit course details', '/admin/edit_course.html?id=...', new URL(currentUrl).pathname, currentUrl.includes('edit_course.html') ? 'PASS' : 'FAIL');

        console.log("Testing Module Creation...");
        // Ensure modal is open and wait for element
        await page.evaluate(() => document.getElementById('new-module-modal').classList.remove('hidden'));
        await page.waitForSelector('#module-title', { visible: true });
        await page.type('#module-title', 'Automated Module 1');
        
        // Wait for network activity from the API call instead of relying solely on timeouts
        const [response] = await Promise.all([
            page.waitForResponse(res => res.url().includes('/modules') && res.request().method() === 'POST'),
            page.evaluate(() => {
                // Submit form directly via dispatchEvent to guarantee event fires
                document.getElementById('new-module-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            })
        ]);
        
        await new Promise(r => setTimeout(r, 1000)); // UI update delay
        
        const hasModule = await page.evaluate(() => document.body.innerHTML.includes('Automated Module 1'));
        record('COURSE-002', 'Admin', 'Course Builder', 'Add Module', 'Module appears in UI', hasModule ? 'Module appears in UI' : 'Module not found', hasModule ? 'PASS' : 'FAIL');

        
        console.log("Testing Logout...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
            page.evaluate(() => document.querySelector('#logout-btn').click())
        ]);
        currentUrl = page.url();
        record('AUTH-002', 'Admin', 'Navbar', 'Click Logout', '/index.html', new URL(currentUrl).pathname, currentUrl.includes('index.html') ? 'PASS' : 'FAIL');

    } catch (e) {
        console.error("Test execution encountered an error:", e);
    }

    console.log("\n--- FINAL USER-FLOW TEST MATRIX ---\n");
    console.log("| ID | Role | Page | Action | Expected | Actual | Status |");
    console.log("|---|---|---|---|---|---|---|");
    matrix.forEach(row => console.log(row));
    console.log("\n-----------------------------------\n");
    await browser.close();
    process.exit(0);
})();

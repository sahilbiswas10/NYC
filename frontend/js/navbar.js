document.addEventListener('DOMContentLoaded', () => {
    let navigationPending = false;
    let navigationResetTimer;
    // A page cached during the leave animation can be restored by browser Back
    // with its fade class still applied. Clear it every time a document returns.
    window.addEventListener('pageshow', () => {
        navigationPending = false;
        window.clearTimeout(navigationResetTimer);
        document.documentElement.classList.remove('page-leaving');
    });
    document.documentElement.classList.remove('page-leaving');
    const getSystemDialog = () => {
        let dialog = document.getElementById('nyc-system-dialog');
        if (dialog) return dialog;
        dialog = document.createElement('dialog');
        dialog.id = 'nyc-system-dialog';
        dialog.className = 'nyc-system-dialog';
        dialog.setAttribute('aria-labelledby', 'nyc-system-dialog-title');
        dialog.setAttribute('aria-describedby', 'nyc-system-dialog-message');
        dialog.innerHTML = `
            <div class="nyc-system-dialog-panel">
                <p id="nyc-system-dialog-title" class="nyc-system-dialog-title"></p>
                <p id="nyc-system-dialog-message" class="nyc-system-dialog-message"></p>
                <div class="nyc-system-dialog-actions">
                    <button type="button" data-cancel>Cancel</button>
                    <button type="button" data-confirm>Continue</button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        return dialog;
    };

    const showSystemDialogNow = (message, confirmMode) => new Promise((resolve) => {
        const dialog = getSystemDialog();
        const title = dialog.querySelector('#nyc-system-dialog-title');
        const copy = dialog.querySelector('#nyc-system-dialog-message');
        const cancel = dialog.querySelector('[data-cancel]');
        const confirm = dialog.querySelector('[data-confirm]');
        let closing = false;
        title.textContent = confirmMode ? 'Confirm action' : 'NYC notification';
        copy.textContent = String(message ?? '');
        cancel.hidden = !confirmMode;
        confirm.textContent = confirmMode ? 'Continue' : 'OK';
        dialog.classList.remove('is-closing');
        const finish = (accepted) => {
            if (closing) return;
            closing = true;
            dialog.classList.add('is-closing');
            window.setTimeout(() => {
                if (dialog.open) dialog.close();
                dialog.classList.remove('is-closing');
                resolve(accepted);
            }, 190);
        };
        cancel.onclick = () => finish(false);
        confirm.onclick = () => finish(true);
        dialog.oncancel = (event) => { event.preventDefault(); if (confirmMode) finish(false); };
        dialog.onclick = (event) => { if (confirmMode && event.target === dialog) finish(false); };
        dialog.showModal();
        window.requestAnimationFrame(() => confirm.focus());
    });

    let systemDialogQueue = Promise.resolve();
    const showSystemDialog = (message, confirmMode) => {
        const next = systemDialogQueue.then(() => showSystemDialogNow(message, confirmMode));
        systemDialogQueue = next.then(() => undefined, () => undefined);
        return next;
    };

    window.NYCUI = {
        confirm: (message) => showSystemDialog(message, true),
        alert: (message) => showSystemDialog(message, false)
    };
    if (!document.querySelector('footer')) {
        const footer = document.createElement('footer');
        footer.className = 'global-social-footer';
        footer.innerHTML = `
            <div>
                <span class="footer-brand">© 2026 NOT YOUR COLLEGE</span>
                <div class="footer-social-links">
                    <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram" title="Instagram" class="footer-social-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="18" cy="6" r=".8" fill="currentColor" stroke="none"></circle></svg></a>
                    <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" aria-label="YouTube" title="YouTube" class="footer-social-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12s0-3.2-.4-4.7a2.8 2.8 0 0 0-2-2C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.5a2.8 2.8 0 0 0-2 2C2 8.8 2 12 2 12s0 3.2.4 4.7a2.8 2.8 0 0 0 2 2c1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5a2.8 2.8 0 0 0 2-2C22 15.2 22 12 22 12Z"></path><path d="m10 15 5-3-5-3z" fill="currentColor" stroke="none"></path></svg></a>
                </div>
            </div>`;
        if (document.getElementById('course-video')) footer.classList.add('global-social-footer--learning');
        document.body.appendChild(footer);
    }

    // The shared visual layer owns ambient and interaction motion. Loading it
    // separately keeps navigation, authentication, and dialog behavior intact.
    if (!document.querySelector('script[data-aurora-motion]')) {
        const motionScript = document.createElement('script');
        motionScript.src = '/js/aurora-motion.js';
        motionScript.dataset.auroraMotion = '';
        document.body.appendChild(motionScript);
    }
    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link || link.target || link.hasAttribute('download')) return;
        const destination = new URL(link.href, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
        // Documents and media keep their native download/viewer behavior.
        if (!/^https?:$/.test(destination.protocol) || destination.pathname.startsWith('/api/') || /\.(?:pdf|zip|mp4|webm|mp3|png|jpe?g|svg)$/i.test(destination.pathname)) return;
        event.preventDefault();
        if (navigationPending) return;
        navigationPending = true;
        document.documentElement.classList.add('page-leaving');
        // If navigation is cancelled or the destination stalls, restore this page.
        navigationResetTimer = window.setTimeout(() => {
            navigationPending = false;
            document.documentElement.classList.remove('page-leaving');
        }, 2500);
        // Begin the request immediately; decorative motion must not delay navigation.
        window.location.assign(destination.href);
    });
    if (!window.nycNotificationsLoaded && !document.querySelector('script[src$="notifications.js"]')) {
        const script = document.createElement('script'); script.src = '/js/notifications.js'; document.body.appendChild(script);
    }
    const navLinks = document.getElementById('nav-links');
    if (!navLinks) return;
    navLinks.closest('nav')?.classList.add('lms-nav');

    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    let user = null;
    if (token && userStr) {
        try { user = JSON.parse(userStr); } catch (error) {}
    }

    if (user && typeof user === 'object' && !Array.isArray(user)) {
            let dashLink = 'student/dashboard.html';
            if (user.role === 'instructor') dashLink = 'instructor/dashboard.html';
            else if (user.role === 'admin') dashLink = 'admin/dashboard.html';
            const managementLinks = user.role === 'admin'
                ? `<details id="admin-management" class="nav-management">
                    <summary id="management-toggle" aria-controls="management-links" aria-expanded="false">Management <i data-lucide="chevron-down" aria-hidden="true"></i></summary>
                    <div id="management-links" class="nav-management-links">
                        <a href="/admin/users.html">Users</a>
                        <a href="/admin/enrollments.html">Enrollments</a>
                        <a href="/admin/payments.html">Payments</a>
                        <a href="/admin/media.html">Media</a>
                        <a href="/admin/community.html">Community</a>
                    </div>
                </details>`
                : user.role === 'instructor'
                    ? '<a href="/instructor/courses.html" class="uppercase hover:text-[var(--primary)]">My Courses</a>'
                    : '';

            navLinks.innerHTML = `
                <button id="theme-toggle" class="p-2 brutal-border bg-[var(--bg-color)] text-[var(--foreground)] hover:bg-[var(--primary)] transition-colors shadow-[2px_2px_0px_0px_var(--foreground)]"></button>
                <a href="/courses.html" class="uppercase hover:text-[var(--primary)] transition-colors">Courses</a>
                <a href="/${dashLink}" class="flex items-center gap-2 uppercase hover:text-[var(--primary)] transition-colors">
                    <i data-lucide="layout-dashboard" class="w-4 h-4"></i> Dashboard
                </a>
                ${managementLinks}
                <a href="/profile.html" class="flex items-center gap-2 uppercase hover:text-[var(--accent)] transition-colors">
                    <i data-lucide="user" class="w-4 h-4"></i> Profile
                </a>
            `;

            const heroBtn = document.getElementById('hero-join-btn');
            if (heroBtn) {
                heroBtn.href = '/' + dashLink;
                heroBtn.innerHTML = 'Go to Dashboard <i data-lucide="arrow-right" class="w-6 h-6 inline"></i>';
            }
    } else {
        navLinks.innerHTML = `
            <button id="theme-toggle" class="p-2 brutal-border bg-[var(--bg-color)] text-[var(--foreground)] hover:bg-[var(--primary)] transition-colors shadow-[2px_2px_0px_0px_var(--foreground)]"></button>
            <a href="/courses.html" class="uppercase hover:text-[var(--primary)] transition-colors">Courses</a>
            <a href="/login.html" class="flex items-center gap-2 uppercase hover:text-[var(--primary)] transition-colors">
                <i data-lucide="user" class="w-4 h-4"></i> Login / Register
            </a>
        `;
    }

    const management = document.getElementById('admin-management');
    if (management) {
        const toggle = document.getElementById('management-toggle');
        const closeManagement = () => {
            management.open = false;
            toggle.setAttribute('aria-expanded', 'false');
        };
        management.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(management.open)));
        management.querySelectorAll('a[href]').forEach((link) => {
            if (new URL(link.href).pathname === window.location.pathname) {
                link.setAttribute('aria-current', 'page');
                toggle.classList.add('is-current');
            }
        });
        document.addEventListener('pointerdown', (event) => {
            if (management.open && !management.contains(event.target)) closeManagement();
        });
        document.addEventListener('focusin', (event) => {
            if (management.open && !management.contains(event.target)) closeManagement();
        });
        management.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !management.open) return;
            event.preventDefault();
            closeManagement();
            toggle.focus();
        });
        window.addEventListener('pageshow', closeManagement);
    }

    lucide.createIcons();

    if (window.initThemeToggle) {
        window.initThemeToggle();
    }

});

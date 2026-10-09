document.addEventListener('DOMContentLoaded', () => {
    // A page cached during the leave animation can be restored by browser Back
    // with its fade class still applied. Clear it every time a document returns.
    window.addEventListener('pageshow', () => document.documentElement.classList.remove('page-leaving'));
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

    {
        const canvas = document.createElement('canvas');
        canvas.className = 'ambient-motion-background';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.prepend(canvas);
        const context = canvas.getContext('2d');
        if (context) {
            let width = 0; let height = 0; let scrollTarget = window.scrollY; let scrollPosition = scrollTarget;
            let pointerX = 0; let pointerY = 0; let frame = 0;
            const resize = () => {
                const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
                width = window.innerWidth; height = window.innerHeight;
                canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
                context.setTransform(ratio, 0, 0, ratio, 0, 0);
            };
            const starColors = ['168,85,247', '34,211,238', '236,72,153', '226,232,255'];
            const dots = Array.from({ length: Math.min(96, Math.max(42, Math.floor(window.innerWidth / 16))) }, (_, index) => ({
                x: Math.random() * Math.max(1, window.innerWidth),
                y: Math.random() * Math.max(1, window.innerHeight),
                radius: .7 + Math.random() * 2.2,
                phase: Math.random() * Math.PI * 2,
                color: starColors[index % starColors.length],
                drift: 4 + Math.random() * 14
            }));
            const paint = (time) => {
                frame = requestAnimationFrame(paint);
                scrollPosition += (scrollTarget - scrollPosition) * 0.075;
                context.clearRect(0, 0, width, height);
                const scrollWave = Math.sin(scrollPosition * 0.001 + time * 0.00014);
                const nebula = context.createRadialGradient(width * (.25 + scrollWave * .08), height * .35, 0, width * .25, height * .35, Math.max(width, height) * .62);
                nebula.addColorStop(0, 'rgba(124,58,237,.21)'); nebula.addColorStop(1, 'rgba(124,58,237,0)');
                context.fillStyle = nebula; context.fillRect(0, 0, width, height);
                const aurora = context.createRadialGradient(width * (.82 - scrollWave * .07), height * .72, 0, width * .82, height * .72, Math.max(width, height) * .55);
                aurora.addColorStop(0, 'rgba(34,211,238,.17)'); aurora.addColorStop(1, 'rgba(34,211,238,0)');
                context.fillStyle = aurora; context.fillRect(0, 0, width, height);
                const positions = dots.map((dot) => {
                    const y = ((dot.y - scrollPosition * 0.24) % (height + 40) + height + 40) % (height + 40) - 20;
                    const pulse = 0.28 + (Math.sin(time * 0.0012 + dot.phase) + 1) * 0.34;
                    const x = dot.x + pointerX * 0.04 + Math.sin(time * 0.00025 + dot.phase) * dot.drift;
                    const shiftedY = y + pointerY * 0.035 + Math.cos(time * 0.00022 + dot.phase) * dot.drift;
                    context.beginPath(); context.arc(x, shiftedY, dot.radius * (0.85 + pulse * 0.35), 0, Math.PI * 2);
                    context.fillStyle = `rgba(${dot.color},${pulse})`; context.fill();
                    return { x, y: shiftedY, pulse, color: dot.color };
                });
                for (let i = 0; i < positions.length; i++) {
                    for (let j = i + 1; j < positions.length; j++) {
                        const dx = positions[i].x - positions[j].x; const dy = positions[i].y - positions[j].y;
                        const distance = Math.hypot(dx, dy);
                        if (distance > 130) continue;
                        context.beginPath(); context.moveTo(positions[i].x, positions[i].y); context.lineTo(positions[j].x, positions[j].y);
                        context.strokeStyle = `rgba(${positions[i].color},${(1 - distance / 130) * 0.17})`; context.lineWidth = 1; context.stroke();
                    }
                }
            };
            resize();
            window.addEventListener('resize', resize, { passive: true });
            window.addEventListener('scroll', () => { scrollTarget = window.scrollY; }, { passive: true });
            window.addEventListener('pointermove', (event) => { pointerX = event.clientX - width / 2; pointerY = event.clientY - height / 2; }, { passive: true });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) cancelAnimationFrame(frame);
                else frame = requestAnimationFrame(paint);
            });
            frame = requestAnimationFrame(paint);
        }
    }
    {
        const revealTargets = document.querySelectorAll('main > *, body > section');
        if ('IntersectionObserver' in window && revealTargets.length) {
            document.body.classList.add('motion-ready');
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                });
            }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
            revealTargets.forEach((element, index) => {
                element.classList.add('motion-reveal');
                element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 75}ms`);
                observer.observe(element);
            });
        }
    }
    const replayMotion = (element) => {
        element.classList.remove('motion-pop-in');
        const siblingIndex = element.parentElement ? Array.prototype.indexOf.call(element.parentElement.children, element) : 0;
        element.style.setProperty('--motion-delay', `${Math.min(Math.max(siblingIndex, 0), 7) * 42}ms`);
        void element.offsetWidth;
        element.classList.add('motion-pop-in');
        window.setTimeout(() => {
            element.classList.remove('motion-pop-in');
            element.style.removeProperty('--motion-delay');
        }, 700);
    };
    const dynamicMotionSelector = '.curriculum-module, .curriculum-lesson-row, .discussion-post, .course-review-card, article.brutal-shadow, table tbody tr, .module-notes-card';
    const visibilityMotion = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                const element = mutation.target;
                const wasHidden = (mutation.oldValue || '').split(/\s+/).includes('hidden');
                if (wasHidden && !element.classList.contains('hidden') && !element.matches('dialog, .fixed.inset-0.z-50, .ambient-motion-background')) replayMotion(element);
                continue;
            }
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches(dynamicMotionSelector)) replayMotion(node);
                node.querySelectorAll(dynamicMotionSelector).forEach(replayMotion);
            }
        }
    });
    visibilityMotion.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, childList: true });
    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link || link.target || link.hasAttribute('download')) return;
        const destination = new URL(link.href, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
        event.preventDefault();
        document.documentElement.classList.add('page-leaving');
        window.setTimeout(() => { window.location.assign(destination.href); }, 260);
    });
    const navLinks = document.getElementById('nav-links');
    if (!navLinks) return;
    navLinks.closest('nav')?.classList.add('lms-nav');

    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    if (token && userStr) {
        try {
            const user = JSON.parse(userStr);
            let dashLink = 'student/dashboard.html';
            if (user.role === 'instructor') dashLink = 'instructor/dashboard.html';
            else if (user.role === 'admin') dashLink = 'admin/dashboard.html';
            const managementLinks = user.role === 'admin'
                ? '<a href="/admin/users.html" class="uppercase hover:text-[var(--primary)]">Users</a><a href="/admin/enrollments.html" class="uppercase hover:text-[var(--primary)]">Enrollments</a><a href="/admin/payments.html" class="uppercase hover:text-[var(--primary)]">Payments</a><a href="/admin/media.html" class="uppercase hover:text-[var(--primary)]">Media</a><a href="/admin/community.html" class="uppercase hover:text-[var(--primary)]">Community</a>'
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

        } catch(e) {}
    } else {
        navLinks.innerHTML = `
            <button id="theme-toggle" class="p-2 brutal-border bg-[var(--bg-color)] text-[var(--foreground)] hover:bg-[var(--primary)] transition-colors shadow-[2px_2px_0px_0px_var(--foreground)]"></button>
            <a href="/courses.html" class="uppercase hover:text-[var(--primary)] transition-colors">Courses</a>
            <a href="/login.html" class="flex items-center gap-2 uppercase hover:text-[var(--primary)] transition-colors">
                <i data-lucide="user" class="w-4 h-4"></i> Login / Register
            </a>
        `;
    }

    lucide.createIcons();

    if (window.initThemeToggle) {
        window.initThemeToggle();
    }

});

/* Shared decorative motion. This layer never controls course or account state. */
(() => {
    if (window.nycAuroraMotionLoaded) return;
    window.nycAuroraMotionLoaded = true;

    const initialize = () => {
        const root = document.documentElement;
        const body = document.body;
        const excluded = '.certificate-sheet, #certificate-sheet, video, audio, iframe, .certificate-toolbar, .ag-loader, .ag-page-arrival-sweep';
        const surfaceSelector = '.course-card, .course-review-card, .discussion-post, .feature-panel, .notification-item, .course-access-summary, .course-search-control, .nyc-principles > div, .nyc-hero-art';
        const entranceSelector = '.course-card, .curriculum-module, .course-review-card, .discussion-post, .feature-panel, .notification-item, .module-notes-link, .course-completion-banner, .nyc-principles > div, .course-demo-card, .course-access-summary, .lesson-navigation, main > h1, main > h2, main > .brutal-border, main .grid > div, main section > header, main section > h2, .course-reviews-header, .course-review-form, .discussion-empty, .course-review-empty, body > section > div:first-child, #lesson-desc, #text-lesson-panel';
        let frame = 0;
        let pageActive = true;
        let printing = false;
        let width = 1;
        let height = 1;
        let scrollTarget = window.scrollY;
        let scrollPosition = scrollTarget;
        let pointer = { x: .5, y: .4, targetX: .5, targetY: .4 };
        let pointerSurface = null;
        let pendingPointer = null;
        let palette;
        const canvas = document.createElement('canvas');
        canvas.className = 'ambient-motion-background ag-ambient-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        body.prepend(canvas);
        const context = canvas.getContext('2d', { alpha: true });
        const dots = Array.from({ length: 56 }, (_, index) => ({
            x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
            radius: .55 + Math.random() * 1.2, depth: .25 + Math.random() * .75,
            color: index % 3, px: 0, py: 0
        }));
        const bursts = [];
        const trail = [];

        const refreshPalette = () => {
            const dark = root.classList.contains('dark');
            palette = {
                dark,
                colors: dark ? ['158,119,255', '74,220,241', '208,218,255'] : ['107,65,220', '14,153,186', '128,111,191'],
                glow: dark ? .34 : .2,
                thread: dark ? .48 : .28,
                stars: dark ? .66 : .42
            };
        };
        const resize = () => {
            width = Math.max(1, window.innerWidth);
            height = Math.max(1, window.innerHeight);
            if (!context) return;
            const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        };
        const paintGlow = (x, y, radius, color, opacity) => {
            const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(${color},${opacity})`);
            gradient.addColorStop(.5, `rgba(${color},${opacity * .38})`);
            gradient.addColorStop(1, `rgba(${color},0)`);
            context.fillStyle = gradient;
            context.fillRect(0, 0, width, height);
        };
        const paintRibbon = (time, index) => {
            const color = palette.colors[index % 2];
            const phase = time * .00015 + index * 2.1;
            const center = height * (.2 + index * .24) + Math.sin(phase * .8) * height * .11;
            const xShift = (pointer.x - .5) * 40;
            const yShift = (pointer.y - .5) * 36 - Math.sin(scrollPosition * .0007) * 38;
            const ribbonHeight = height * .28;
            const gradient = context.createLinearGradient(0, center - ribbonHeight, 0, center + ribbonHeight);
            gradient.addColorStop(0, `rgba(${color},0)`);
            gradient.addColorStop(.45, `rgba(${color},${palette.glow * .35})`);
            gradient.addColorStop(.6, `rgba(${color},${palette.glow * .68})`);
            gradient.addColorStop(1, `rgba(${color},0)`);
            context.beginPath();
            context.moveTo(-40, center - ribbonHeight + yShift);
            context.bezierCurveTo(width * .24 + xShift, center + Math.sin(phase) * height * .22, width * .6, center - ribbonHeight * 1.3, width + 40, center + yShift);
            context.lineTo(width + 40, center + ribbonHeight + yShift);
            context.bezierCurveTo(width * .68, center + Math.cos(phase) * height * .2, width * .27 + xShift, center + ribbonHeight, -40, center + yShift);
            context.closePath();
            context.fillStyle = gradient;
            context.fill();
            // Fine chrome filaments trace the aurora without blurring the page.
            for (let filament = 0; filament < 3; filament++) {
                const offset = filament * 7;
                context.beginPath();
                context.moveTo(-20, center + offset + yShift);
                context.bezierCurveTo(width * .27 + xShift, center + Math.sin(phase + filament * .12) * height * .2, width * .66, center - ribbonHeight * .72, width + 20, center + offset + ribbonHeight * .18);
                context.strokeStyle = `rgba(${color},${palette.thread / (filament + 2)})`;
                context.lineWidth = .6;
                context.stroke();
            }
        };
        // A rotating wireframe field gives the backdrop depth without moving content.
        const paintOrbit = (time, cx, cy, radius, direction) => {
            context.save();
            context.translate(cx, cy);
            context.rotate(time * .000035 * direction);
            for (let i = 0; i < 16; i++) {
                const phase = i / 16 * Math.PI;
                context.beginPath();
                context.ellipse(0, 0, radius, radius * (.13 + .7 * Math.abs(Math.cos(phase + time * .00012))), phase, 0, Math.PI * 2);
                context.strokeStyle = `rgba(${palette.colors[i % 2]},${palette.thread * .17})`;
                context.lineWidth = .8;
                context.stroke();
            }
            for (let i = 0; i < 3; i++) {
                const angle = time * .00024 * direction + i * Math.PI * 2 / 3;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius * .48;
                context.beginPath();
                context.arc(x, y, 2.5, 0, Math.PI * 2);
                context.fillStyle = `rgba(${palette.colors[i]},.8)`;
                context.fill();
            }
            context.restore();
        };
        const resetSurface = () => {
            if (!pointerSurface) return;
            pointerSurface.classList.remove('ag-pointer-active');
            pointerSurface.style.removeProperty('--ag-pointer-x');
            pointerSurface.style.removeProperty('--ag-pointer-y');
            pointerSurface.style.removeProperty('--ag-tilt-x');
            pointerSurface.style.removeProperty('--ag-tilt-y');
            pointerSurface = null;
        };
        const updateSurface = () => {
            if (!pendingPointer) return;
            const event = pendingPointer;
            pendingPointer = null;
            const target = event.target instanceof Element ? event.target : null;
            const surface = target && !target.closest(excluded) ? target.closest(surfaceSelector) : null;
            if (surface !== pointerSurface) {
                resetSurface();
                pointerSurface = surface;
                pointerSurface?.classList.add('ag-pointer-active');
            }
            if (!surface) return;
            const rect = surface.getBoundingClientRect();
            surface.style.setProperty('--ag-pointer-x', `${Math.max(0, Math.min(100, (event.x - rect.left) / Math.max(1, rect.width) * 100)).toFixed(2)}%`);
            surface.style.setProperty('--ag-pointer-y', `${Math.max(0, Math.min(100, (event.y - rect.top) / Math.max(1, rect.height) * 100)).toFixed(2)}%`);
            surface.style.setProperty('--ag-tilt-x', `${((.5 - (event.y - rect.top) / Math.max(1, rect.height)) * 4).toFixed(2)}deg`);
            surface.style.setProperty('--ag-tilt-y', `${(((event.x - rect.left) / Math.max(1, rect.width) - .5) * 4).toFixed(2)}deg`);
        };
        const draw = (time) => {
            frame = 0;
            if (!pageActive || document.hidden || printing) return;
            updateSurface();
            if (context) {
                pointer.x += (pointer.targetX - pointer.x) * .045;
                pointer.y += (pointer.targetY - pointer.y) * .045;
                scrollPosition += (scrollTarget - scrollPosition) * .055;
                context.clearRect(0, 0, width, height);
                const orbit = time * .00009;
                paintGlow(width * (.23 + Math.sin(orbit) * .12), height * (.26 + Math.cos(orbit * .8) * .15), width * .57, palette.colors[0], palette.glow);
                paintGlow(width * (.77 + Math.cos(orbit * .7) * .1), height * (.66 + Math.sin(orbit) * .16), Math.max(width, height) * .49, palette.colors[1], palette.glow * .82);
                paintGlow(pointer.x * width, pointer.y * height, Math.max(width, height) * .28, palette.colors[1], palette.glow * .28);
                for (let ribbon = 0; ribbon < 3; ribbon++) paintRibbon(time, ribbon);
                paintOrbit(time, width * .86 + (pointer.x - .5) * 28, height * .3, Math.min(width * .27, 320), 1);
                paintOrbit(time, width * .05, height * .89, Math.min(width * .18, 210), -1);
                // Long comet trails travel through the background, never above a player.
                for (let i = 0; i < 3; i++) {
                    const phase = ((time + i * 3700) % 13000) / 13000;
                    if (phase > .22) continue;
                    const progress = phase / .22;
                    const x = width * (1.1 - progress * 1.3);
                    const y = height * (.05 + i * .24 + progress * .2);
                    const length = Math.min(180, width * .15);
                    const comet = context.createLinearGradient(x, y, x + length, y - length * .2);
                    comet.addColorStop(0, `rgba(${palette.colors[i]},${Math.sin(progress * Math.PI) * .75})`);
                    comet.addColorStop(1, `rgba(${palette.colors[i]},0)`);
                    context.strokeStyle = comet;
                    context.lineWidth = 1.5;
                    context.beginPath(); context.moveTo(x, y); context.lineTo(x + length, y - length * .2); context.stroke();
                }
                for (let i = trail.length - 1; i >= 0; i--) {
                    const point = trail[i];
                    const age = (time - point.time) / 650;
                    if (age >= 1) { trail.splice(i, 1); continue; }
                    context.beginPath();
                    context.arc(point.x, point.y, 2.5 * (1 - age), 0, Math.PI * 2);
                    context.fillStyle = `rgba(${palette.colors[i % 2]},${(1 - age) * .55})`;
                    context.fill();
                }
                for (const dot of dots) {
                    const drift = time * .00006;
                    dot.px = dot.x * width + Math.sin(drift + dot.phase) * 35 + (pointer.x - .5) * dot.depth * 34;
                    dot.py = ((dot.y * (height + 80) - scrollPosition * dot.depth * .07) % (height + 80) + height + 80) % (height + 80) - 40 + Math.cos(drift * .8 + dot.phase) * 24;
                    const pulse = .45 + (Math.sin(time * .001 + dot.phase) + 1) * .25;
                    context.beginPath();
                    context.arc(dot.px, dot.py, dot.radius, 0, Math.PI * 2);
                    context.fillStyle = `rgba(${palette.colors[dot.color]},${pulse * palette.stars})`;
                    context.fill();
                }
                for (let i = 0; i < dots.length; i++) {
                    for (let j = i + 1; j < dots.length; j++) {
                        const a = dots[i]; const b = dots[j];
                        const distanceSquared = (a.px - b.px) ** 2 + (a.py - b.py) ** 2;
                        if (distanceSquared > 18000) continue;
                        context.beginPath(); context.moveTo(a.px, a.py); context.lineTo(b.px, b.py);
                        context.lineWidth = .65;
                        context.strokeStyle = `rgba(${palette.colors[a.color]},${(1 - distanceSquared / 18000) * palette.thread * .48})`;
                        context.stroke();
                    }
                }
                for (let index = bursts.length - 1; index >= 0; index--) {
                    const burst = bursts[index];
                    const age = (time - burst.start) / 1200;
                    if (age >= 1) { bursts.splice(index, 1); continue; }
                    for (let n = 0; n < 22; n++) {
                        const angle = n / 22 * Math.PI * 2;
                        const radius = (1 - (1 - age) ** 3) * (55 + n % 3 * 16);
                        context.beginPath();
                        context.arc(burst.x + Math.cos(angle) * radius, burst.y + Math.sin(angle) * radius + age * age * 30, 2 * (1 - age), 0, Math.PI * 2);
                        context.fillStyle = `rgba(${n % 3 ? '52,211,153' : palette.colors[1]},${1 - age})`;
                        context.fill();
                    }
                }
            }
            frame = window.requestAnimationFrame(draw);
        };
        const start = () => {
            if (!frame && pageActive && !document.hidden && !printing) frame = window.requestAnimationFrame(draw);
        };
        const stop = () => { window.cancelAnimationFrame(frame); frame = 0; resetSurface(); };
        refreshPalette();
        resize();
        new MutationObserver(refreshPalette).observe(root, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', resize, { passive: true });
        window.addEventListener('scroll', () => { scrollTarget = window.scrollY; }, { passive: true });
        document.addEventListener('pointermove', (event) => {
            if (event.pointerType === 'touch') return;
            pointer.targetX = event.clientX / width;
            pointer.targetY = event.clientY / height;
            pendingPointer = { x: event.clientX, y: event.clientY, target: event.target };
            trail.push({ x: event.clientX, y: event.clientY, time: performance.now() });
            if (trail.length > 24) trail.shift();
        }, { passive: true });
        document.addEventListener('pointerleave', () => { pendingPointer = null; resetSurface(); }, { passive: true });
        document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
        window.addEventListener('pagehide', () => { pageActive = false; stop(); });
        window.addEventListener('pageshow', () => { pageActive = true; start(); });
        window.addEventListener('beforeprint', () => { printing = true; stop(); });
        window.addEventListener('afterprint', () => { printing = false; start(); });
        start();

        // A highlight responds to activation without moving the target or its label.
        document.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || !(event.target instanceof Element)) return;
            const control = event.target.closest('button, a[href], summary');
            if (!control || control.matches(':disabled, [aria-disabled="true"]') || control.closest(excluded)) return;
            const ring = document.createElement('span');
            ring.className = 'ag-click-glow';
            ring.setAttribute('aria-hidden', 'true');
            Object.assign(ring.style, {
                position: 'fixed', pointerEvents: 'none', zIndex: '9999', width: '44px', height: '44px',
                left: `${event.clientX - 22}px`, top: `${event.clientY - 22}px`, borderRadius: '50%',
                border: '1px solid rgba(116,218,255,.7)',
                background: 'radial-gradient(circle, rgba(157,129,255,.16), transparent 70%)'
            });
            body.appendChild(ring);
            const animation = ring.animate([{ opacity: .85, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(2.2)' }], { duration: 440, easing: 'cubic-bezier(.16,1,.3,1)' });
            animation.finished.then(() => ring.remove(), () => ring.remove());
        }, { passive: true });

        // Cosmetic entrance effects never hide content while waiting for observation.
        const seen = new WeakSet();
        const pendingEntrances = new Set();
        const entranceAnimations = new WeakMap();
        const revealed = new WeakSet();
        const activeEntrances = new Set();
        const reveal = (element, delay = 0) => {
            if (!element.isConnected || element.closest(excluded) || !element.getClientRects().length) return;
            if (revealed.has(element)) return;
            if (root.classList.contains('ag-home-loading')) { pendingEntrances.add(element); return; }
            revealed.add(element);
            if (element.closest('.ag-page-arrival-target, .ag-scroll-arrival-target') || element.contains(document.activeElement)) return;
            // Keep playing media stationary; its surrounding text can still enter.
            if ([...element.querySelectorAll('video, audio')].some((media) => !media.paused)) return;
            // Content may already have painted by the time this callback runs.
            // Keep its opacity intact instead of flashing it back to nearly invisible.
            element.classList.add('ag-scroll-arrival-target');
            activeEntrances.add(element);
            const animation = element.animate([
                { translate: '0 64px', scale: '.96' },
                { translate: '0 0', scale: '1' }
            ], { duration: 760, delay, fill: 'backwards', easing: 'cubic-bezier(.22,.72,.24,1)' });
            entranceAnimations.set(element, animation);
            const release = () => {
                element.classList.remove('ag-scroll-arrival-target');
                activeEntrances.delete(element);
                entranceAnimations.delete(element);
            };
            animation.finished.then(release, release);
        };
        const settleEntrances = () => activeEntrances.forEach((element) => entranceAnimations.get(element)?.cancel());
        window.addEventListener('pagehide', settleEntrances);
        window.addEventListener('beforeprint', settleEntrances);
        window.addEventListener('nyc:page-ready', () => {
            pendingEntrances.forEach((element) => {
                const rect = element.getBoundingClientRect();
                if (rect.bottom > 0 && rect.top < height) reveal(element);
            });
            pendingEntrances.clear();
        });
        const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
            const entering = entries.filter((entry) => entry.isIntersecting);
            entering.forEach((entry, index) => {
                observer.unobserve(entry.target);
                // A parent section and its cards must not pop on top of one another.
                if (entering.some((other) => other !== entry && other.target.contains(entry.target))) return;
                reveal(entry.target, Math.min(index * 45, 135));
            });
        }, { threshold: 0 }) : null;
        const prepare = (element) => {
            if (element.matches(surfaceSelector) && !element.closest(excluded)) element.classList.add('ag-interactive-surface');
            if (!element.matches(entranceSelector) || seen.has(element)) return;
            seen.add(element);
            observer?.observe(element);
        };
        const scan = (element) => {
            if (!(element instanceof Element)) return;
            prepare(element);
            element.querySelectorAll(`${surfaceSelector}, ${entranceSelector}`).forEach(prepare);
        };
        scan(body);
        new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(scan);
                    mutation.removedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        observer?.unobserve(node);
                        node.querySelectorAll(entranceSelector).forEach((element) => observer?.unobserve(element));
                    });
                }
                else if ((mutation.oldValue || '').split(/\s+/).includes('hidden') && !mutation.target.classList.contains('hidden')) {
                    const element = mutation.target;
                    // The intersection observer owns scroll entrances. Arbitrary
                    // hidden-state updates (buttons, validation, tabs) must not replay them.
                    if (element.matches(entranceSelector) && !element.matches('dialog, .fixed.inset-0.z-50') && !element.closest(excluded)) reveal(element);
                }
            }
        }).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

        // Keep native <details> semantics and keyboard behavior, animate its height.
        const accordionStates = new WeakMap();
        const activeAccordions = new Set();
        const finishAccordion = (details, state) => {
            if (accordionStates.get(details) !== state) return;
            details.open = state.open;
            details.style.height = state.height;
            details.style.overflow = state.overflow;
            details.style.boxSizing = state.boxSizing;
            accordionStates.delete(details);
            activeAccordions.delete(details);
        };
        document.addEventListener('click', (event) => {
            if (event.defaultPrevented || !(event.target instanceof Element)) return;
            const summary = event.target.closest('summary.curriculum-module-summary');
            const details = summary?.parentElement;
            if (!details?.matches('details.curriculum-module') || event.target.closest('a, button, input')) return;
            event.preventDefault();
            const previous = accordionStates.get(details);
            const startHeight = details.getBoundingClientRect().height;
            const open = previous ? !previous.open : !details.open;
            previous?.animation.cancel();
            const state = {
                open, height: previous?.height ?? details.style.height,
                overflow: previous?.overflow ?? details.style.overflow,
                boxSizing: previous?.boxSizing ?? details.style.boxSizing
            };
            accordionStates.set(details, state);
            activeAccordions.add(details);
            details.style.boxSizing = 'border-box';
            details.style.height = state.height;
            details.open = open;
            const endHeight = details.getBoundingClientRect().height;
            details.open = true;
            details.style.overflow = 'hidden';
            details.style.height = `${startHeight}px`;
            state.animation = details.animate([{ height: `${startHeight}px` }, { height: `${endHeight}px` }], { duration: 270, easing: 'cubic-bezier(.2,.8,.2,1)' });
            state.animation.onfinish = () => finishAccordion(details, state);
        });
        const settleAccordions = () => activeAccordions.forEach((details) => {
            const state = accordionStates.get(details);
            if (state) { state.animation.cancel(); finishAccordion(details, state); }
        });
        window.addEventListener('resize', settleAccordions, { passive: true });
        window.addEventListener('pagehide', settleAccordions);
        window.addEventListener('beforeprint', settleAccordions);

        const celebrate = (event) => {
            if (event.type === 'quiz:updated' && !event.detail?.passed) return;
            const targetId = String(event.detail?.lessonId || event.detail?.target || '');
            const moduleEvent = event.detail?.kind === 'module';
            const destination = [...document.querySelectorAll(moduleEvent ? '[data-player-module]' : '[data-player-lesson]')]
                .find((element) => String(moduleEvent ? element.dataset.playerModule : element.dataset.playerLesson) === targetId);
            const marker = destination?.querySelector(moduleEvent ? '[data-module-check]:not(.hidden)' : '.completion-check:not(.hidden)');
            const destinationRect = (marker || destination)?.getBoundingClientRect();
            const rect = destinationRect?.width && destinationRect.top >= 0 && destinationRect.top < height ? destinationRect : null;
            bursts.push({ start: performance.now(), x: rect ? rect.left + rect.width / 2 : width * .8, y: rect ? rect.top + rect.height / 2 : height * .25 });
            if (bursts.length > 4) bursts.shift();
            marker?.animate([{ scale: '.7', boxShadow: '0 0 0 0 rgba(52,211,153,.4)' }, { scale: '1.22', offset: .4 }, { scale: '1', boxShadow: '0 0 0 16px rgba(52,211,153,0)' }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
        };
        window.addEventListener('lesson:completed', celebrate);
        window.addEventListener('quiz:updated', celebrate);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();

/* Presentation only: no data requests, authentication, or route changes. */
(() => {
    const root = document.documentElement;
    const isHome = location.pathname === '/' || location.pathname.endsWith('/index.html');
    let overlay;
    let homeLogo;
    let flightFrame = 0;
    let finished = false;
    let departing = false;
    let nativeArrival = false;
    let pageRevealed = !('onpagereveal' in window);
    let loadRun = 0;
    const animations = [];
    const arrivalAnimations = new Set();
    const arrivalTargets = new Set();
    let arrivalSweep;
    const clearPageEntrance = () => {
        arrivalAnimations.forEach((animation) => animation.cancel());
        arrivalAnimations.clear();
        arrivalTargets.forEach((target) => target.classList.remove('ag-page-arrival-target'));
        arrivalTargets.clear();
        arrivalSweep?.remove();
    };
    const playPageEntrance = () => {
        if (!document.body || document.hidden || nativeArrival) return;
        clearPageEntrance();
        const sweep = document.createElement('div');
        sweep.className = 'ag-page-arrival-sweep';
        sweep.setAttribute('aria-hidden', 'true');
        document.body.appendChild(sweep);
        arrivalSweep = sweep;
        // The trailing band finishes after the first: don't cut it off mid-sweep.
        sweep.addEventListener('animationend', (event) => {
            if (event.pseudoElement === '::after') sweep.remove();
        });
        window.setTimeout(() => sweep.remove(), 1500);
        // Animate visible content on arrival, leaving the header and logo landing stable.
        const targets = [...document.querySelectorAll('body > main > *, .learning-sidebar > :first-child')]
            .filter((element) => !element.matches('script, style, .certificate-sheet, .certificate-loading')
                && !element.querySelector('.nyc-hero-core, video, iframe')
                && element.getClientRects().length)
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.bottom > 0 && rect.top < innerHeight;
            });
        targets.forEach((target, index) => {
            if (!target.animate) return;
            target.classList.add('ag-page-arrival-target');
            arrivalTargets.add(target);
            const animation = target.animate([
                { translate: '0 32px' },
                { translate: '0 0' }
            ], { duration: 840, delay: Math.min(index * 35, 105), easing: 'cubic-bezier(.33,0,.2,1)', fill: 'backwards' });
            arrivalAnimations.add(animation);
            const release = () => {
                if (!arrivalAnimations.delete(animation)) return;
                arrivalTargets.delete(target);
                target.classList.remove('ag-page-arrival-target');
            };
            animation.finished.then(release, release);
        });
    };
    root.classList.add('ag-loading');
    root.classList.toggle('ag-home-loading', isHome);

    const synchronizeLogo = () => {
        const loaderLogo = overlay?.querySelector('.nyc-hero-core');
        if (!homeLogo?.getAnimations || !loaderLogo?.getAnimations) return;
        // The loader is an exact copy, including the SVG and orbital rings. Both
        // continue on the same clock while the original waits in its normal layout.
        const homeAnimations = homeLogo.getAnimations({ subtree: true });
        loaderLogo.getAnimations({ subtree: true }).forEach((animation) => {
            const source = homeAnimations.find((candidate) => candidate.animationName === animation.animationName);
            if (source?.startTime != null) animation.startTime = source.startTime;
        });
    };

    const cleanUp = () => {
        if (finished) return;
        finished = true;
        window.cancelAnimationFrame(flightFrame);
        animations.forEach((animation) => animation.cancel());
        overlay?.remove();
        root.classList.remove('ag-loading', 'ag-home-loading', 'ag-loader-mounted', 'ag-logo-arriving');
        window.clearTimeout(watchdog);
        window.dispatchEvent(new Event('nyc:page-ready'));
    };
    // Loading decoration must never trap a page if a resource stalls or fails.
    let watchdog = window.setTimeout(cleanUp, 4000);
    const smooth = (value) => {
        const t = Math.max(0, Math.min(1, value));
        return t * t * t * (t * (t * 6 - 15) + 10);
    };
    const readHomeGeometry = () => {
        if (!homeLogo?.isConnected) return null;
        const style = getComputedStyle(homeLogo);
        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        if (!(width > 0 && height > 0)) return null;
        const rect = homeLogo.getBoundingClientRect();
        const transform = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
        return { width, height, rect, floatX: transform.e, floatY: transform.f };
    };
    const landHomeLogo = (logo, initial) => {
        const startX = innerWidth / 2;
        const startY = innerHeight / 2;
        const startSize = Math.min(164, innerWidth * .3);
        const backdrop = overlay.querySelector('.ag-loader-backdrop');
        const caption = overlay.querySelector('.ag-loader-caption');
        const hold = 160;
        const duration = 1080;
        let started;
        let width = 0;
        let height = 0;
        // Keep the flight wrapper separate from the orb's animated transform.
        logo.style.left = '0';
        logo.style.top = '0';
        const paint = (geometry, progress) => {
            if (geometry.width !== width || geometry.height !== height) {
                width = geometry.width;
                height = geometry.height;
                logo.style.width = `${width}px`;
                logo.style.height = `${height}px`;
            }
            const scale = startSize / Math.max(width, height) * (1 - progress) + progress;
            const targetX = geometry.rect.left + geometry.rect.width / 2;
            const targetY = geometry.rect.top + geometry.rect.height / 2;
            // Subtract the clone's own float: the endpoint is the real logo's
            // current visual center, not a stale box measured before the flight.
            const x = startX + (targetX - startX) * progress - geometry.floatX * scale - width / 2;
            const y = startY + (targetY - startY) * progress - geometry.floatY * scale - height / 2;
            logo.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
        };
        paint(initial, 0);
        logo.style.opacity = '0';
        root.classList.add('ag-logo-arriving');
        const tick = (time) => {
            if (finished) return;
            try {
                if (started === undefined) started = time;
                const elapsed = time - started;
                const progress = Math.max(0, Math.min(1, (elapsed - hold) / duration));
                const geometry = readHomeGeometry();
                if (!geometry) { cleanUp(); return; }
                // Re-measure for scrolling, resizing and late layout changes.
                paint(geometry, smooth(progress));
                logo.style.opacity = String(smooth(elapsed / hold));
                backdrop.style.opacity = String(1 - smooth((progress - .08) / .76));
                caption.style.opacity = String(1 - smooth((elapsed - hold) / 360));
                if (progress === 1) {
                    // Reveal the original and remove its identical copy in this
                    // same frame. No fade-out, duplicate logo or empty-frame gap.
                    cleanUp();
                    return;
                }
                flightFrame = window.requestAnimationFrame(tick);
            } catch (_) { cleanUp(); }
        };
        flightFrame = window.requestAnimationFrame(tick);
    };
    const arrive = () => {
        if (finished || departing || !overlay) return;
        departing = true;
        const run = loadRun;
        const logo = overlay.querySelector('.ag-loader-flight');
        if (!logo.animate) { cleanUp(); return; }
        try {
            synchronizeLogo();
            const geometry = readHomeGeometry();
            const rect = geometry?.rect;
            const visibleHomeLogo = rect && rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
            if (visibleHomeLogo) {
                landHomeLogo(logo, geometry);
                return;
            }
            // On narrow screens the hero may be below the fold: dissolve the
            // loader without moving the page or flying toward an invisible target.
            const duration = isHome ? 900 : 380;
            root.classList.remove('ag-logo-arriving');
            animations.push(logo.animate([
                { opacity: 0, transform: 'scale(.94)' },
                { opacity: 1, transform: 'scale(1)', offset: .22 },
                { opacity: 1, transform: 'scale(1)', offset: .45 },
                { opacity: 0, transform: 'scale(.96) translateY(-10px)' }
            ], { duration, easing: 'ease-in-out', fill: 'forwards' }));
            animations.push(overlay.querySelector('.ag-loader-backdrop').animate([{ opacity: 1 }, { opacity: 0 }], { delay: duration * .2, duration: duration * .8, easing: 'ease-in-out', fill: 'both' }));
            animations.push(overlay.querySelector('.ag-loader-caption').animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * .65, easing: 'ease-in-out', fill: 'forwards' }));
            const settle = () => { if (run === loadRun) cleanUp(); };
            animations[0].finished.then(settle, settle);
        } catch (_) { cleanUp(); }
    };
    const scheduleArrival = () => {
        if (!pageRevealed || document.hidden || finished || departing || !overlay) return;
        const run = loadRun;
        // A link navigation can hold rendering for a document transition. Start
        // the intro on the visible document's clock, never behind its snapshot.
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (run === loadRun && !document.hidden) arrive();
        }));
    };
    const mount = () => {
        if (finished || overlay?.isConnected) return;
        if (!isHome) playPageEntrance();
        overlay = document.createElement('div');
        overlay.className = isHome ? 'ag-loader' : 'ag-loader ag-loader--compact';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-label', 'Loading NYC');
        overlay.innerHTML = '<div class="ag-loader-backdrop"></div><div class="ag-loader-flight" aria-hidden="true"><div class="ag-loader-orb"><span>NYC</span></div></div><p class="ag-loader-caption" aria-hidden="true">Entering NYC<span></span></p>';
        homeLogo = isHome ? document.querySelector('.nyc-hero-art .nyc-hero-core') : null;
        if (homeLogo) {
            const copy = homeLogo.cloneNode(true);
            copy.removeAttribute('id');
            copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
            overlay.querySelector('.ag-loader-flight').replaceChildren(copy);
            root.classList.add('ag-logo-arriving');
        }
        document.body.appendChild(overlay);
        root.classList.add('ag-loader-mounted');
        synchronizeLogo();
        // Two frames establish the CSS clocks. The longer home flight is only
        // decoration; images, requests and navigation continue immediately.
        scheduleArrival();
    };
    const replayHomeIntro = () => {
        cleanUp();
        clearPageEntrance();
        // Cancellation callbacks from the previous intro must not end this one.
        loadRun++;
        finished = false;
        departing = false;
        nativeArrival = false;
        animations.length = 0;
        overlay = null;
        root.classList.remove('page-leaving', 'ag-native-transition');
        root.classList.add('ag-loading', 'ag-home-loading');
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        watchdog = window.setTimeout(cleanUp, 4000);
        mount();
    };
    document.addEventListener('click', (event) => {
        if (!isHome || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest('nav > a[href]:first-child') : null;
        if (!link || link.target || link.hasAttribute('download')) return;
        const destination = new URL(link.href, location.href);
        if (destination.origin !== location.origin || destination.search !== location.search || destination.hash) return;
        if (destination.pathname !== '/' && destination.pathname !== '/index.html') return;
        event.preventDefault();
        // Reuse the loaded home page, preserving the orb's running rotation.
        replayHomeIntro();
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
    // Native document snapshots bridge the actual navigation, rather than
    // snapping from an unfinished exit animation to a separate entrance.
    window.addEventListener('pageswap', (event) => {
        if (!event.viewTransition) return;
        const destination = event.activation?.entry?.url;
        const path = destination ? new URL(destination).pathname : '';
        if (path === '/' || path === '/index.html') {
            // Opt out before the old page is captured: the home intro owns this
            // transition, so it cannot be obscured by a second snapshot layer.
            event.viewTransition.skipTransition();
            return;
        }
        root.classList.add('ag-native-transition');
        root.classList.remove('page-leaving');
        clearPageEntrance();
        window.dispatchEvent(new Event('nyc:page-transition-start'));
        cleanUp();
        event.viewTransition.finished.then(() => root.classList.remove('ag-native-transition'));
    });
    window.addEventListener('pagereveal', (event) => {
        pageRevealed = true;
        if (!event.viewTransition) { scheduleArrival(); return; }
        // A fresh home visit has its own continuous logo entrance. A cached
        // home page uses the normal page transition without replaying the loader.
        if (isHome && !finished) {
            event.viewTransition.skipTransition();
            scheduleArrival();
            return;
        }
        nativeArrival = true;
        root.classList.add('ag-native-transition');
        clearPageEntrance();
        window.dispatchEvent(new Event('nyc:page-transition-start'));
        cleanUp();
        event.viewTransition.finished.then(() => {
            nativeArrival = false;
            root.classList.remove('ag-native-transition');
        });
    });
    window.addEventListener('pagehide', () => { cleanUp(); clearPageEntrance(); });
    window.addEventListener('pageshow', (event) => {
        root.classList.remove('page-leaving');
        if (event.persisted) {
            cleanUp();
            if (!nativeArrival) root.classList.remove('ag-native-transition');
            playPageEntrance();
        }
    });
    window.addEventListener('beforeprint', () => { cleanUp(); clearPageEntrance(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && departing) cleanUp();
        else if (!document.hidden) scheduleArrival();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' || event.key === 'Tab') cleanUp(); });
})();

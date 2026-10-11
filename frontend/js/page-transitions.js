/* Presentation only: no data requests, authentication, or route changes. */
(() => {
    const root = document.documentElement;
    const isHome = location.pathname === '/' || location.pathname.endsWith('/index.html');
    let overlay;
    let finished = false;
    let departing = false;
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
        if (!document.body || document.hidden) return;
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
        window.setTimeout(() => sweep.remove(), 1200);
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
            ], { duration: 640, delay: Math.min(index * 40, 120), easing: 'cubic-bezier(.22,.72,.24,1)', fill: 'backwards' });
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
        const homeLogo = document.querySelector('.nyc-hero-core');
        const loaderLogo = overlay?.querySelector('.ag-loader-orb');
        if (!homeLogo?.getAnimations || !loaderLogo?.getAnimations) return;
        // Both logos use identical orbital axes and periods, on the same document clock.
        // The home logo keeps running while hidden; revealing it never restarts a spin.
        const homeAnimations = homeLogo.getAnimations({ subtree: true });
        loaderLogo.getAnimations({ subtree: true }).forEach((animation) => {
            const name = animation.animationName === 'ag-orb-orientation' ? 'ag-orb-float' : animation.animationName;
            const source = homeAnimations.find((candidate) => candidate.animationName === name);
            if (source?.startTime != null) animation.startTime = source.startTime;
        });
    };

    const cleanUp = () => {
        if (finished) return;
        finished = true;
        animations.forEach((animation) => animation.cancel());
        overlay?.remove();
        root.classList.remove('ag-loading', 'ag-home-loading', 'ag-loader-mounted', 'ag-logo-arriving');
        window.clearTimeout(watchdog);
        window.dispatchEvent(new Event('nyc:page-ready'));
    };
    // Loading decoration must never trap a page if a resource stalls or fails.
    const watchdog = window.setTimeout(cleanUp, 4000);
    const arrive = () => {
        if (finished || departing || !overlay) return;
        departing = true;
        const logo = overlay.querySelector('.ag-loader-flight');
        const homeLogo = document.querySelector('.nyc-hero-core');
        const rect = homeLogo?.getBoundingClientRect();
        const visibleHomeLogo = rect && rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
        const duration = visibleHomeLogo ? 620 : 160;
        if (!logo.animate) { cleanUp(); return; }
        try {
            synchronizeLogo();
            if (visibleHomeLogo) {
                root.classList.add('ag-logo-arriving');
                const start = logo.getBoundingClientRect();
                const x = rect.left + rect.width / 2 - (start.left + start.width / 2);
                const y = rect.top + rect.height / 2 - (start.top + start.height / 2);
                animations.push(logo.animate([
                    { transform: 'translate(0,0) scale(1)', opacity: 1 },
                    { transform: `translate(${x}px,${y}px) scale(${homeLogo.offsetWidth / logo.offsetWidth},${homeLogo.offsetHeight / logo.offsetHeight})`, opacity: 1, offset: .86 },
                    { transform: `translate(${x}px,${y}px) scale(${homeLogo.offsetWidth / logo.offsetWidth},${homeLogo.offsetHeight / logo.offsetHeight})`, opacity: 0 }
                ], { duration, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' }));
                window.setTimeout(() => root.classList.remove('ag-logo-arriving'), duration * .8);
            } else {
                animations.push(logo.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.86) translateY(-14px)' }], { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }));
            }
            animations.push(overlay.querySelector('.ag-loader-backdrop').animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * .75, fill: 'forwards' }));
            overlay.querySelector('.ag-loader-caption').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
            animations[0].finished.then(cleanUp, cleanUp);
        } catch (_) { cleanUp(); }
    };
    const mount = () => {
        if (finished) return;
        if (!isHome) playPageEntrance();
        overlay = document.createElement('div');
        overlay.className = isHome ? 'ag-loader' : 'ag-loader ag-loader--compact';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-label', 'Loading NYC');
        overlay.innerHTML = '<div class="ag-loader-backdrop"></div><div class="ag-loader-flight" aria-hidden="true"><div class="ag-loader-orb"><span>NYC</span></div></div><p class="ag-loader-caption" aria-hidden="true">Entering NYC<span></span></p>';
        document.body.appendChild(overlay);
        root.classList.add('ag-loader-mounted');
        synchronizeLogo();
        // Layout is ready at DOMContentLoaded. Don't wait for images/video or impose
        // a minimum loading delay on every page. Two frames establish the CSS clocks.
        window.requestAnimationFrame(() => window.requestAnimationFrame(arrive));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
    window.addEventListener('pagehide', () => { cleanUp(); clearPageEntrance(); });
    window.addEventListener('pageshow', (event) => {
        root.classList.remove('page-leaving');
        if (event.persisted) { cleanUp(); playPageEntrance(); }
    });
    window.addEventListener('beforeprint', () => { cleanUp(); clearPageEntrance(); });
    window.addEventListener('resize', () => { if (departing) cleanUp(); }, { passive: true });
    window.addEventListener('scroll', () => { if (departing) cleanUp(); }, { passive: true });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' || event.key === 'Tab') cleanUp(); });
})();

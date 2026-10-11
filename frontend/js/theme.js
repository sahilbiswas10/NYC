(() => {
    const root = document.documentElement;
    let currentTheme = 'dark';
    const savedTheme = () => {
        try { return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'; }
        catch (_) { return currentTheme; }
    };
    const updateIcon = () => {
        const button = document.getElementById('theme-toggle');
        if (!button) return;
        const dark = currentTheme === 'dark';
        button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
        button.setAttribute('title', dark ? 'Switch to light theme' : 'Switch to dark theme');
        if (button.dataset.themeIcon === currentTheme) return;
        button.dataset.themeIcon = currentTheme;
        button.innerHTML = dark
            ? '<i data-lucide="moon" class="w-5 h-5" aria-hidden="true"></i>'
            : '<i data-lucide="sun" class="w-5 h-5" aria-hidden="true"></i>';
        window.lucide?.createIcons();
    };
    const applyTheme = (theme) => {
        currentTheme = theme;
        root.classList.toggle('dark', theme === 'dark');
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080d1c' : '#eef1fb');
        updateIcon();
    };
    applyTheme(savedTheme());
    window.initThemeToggle = () => {
        const button = document.getElementById('theme-toggle');
        if (!button) return;
        updateIcon();
        if (button.dataset.themeBound) return;
        button.dataset.themeBound = 'true';
        button.addEventListener('click', () => {
            const next = root.classList.contains('dark') ? 'light' : 'dark';
            try { localStorage.setItem('theme', next); } catch (_) { /* Keep this page usable when storage is unavailable. */ }
            applyTheme(next);
        });
    };
    // Back/Forward restores an old DOM snapshot without executing this file again.
    window.addEventListener('pageshow', () => {
        applyTheme(savedTheme());
        root.classList.remove('page-leaving');
        window.initThemeToggle();
    });
    window.addEventListener('storage', (event) => {
        if (event.key === 'theme' || event.key === null) applyTheme(savedTheme());
    });
    document.addEventListener('DOMContentLoaded', () => window.initThemeToggle());
})();

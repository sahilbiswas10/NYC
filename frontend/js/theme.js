(function() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }
})();

window.initThemeToggle = function() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        // Remove existing listeners by cloning (if any)
        const newToggle = themeToggle.cloneNode(true);
        themeToggle.parentNode.replaceChild(newToggle, themeToggle);
        
        const updateIcon = () => {
            const isDark = document.documentElement.classList.contains('dark');
            newToggle.innerHTML = isDark 
                ? '<i data-lucide="moon" class="w-5 h-5"></i>' 
                : '<i data-lucide="sun" class="w-5 h-5"></i>';
            if (window.lucide) {
                lucide.createIcons();
            }
        };
        
        updateIcon();

        newToggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            const isDark = document.documentElement.classList.contains('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateIcon();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // Only init if navbar.js is NOT going to override it right after
    if (!document.querySelector('script[src*="navbar.js"]')) {
        window.initThemeToggle();
    }
});

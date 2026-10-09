const getSafeReturnTo = () => {
    const requested = new URLSearchParams(window.location.search).get('returnTo');
    if (!requested || requested.startsWith('//') || requested.includes('\\')) return null;
    try {
        const destination = new URL(requested, window.location.href);
        if (destination.origin !== window.location.origin || ['/login.html', '/register.html'].includes(destination.pathname)) return null;
        return `${destination.pathname}${destination.search}${destination.hash}`;
    } catch (error) {
        return null;
    }
};

const signOut = async (redirectTo = '/index.html') => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (error) {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = redirectTo;
};

document.addEventListener('DOMContentLoaded', () => {
    const returnTo = getSafeReturnTo();
    const registerLink = document.querySelector('a[href="register.html"]');
    const loginLink = document.querySelector('a[href="login.html"]');
    if (returnTo && registerLink) registerLink.href = `register.html?returnTo=${encodeURIComponent(returnTo)}`;
    if (returnTo && loginLink) loginLink.href = `login.html?returnTo=${encodeURIComponent(returnTo)}`;

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const result = await window.api.auth.login({
                    email: document.getElementById('email').value,
                    password: document.getElementById('password').value
                });
                localStorage.setItem('token', result.token);
                localStorage.setItem('user', JSON.stringify(result.user));
                if (result.user.role === 'admin') window.location.href = '/admin/dashboard.html';
                else if (returnTo) window.location.href = returnTo;
                else if (result.user.role === 'instructor') window.location.href = '/instructor/dashboard.html';
                else window.location.href = '/student/dashboard.html';
            } catch (error) {
                window.NYCUI.alert(error.message || 'Unable to sign in. Please try again.');
            }
        });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        const registerError = document.getElementById('register-error');
        const registerPassword = document.getElementById('password');
        registerPassword?.addEventListener('input', () => {
            if (registerPassword.value.length >= 8) registerPassword.setCustomValidity('');
        });
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (registerPassword && registerPassword.value.length < 8) {
                registerPassword.setCustomValidity('Use at least 8 characters for your password.');
                registerPassword.reportValidity();
                return;
            }
            if (registerError) registerError.classList.add('hidden');
            try {
                const result = await window.api.auth.register({
                    name: document.getElementById('name').value.trim(),
                    email: document.getElementById('email').value.trim(),
                    password: document.getElementById('password').value
                });
                localStorage.setItem('token', result.token);
                localStorage.setItem('user', JSON.stringify(result.user));
                window.location.href = returnTo || '/student/dashboard.html';
            } catch (error) {
                if (registerError) {
                    registerError.textContent = error.message || 'Unable to create your account. Please try again.';
                    registerError.classList.remove('hidden');
                } else window.NYCUI.alert(error.message || 'Unable to create your account. Please try again.');
            }
        });
    }

    document.querySelectorAll('[data-profile-logout]').forEach((button) => {
        button.addEventListener('click', () => signOut());
    });
});

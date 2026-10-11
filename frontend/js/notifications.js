(() => {
    if (window.nycNotificationsLoaded) return;
    window.nycNotificationsLoaded = true;
    const init = () => {
        const list = document.getElementById('notification-list');
        if (!localStorage.getItem('token')) {
            if (list) location.replace(`login.html?returnTo=${encodeURIComponent('/notifications.html')}`);
            return;
        }
        const bell = document.createElement('a');
        bell.className = 'notification-bell'; bell.href = '/notifications.html';
        bell.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-badge" hidden></span>';
        bell.setAttribute('aria-label', 'Notifications');
        const host = document.getElementById('nav-links') || document.getElementById('back-dashboard-btn')?.parentElement;
        host?.appendChild(bell);
        let page = 1, pages = 1, busy = false;
        const status = document.getElementById('notifications-status');
        const request = async (path = '', options = {}) => {
            const response = await fetch(`/api/notifications${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load notifications');
            return data;
        };
        const badge = count => {
            const element = bell.querySelector('span'); element.hidden = !count; element.textContent = count > 99 ? '99+' : count;
            bell.setAttribute('aria-label', `Notifications${count ? `, ${count} unread` : ''}`);
        };
        const load = async () => {
            if (busy || document.hidden) return;
            busy = true;
            try {
                const response = await request(`?page=${list ? page : 1}`); badge(response.unread);
                if (!list) return;
                pages = response.pages;
                if (page > pages) { page = pages; busy = false; return load(); }
                status.textContent = response.total ? `${response.unread} unread · ${response.total} notifications` : 'You’re all caught up. New notifications will appear here.';
                list.replaceChildren();
                for (const item of response.data) {
                    const card = document.createElement('article'); card.className = `feature-panel notification-item${item.readAt ? '' : ' is-unread'}`;
                    const title = document.createElement('h2'); title.textContent = item.title;
                    const message = document.createElement('p'); message.textContent = item.message;
                    const time = document.createElement('time'); time.dateTime = item.createdAt; time.textContent = new Date(item.createdAt).toLocaleString();
                    const actions = document.createElement('div'); actions.className = 'feature-actions';
                    const action = (label, fn) => { const button = document.createElement('button'); button.className = 'feature-button'; button.textContent = label; button.addEventListener('click', async () => { button.disabled = true; try { await fn(); await load(); } catch (error) { status.textContent = error.message; button.disabled = false; } }); actions.appendChild(button); };
                    if (item.href?.startsWith('/') && !item.href.startsWith('//')) action('Open', async () => { await request(`/${item._id}/read`, { method: 'PUT' }); location.assign(item.href); });
                    if (!item.readAt) action('Mark as read', () => request(`/${item._id}/read`, { method: 'PUT' }));
                    action('Dismiss', () => request(`/${item._id}`, { method: 'DELETE' }));
                    card.append(title, message, time, actions); list.appendChild(card);
                }
                document.getElementById('notifications-page').textContent = `Page ${page} of ${pages}`;
                document.getElementById('notifications-previous').disabled = page <= 1;
                document.getElementById('notifications-next').disabled = page >= pages;
            } catch (error) { if (status) status.textContent = error.message; }
            finally { busy = false; }
        };
        document.getElementById('notifications-refresh')?.addEventListener('click', load);
        document.getElementById('notifications-read-all')?.addEventListener('click', async event => { event.target.disabled = true; try { await request('/read-all', { method: 'PUT' }); await load(); } catch (error) { status.textContent = error.message; } finally { event.target.disabled = false; } });
        document.getElementById('notifications-previous')?.addEventListener('click', () => { if (page > 1) { page--; load(); } });
        document.getElementById('notifications-next')?.addEventListener('click', () => { if (page < pages) { page++; load(); } });
        let timer;
        const start = () => { clearInterval(timer); timer = setInterval(load, 60000); load(); };
        window.addEventListener('pagehide', () => clearInterval(timer));
        window.addEventListener('pageshow', start);
        window.addEventListener('focus', load);
        window.addEventListener('notifications:changed', load);
        start();
    };
    // Run after the navbar has populated its links.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);
})();

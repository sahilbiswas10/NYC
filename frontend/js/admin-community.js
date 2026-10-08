const communityDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
};

document.addEventListener('DOMContentLoaded', async () => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) { window.location.replace('../login.html'); return; }
    if (user?.role !== 'admin') { window.location.replace(user?.role === 'instructor' ? '../instructor/dashboard.html' : '../student/dashboard.html'); return; }

    const list = document.getElementById('community-list');
    const errorBox = document.getElementById('community-error');
    const status = document.getElementById('community-status');
    const discussionTab = document.getElementById('show-discussions');
    const reviewTab = document.getElementById('show-reviews');
    let activeTab = 'discussions';
    let page = 1;
    let totalPages = 1;

    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };

    const removeItem = async (id, kind, button) => {
        const label = kind === 'discussion' ? 'discussion post and its replies' : 'course review';
        if (!window.confirm(`Permanently delete this ${label}?`)) return;
        button.disabled = true;
        try {
            if (kind === 'discussion') await window.api.admin.deleteDiscussion(id);
            else await window.api.admin.deleteReview(id);
            errorBox.classList.add('hidden');
            await loadActiveTab();
        } catch (error) {
            errorBox.textContent = error.message || `Unable to delete ${label}.`;
            errorBox.classList.remove('hidden');
            button.disabled = false;
        }
    };

    const createEntry = (item, kind) => {
        const card = node('article', 'bg-[var(--bg-color)] brutal-border brutal-shadow p-5 md:p-6');
        const top = node('div', 'flex flex-col md:flex-row md:items-start md:justify-between gap-4');
        const metadata = node('div', 'min-w-0');
        const course = item.course?.title || 'Deleted course';
        const author = kind === 'discussion' ? item.author?.name : item.student?.name;
        metadata.append(
            node('p', 'text-sm font-black uppercase text-[var(--accent)]', kind === 'discussion' ? (item.parent ? 'Discussion reply' : 'Discussion thread') : `${Math.max(1, Math.min(5, Number(item.rating) || 0))} / 5 stars`),
            node('h2', 'text-lg md:text-xl font-black uppercase mt-1 break-words', course),
            node('p', 'text-sm font-bold mt-1 opacity-75', `By ${author || 'Deleted account'} · ${communityDate(item.createdAt)}`)
        );
        const remove = node('button', 'shrink-0 bg-[var(--accent)] text-white brutal-border px-4 py-2 font-black uppercase', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', () => removeItem(item._id, kind === 'discussion' ? 'discussion' : 'review', remove));
        top.append(metadata, remove);
        card.appendChild(top);
        card.appendChild(node('p', 'mt-4 whitespace-pre-wrap break-words leading-relaxed', item.message || item.comment || 'No text was saved.'));
        return card;
    };

    const loadActiveTab = async () => {
        errorBox.classList.add('hidden');
        status.textContent = activeTab === 'discussions' ? 'Loading discussion posts…' : 'Loading course reviews…';
        list.replaceChildren();
        try {
            const response = activeTab === 'discussions'
                ? await window.api.admin.getDiscussions(page)
                : await window.api.admin.getReviews(page);
            const items = Array.isArray(response.data) ? response.data : [];
            totalPages = response.pagination?.totalPages || 1;
            if (page > totalPages) { page = totalPages; return loadActiveTab(); }
            status.textContent = `${response.pagination?.total || items.length} ${activeTab === 'discussions' ? 'discussion posts' : 'course reviews'} · page ${page} of ${totalPages}`;
            document.getElementById('community-page').textContent = `Page ${page} of ${totalPages}`;
            document.getElementById('community-prev').disabled = page <= 1;
            document.getElementById('community-next').disabled = page >= totalPages;
            if (!items.length) {
                list.appendChild(node('p', 'bg-[var(--bg-color)] brutal-border p-6 font-bold', `No ${activeTab === 'discussions' ? 'discussion posts' : 'course reviews'} found.`));
                return;
            }
            for (const item of items) list.appendChild(createEntry(item, activeTab === 'discussions' ? 'discussion' : 'review'));
        } catch (error) {
            status.textContent = 'Community content could not be loaded.';
            errorBox.textContent = error.message || 'Unable to load community content.';
            errorBox.classList.remove('hidden');
        }
    };

    const selectTab = (tab) => {
        activeTab = tab;
        page = 1;
        const discussionsSelected = tab === 'discussions';
        discussionTab.setAttribute('aria-selected', String(discussionsSelected));
        reviewTab.setAttribute('aria-selected', String(!discussionsSelected));
        discussionTab.className = `${discussionsSelected ? 'bg-[var(--primary)] text-black' : 'bg-[var(--bg-color)] text-[var(--foreground)]'} brutal-border px-5 py-3 font-black uppercase`;
        reviewTab.className = `${!discussionsSelected ? 'bg-[var(--primary)] text-black' : 'bg-[var(--bg-color)] text-[var(--foreground)]'} brutal-border px-5 py-3 font-black uppercase`;
        loadActiveTab();
    };

    discussionTab.addEventListener('click', () => selectTab('discussions'));
    reviewTab.addEventListener('click', () => selectTab('reviews'));
    document.getElementById('community-prev').addEventListener('click', () => { if (page > 1) { page -= 1; loadActiveTab(); } });
    document.getElementById('community-next').addEventListener('click', () => { if (page < totalPages) { page += 1; loadActiveTab(); } });
    await loadActiveTab();
});

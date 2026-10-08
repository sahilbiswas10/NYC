document.addEventListener('DOMContentLoaded', () => {
    const courseId = new URLSearchParams(window.location.search).get('course');
    const list = document.getElementById('discussion-list');
    const form = document.getElementById('discussion-form');
    const input = document.getElementById('discussion-message');
    const status = document.getElementById('discussion-status');
    const replyLabel = document.getElementById('discussion-replying-to');
    const cancelReply = document.getElementById('discussion-cancel-reply');
    if (!courseId || !list || !form) return;

    const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const dateLabel = (date) => {
        const parsed = new Date(date);
        return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    };
    let replyParentId = null;

    const renderPost = (post, isReply = false) => {
        const name = post.author?.name || 'Student';
        const replies = !isReply && Array.isArray(post.replies) ? post.replies : [];
        return `
            <article class="discussion-post ${isReply ? 'discussion-reply' : ''}">
                <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                    <h3 class="font-black uppercase">${escapeHtml(name)}</h3>
                    <time class="discussion-time" datetime="${escapeHtml(post.createdAt || '')}">${escapeHtml(dateLabel(post.createdAt))}</time>
                </div>
                <p class="discussion-message">${escapeHtml(post.message)}</p>
                ${!isReply ? `<button type="button" class="discussion-reply-button" data-reply-to="${escapeHtml(post._id)}" data-reply-author="${escapeHtml(name)}">Reply</button>` : ''}
                ${replies.length ? `<div class="discussion-replies">${replies.map((reply) => renderPost(reply, true)).join('')}</div>` : ''}
            </article>`;
    };

    const loadDiscussion = async () => {
        list.innerHTML = '<p class="font-bold p-4">Loading discussion…</p>';
        try {
            const response = await window.api.discussions.getForCourse(courseId);
            list.innerHTML = response.data.length
                ? response.data.map((post) => renderPost(post)).join('')
                : '<p class="discussion-empty">No discussion yet. Start the conversation.</p>';
        } catch (error) {
            list.innerHTML = `<p class="discussion-empty discussion-error">${escapeHtml(error.message)}</p>`;
        }
    };

    window.addEventListener('course:enrolled', (event) => {
        if (String(event.detail?.courseId) === String(courseId)) loadDiscussion();
    });

    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-reply-to]');
        if (!button) return;
        replyParentId = button.dataset.replyTo;
        replyLabel.textContent = `Replying to ${button.dataset.replyAuthor}`;
        replyLabel.classList.remove('hidden');
        cancelReply.classList.remove('hidden');
        input.focus();
    });

    cancelReply.addEventListener('click', () => {
        replyParentId = null;
        replyLabel.classList.add('hidden');
        cancelReply.classList.add('hidden');
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;
        const submit = document.getElementById('discussion-submit');
        submit.disabled = true;
        status.textContent = 'Posting…';
        try {
            await window.api.discussions.postToCourse(courseId, { message, parentId: replyParentId });
            input.value = '';
            replyParentId = null;
            replyLabel.classList.add('hidden');
            cancelReply.classList.add('hidden');
            status.textContent = 'Posted.';
            await loadDiscussion();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    });
});

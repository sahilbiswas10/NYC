document.addEventListener('DOMContentLoaded', async () => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) { window.location.replace('../login.html'); return; }
    if (user?.role !== 'admin') { window.location.replace(user?.role === 'instructor' ? '../instructor/dashboard.html' : '../student/dashboard.html'); return; }
    const table = document.getElementById('media-table');
    const errorBox = document.getElementById('media-error');
    const replacementInput = document.getElementById('media-replacement-input');
    const textCell = (text) => { const td = document.createElement('td'); td.className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10 align-top'; td.textContent = text; return td; };
    const showError = (message) => { errorBox.textContent = message; errorBox.classList.remove('hidden'); };
    let replaceTarget = null;

    const load = async () => {
        try {
            const response = await window.api.media.getAll();
            table.replaceChildren();
            if (!response.data.length) { const row = document.createElement('tr'); const empty = textCell('No media found.'); empty.colSpan = 7; row.appendChild(empty); table.appendChild(row); return; }
            for (const media of response.data) {
                const row = document.createElement('tr');
                row.append(textCell(media.originalFilename || 'Uploaded media'), textCell(media.mediaType || 'Unknown'), textCell(media.fileSize ? `${(media.fileSize / 1048576).toFixed(2)} MB` : '—'), textCell(media.processingStatus), textCell(`${media.processingProgress || 0}%`));
                const locationCell = document.createElement('td'); locationCell.className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10 align-top';
                const locations = media.placements || [];
                if (!locations.length) locationCell.textContent = 'Not attached to a course';
                for (const location of locations) {
                    const line = document.createElement('div'); line.className = 'mb-2 last:mb-0';
                    line.textContent = location.kind === 'demo'
                        ? `${location.courseTitle} · Course demo`
                        : `${location.courseTitle} · Module ${location.moduleNumber}: ${location.moduleTitle} · Lesson ${location.moduleNumber}.${location.lessonNumber}: ${location.lessonTitle}`;
                    locationCell.appendChild(line);
                }
                row.appendChild(locationCell);
                const actionCell = document.createElement('td'); actionCell.className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10 text-right align-top whitespace-nowrap';
                if (locations.length && ['video', 'audio'].includes(media.mediaType) && media.processingStatus === 'ready') {
                    const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'bg-[var(--primary)] text-black brutal-border px-3 py-2 text-xs font-black uppercase mr-2'; replace.textContent = 'REPLACE FILE';
                    replace.addEventListener('click', () => { replaceTarget = media; replacementInput.accept = media.mediaType === 'video' ? 'video/mp4,video/quicktime,video/webm,video/x-matroska' : 'audio/mpeg,audio/wav,audio/aac'; replacementInput.click(); });
                    actionCell.appendChild(replace);
                }
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'bg-[var(--accent)] text-white brutal-border px-3 py-2 text-xs font-black uppercase'; remove.textContent = 'DELETE';
                remove.addEventListener('click', async () => {
                    if (!confirm('Delete this media file? Attached media must first be replaced or removed.')) return;
                    remove.disabled = true;
                    try { await window.api.media.delete(media._id); await load(); }
                    catch (error) { showError(error.message); remove.disabled = false; }
                });
                actionCell.appendChild(remove); row.appendChild(actionCell); table.appendChild(row);
            }
        } catch (error) {
            showError(error.message); table.replaceChildren(); const row = document.createElement('tr'); const failed = textCell(`Unable to load media: ${error.message}`); failed.colSpan = 7; row.appendChild(failed); table.appendChild(row);
        }
    };

    replacementInput.addEventListener('change', async () => {
        const file = replacementInput.files?.[0];
        const previous = replaceTarget;
        replacementInput.value = '';
        if (!file || !previous) return;
        replaceTarget = null;
        errorBox.classList.add('hidden');
        try {
            const form = new FormData(); form.append('media', file);
            const uploaded = await window.api.media.upload(form);
            const newId = uploaded.data._id;
            let ready = false;
            for (let attempt = 0; attempt < 720; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                const status = await window.api.media.getStatus(newId);
                if (status.data.status === 'failed') throw new Error(status.data.error || 'The replacement file failed HLS processing');
                if (status.data.status === 'ready') { ready = true; break; }
            }
            if (!ready) throw new Error('Replacement upload is still processing. Refresh the media page later to retry the change.');
            await Promise.all((previous.placements || []).map((place) => place.kind === 'demo'
                ? window.api.courses.update(place.courseId, { demoVideo: newId })
                : window.api.lessons.update(place.moduleId, place.lessonId, { media: newId })));
            await load();
        } catch (error) { showError(error.message); await load(); }
    });

    await load();
});

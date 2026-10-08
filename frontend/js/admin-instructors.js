const adminInstructorText = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

document.addEventListener('DOMContentLoaded', async () => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token') || user?.role !== 'admin') return;
    const list = document.getElementById('instructor-list');
    const errorBox = document.getElementById('instructor-error');
    const modal = document.getElementById('instructor-modal');
    const modalError = document.getElementById('instructor-modal-error');
    const form = document.getElementById('instructor-form');
    const photoInput = document.getElementById('instructor-photo');
    const showError = (message) => { errorBox.textContent = message; errorBox.classList.remove('hidden'); };
    const showModalError = (message) => { modalError.textContent = message; modalError.classList.remove('hidden'); };
    const clearModalError = () => { modalError.textContent = ''; modalError.classList.add('hidden'); };
    const close = () => { modal.classList.add('hidden'); clearModalError(); };

    const load = async () => {
        try {
            const response = await window.api.admin.getInstructors();
            list.replaceChildren();
            if (!response.data.length) {
                const empty = document.createElement('p'); empty.className = 'bg-[var(--bg-color)] p-6 brutal-border font-bold'; empty.textContent = 'No instructor profiles yet.'; list.appendChild(empty); return;
            }
            for (const profile of response.data) {
                const card = document.createElement('article'); card.className = 'bg-[var(--bg-color)] brutal-border brutal-shadow p-5 flex flex-col gap-4';
                const photo = document.createElement('img'); photo.src = profile.photoUrl; photo.alt = `${profile.name} profile photo`; photo.className = 'w-full aspect-[4/3] object-cover brutal-border';
                const heading = document.createElement('h3'); heading.className = 'text-2xl font-black uppercase'; heading.textContent = profile.name;
                const title = document.createElement('p'); title.className = 'font-black text-[var(--accent)] uppercase'; title.textContent = profile.title || 'Instructor';
                const bio = document.createElement('p'); bio.className = 'font-bold whitespace-pre-wrap'; bio.textContent = profile.bio;
                const actions = document.createElement('div'); actions.className = 'flex gap-3 mt-auto';
                const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'flex-1 bg-[var(--primary)] text-black brutal-border py-2 font-black uppercase'; edit.textContent = 'EDIT';
                edit.addEventListener('click', () => {
                    form.reset(); clearModalError();
                    document.getElementById('instructor-id').value = profile._id;
                    document.getElementById('instructor-name').value = profile.name;
                    document.getElementById('instructor-title').value = profile.title || '';
                    document.getElementById('instructor-bio').value = profile.bio;
                    photoInput.required = false;
                    document.getElementById('instructor-modal-title').textContent = 'Edit instructor';
                    modal.classList.remove('hidden');
                });
                const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'bg-[var(--accent)] text-white brutal-border px-4 py-2 font-black uppercase'; remove.textContent = 'DELETE';
                remove.addEventListener('click', async () => {
                    if (!confirm(`Delete ${profile.name}'s public profile? Assigned courses will become unassigned.`)) return;
                    remove.disabled = true;
                    try { await window.api.admin.deleteInstructor(profile._id); await load(); }
                    catch (error) { showError(error.message); remove.disabled = false; }
                });
                actions.append(edit, remove); card.append(photo, heading, title, bio, actions); list.appendChild(card);
            }
        } catch (error) {
            list.textContent = 'Unable to load instructor profiles.';
            showError(error.message);
        }
    };

    document.getElementById('add-instructor-button').addEventListener('click', () => {
        form.reset(); clearModalError(); errorBox.classList.add('hidden'); document.getElementById('instructor-id').value = '';
        photoInput.required = true;
        document.getElementById('instructor-modal-title').textContent = 'Add instructor';
        modal.classList.remove('hidden');
    });
    document.getElementById('cancel-instructor').addEventListener('click', close);
    document.getElementById('close-instructor-modal').addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        const id = document.getElementById('instructor-id').value;
        const data = new FormData();
        data.append('name', document.getElementById('instructor-name').value.trim());
        data.append('title', document.getElementById('instructor-title').value.trim());
        data.append('bio', document.getElementById('instructor-bio').value.trim());
        if (photoInput.files[0]) data.append('photo', photoInput.files[0]);
        submit.disabled = true;
        const originalLabel = submit.textContent;
        submit.textContent = 'SAVING…';
        clearModalError();
        try {
            if (id) await window.api.admin.updateInstructor(id, data);
            else await window.api.admin.createInstructor(data);
            close(); form.reset(); errorBox.classList.add('hidden'); await load();
        } catch (error) { showModalError(error.message || 'Unable to save instructor profile.'); }
        finally { submit.disabled = false; submit.textContent = originalLabel; }
    });
    await load();
});

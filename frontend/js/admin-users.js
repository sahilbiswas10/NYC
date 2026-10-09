document.addEventListener('DOMContentLoaded', async () => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) { window.location.replace('../login.html'); return; }
    if (user?.role !== 'admin') { window.location.replace(user?.role === 'instructor' ? '../instructor/dashboard.html' : '../student/dashboard.html'); return; }

    const table = document.getElementById('users-table');
    const errorBox = document.getElementById('user-error');
    const modal = document.getElementById('edit-user-modal');
    const editForm = document.getElementById('edit-user-form');
    const currentUserId = user?._id || user?.id;
    const showError = (message) => { errorBox.textContent = message; errorBox.classList.remove('hidden'); };
    const cell = (text) => { const td = document.createElement('td'); td.className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10'; td.textContent = text; return td; };

    const loadUsers = async () => {
        const response = await window.api.admin.getUsers();
        table.replaceChildren();
        if (!response.data.length) {
            const row = document.createElement('tr'); const empty = cell('No accounts found.'); empty.colSpan = 5; row.appendChild(empty); table.appendChild(row); return;
        }
        response.data.forEach((account) => {
            const row = document.createElement('tr');
            row.append(cell(account.name), cell(account.email), cell(account.role), cell(new Date(account.createdAt).toLocaleDateString()));
            const actions = cell(''); actions.classList.add('text-right', 'whitespace-nowrap');
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'bg-[var(--primary)] text-black brutal-border px-3 py-2 text-xs font-black uppercase mr-2'; edit.textContent = 'EDIT';
            edit.addEventListener('click', () => {
                document.getElementById('edit-user-id').value = account._id;
                document.getElementById('edit-user-name').value = account.name;
                document.getElementById('edit-user-email').value = account.email;
                const role = document.getElementById('edit-user-role');
                role.value = account.role;
                role.disabled = account.role === 'admin';
                modal.classList.remove('hidden');
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'bg-[var(--accent)] text-white brutal-border px-3 py-2 text-xs font-black uppercase';
            remove.textContent = account.role === 'admin' ? 'DEPLOYMENT MANAGED' : account._id === currentUserId ? 'CURRENT ACCOUNT' : 'DELETE';
            remove.disabled = account.role === 'admin' || account._id === currentUserId;
            remove.addEventListener('click', async () => {
                if (!await window.NYCUI.confirm(`Permanently delete ${account.name}'s account, enrollments, progress, and uploaded media? Courses they own will transfer to your admin account. Courses using their uploaded media will be unpublished.`)) return;
                remove.disabled = true;
                try { await window.api.admin.deleteUser(account._id); await loadUsers(); }
                catch (error) { showError(error.message); remove.disabled = false; }
            });
            actions.append(edit, remove); row.appendChild(actions); table.appendChild(row);
        });
    };

    document.getElementById('cancel-edit-user').addEventListener('click', () => modal.classList.add('hidden'));
    editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = editForm.querySelector('[type="submit"]'); submit.disabled = true;
        try {
            const role = document.getElementById('edit-user-role');
            const userData = {
                name: document.getElementById('edit-user-name').value.trim(),
                email: document.getElementById('edit-user-email').value.trim()
            };
            if (!role.disabled) userData.role = role.value;
            await window.api.admin.updateUser(document.getElementById('edit-user-id').value, userData);
            modal.classList.add('hidden'); errorBox.classList.add('hidden'); await loadUsers();
        } catch (error) { showError(error.message); }
        finally { submit.disabled = false; }
    });

    try { await loadUsers(); }
    catch (error) {
        table.replaceChildren(); const row = document.createElement('tr'); const failed = cell(`Unable to load users: ${error.message}`); failed.colSpan = 5; row.appendChild(failed); table.appendChild(row); showError(error.message);
    }
});

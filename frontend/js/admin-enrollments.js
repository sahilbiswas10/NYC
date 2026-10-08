document.addEventListener('DOMContentLoaded', async () => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) { window.location.replace('../login.html'); return; }
    if (user?.role !== 'admin') { window.location.replace(user?.role === 'instructor' ? '../instructor/dashboard.html' : '../student/dashboard.html'); return; }

    const table = document.getElementById('enrollments-table');
    const errorBox = document.getElementById('enrollment-error');
    const status = document.getElementById('enrollment-status');
    const studentSelect = document.getElementById('enrollment-student');
    const courseSelect = document.getElementById('enrollment-course');
    const form = document.getElementById('grant-enrollment-form');
    let page = 1;
    let totalPages = 1;
    const cell = (text) => {
        const td = document.createElement('td');
        td.className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10 align-top';
        td.textContent = text;
        return td;
    };
    const showError = (message) => {
        errorBox.textContent = message || 'Unable to complete the enrollment action.';
        errorBox.classList.remove('hidden');
    };
    const option = (value, label) => {
        const entry = document.createElement('option');
        entry.value = value;
        entry.textContent = label;
        return entry;
    };

    const loadChoices = async () => {
        const [usersResult, coursesResult] = await Promise.allSettled([
            window.api.admin.getUsers(),
            window.api.admin.getCourses()
        ]);
        studentSelect.replaceChildren(option('', 'Choose a student'));
        courseSelect.replaceChildren(option('', 'Choose a course'));
        if (usersResult.status === 'fulfilled') {
            usersResult.value.data.filter((account) => account.role === 'student').forEach((account) => {
                studentSelect.appendChild(option(account._id, `${account.name} · ${account.email}`));
            });
        } else {
            studentSelect.replaceChildren(option('', 'Unable to load students'));
            showError(usersResult.reason.message);
        }
        if (coursesResult.status === 'fulfilled') {
            coursesResult.value.data.filter((course) => course.status === 'published').forEach((course) => {
                courseSelect.appendChild(option(course._id, course.title));
            });
        } else {
            courseSelect.replaceChildren(option('', 'Unable to load courses'));
            showError(coursesResult.reason.message);
        }
    };

    const performAction = async (enrollment, action, button) => {
        const studentName = enrollment.student?.name || 'this student';
        const courseName = enrollment.course?.title || 'this course';
        const prompts = {
            revoke: `Revoke ${studentName}'s access to “${courseName}”? This clears lesson progress and invalidates the course certificate. It does not issue a payment refund.`,
            restore: `Restore ${studentName}'s access to “${courseName}”? Progress starts over.`,
            'reset-progress': `Reset ${studentName}'s progress in “${courseName}”? Saved lesson progress and the course certificate will be cleared.`
        };
        if (!window.confirm(prompts[action])) return;
        button.disabled = true;
        try {
            await window.api.admin.updateEnrollment(enrollment._id, action);
            errorBox.classList.add('hidden');
            await loadEnrollments();
        } catch (error) {
            showError(error.message);
            button.disabled = false;
        }
    };

    const loadEnrollments = async () => {
        table.replaceChildren();
        const loading = cell('Loading enrollments…'); loading.colSpan = 6;
        const loadingRow = document.createElement('tr');
        loadingRow.appendChild(loading);
        table.appendChild(loadingRow);
        try {
            const response = await window.api.admin.getEnrollments(page);
            const enrollments = Array.isArray(response.data) ? response.data : [];
            totalPages = response.pagination?.totalPages || 1;
            if (page > totalPages) { page = totalPages; return loadEnrollments(); }
            status.textContent = `${response.pagination?.total || enrollments.length} enrollments · page ${page} of ${totalPages}`;
            document.getElementById('enrollments-page').textContent = `Page ${page} of ${totalPages}`;
            document.getElementById('enrollments-prev').disabled = page <= 1;
            document.getElementById('enrollments-next').disabled = page >= totalPages;
            table.replaceChildren();
            if (!enrollments.length) {
                const row = document.createElement('tr'); const empty = cell('No enrollments found.'); empty.colSpan = 6; row.appendChild(empty); table.appendChild(row); return;
            }
            enrollments.forEach((enrollment) => {
                const row = document.createElement('tr');
                row.append(
                    cell(enrollment.student ? `${enrollment.student.name} · ${enrollment.student.email}` : 'Deleted account'),
                    cell(enrollment.course?.title || 'Deleted course'),
                    cell(enrollment.status),
                    cell(enrollment.status === 'cancelled' ? '—' : `${Math.max(0, Math.min(100, Number(enrollment.progress) || 0))}%`),
                    cell(new Date(enrollment.updatedAt || enrollment.createdAt).toLocaleDateString())
                );
                const actions = cell('');
                actions.classList.add('text-right', 'whitespace-nowrap');
                if (enrollment.status === 'cancelled') {
                    const restore = document.createElement('button');
                    restore.type = 'button'; restore.textContent = 'RESTORE';
                    restore.className = 'bg-[var(--primary)] text-black brutal-border px-3 py-2 text-xs font-black uppercase';
                    restore.addEventListener('click', () => performAction(enrollment, 'restore', restore));
                    actions.appendChild(restore);
                } else {
                    const reset = document.createElement('button');
                    reset.type = 'button'; reset.textContent = 'RESET PROGRESS';
                    reset.className = 'bg-[var(--bg-color)] text-[var(--foreground)] brutal-border px-3 py-2 text-xs font-black uppercase mr-2';
                    reset.addEventListener('click', () => performAction(enrollment, 'reset-progress', reset));
                    const revoke = document.createElement('button');
                    revoke.type = 'button'; revoke.textContent = 'REVOKE ACCESS';
                    revoke.className = 'bg-[var(--accent)] text-white brutal-border px-3 py-2 text-xs font-black uppercase';
                    revoke.addEventListener('click', () => performAction(enrollment, 'revoke', revoke));
                    actions.append(reset, revoke);
                }
                row.appendChild(actions); table.appendChild(row);
            });
        } catch (error) {
            status.textContent = 'Enrollments could not be loaded.';
            table.replaceChildren();
            const row = document.createElement('tr'); const failed = cell(`Unable to load enrollments: ${error.message}`); failed.colSpan = 6; row.appendChild(failed); table.appendChild(row);
            showError(error.message);
        }
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = document.getElementById('grant-enrollment-button');
        button.disabled = true;
        try {
            await window.api.admin.grantEnrollment(studentSelect.value, courseSelect.value);
            errorBox.classList.add('hidden');
            form.reset();
            page = 1;
            await loadEnrollments();
        } catch (error) {
            showError(error.message);
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById('enrollments-prev').addEventListener('click', () => { if (page > 1) { page -= 1; loadEnrollments(); } });
    document.getElementById('enrollments-next').addEventListener('click', () => { if (page < totalPages) { page += 1; loadEnrollments(); } });

    await loadChoices();
    await loadEnrollments();
});

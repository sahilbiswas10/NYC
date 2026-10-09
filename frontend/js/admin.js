document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) { window.location.replace('../login.html'); return; }
    if (user?.role !== 'admin') {
        window.location.replace(user?.role === 'instructor' ? '../instructor/dashboard.html' : '../student/dashboard.html');
        return;
    }

    const table = document.getElementById('admin-courses-list');
    const allCourses = new Map();
    const isFullList = document.body.dataset.page === 'courses';
    const cell = (text, className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10') => {
        const element = document.createElement('td'); element.className = className; element.textContent = text; return element;
    };
    const load = async () => {
        try {
            const response = await window.api.admin.getCourses();
            const courses = response.data || [];
            allCourses.clear(); courses.forEach((course) => allCourses.set(course._id, course));
            table.replaceChildren();
            if (!courses.length) {
                const row = document.createElement('tr'); const empty = cell('No courses found.'); empty.colSpan = isFullList ? 4 : 3; row.appendChild(empty); table.appendChild(row); return;
            }
            const visibleCourses = isFullList ? courses : courses.slice(0, 10);
            visibleCourses.forEach((course) => {
                const row = document.createElement('tr');
                row.appendChild(cell(course.title));
                if (isFullList) row.appendChild(cell(course.instructorProfile?.name || 'No public instructor assigned'));
                const statusCell = cell('');
                const badge = document.createElement('span');
                badge.className = `${course.status === 'published' ? 'bg-green-500' : 'bg-yellow-400'} text-black px-2 py-1 text-xs uppercase brutal-border`;
                badge.textContent = course.status;
                statusCell.appendChild(badge);
                row.appendChild(statusCell);
                const actions = cell('', 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10 text-right');
                actions.classList.add('space-x-2');
                const addAction = (label, action, href) => {
                    const element = href ? document.createElement('a') : document.createElement('button');
                    element.className = 'inline-block bg-[var(--bg-color)] text-[var(--foreground)] brutal-border px-3 py-1 font-black text-xs hover:bg-[var(--primary)]';
                    element.textContent = label;
                    if (href) element.href = href;
                    else { element.type = 'button'; element.dataset.action = action; element.dataset.id = course._id; }
                    actions.appendChild(element);
                };
                addAction('EDIT', null, `edit_course.html?id=${encodeURIComponent(course._id)}`);
                addAction('PREVIEW', null, `../course.html?course=${encodeURIComponent(course._id)}`);
                if (course.status !== 'archived') addAction(course.status === 'published' ? 'UNPUBLISH' : 'PUBLISH', course.status === 'published' ? 'unpublish' : 'publish');
                addAction('ARCHIVE', 'archive');
                addAction('DELETE', 'delete');
                row.appendChild(actions);
                table.appendChild(row);
            });
        } catch (error) {
            table.replaceChildren(); const row = document.createElement('tr'); const failed = cell(`Unable to load courses: ${error.message}`); failed.colSpan = isFullList ? 4 : 3; row.appendChild(failed); table.appendChild(row);
        }
    };

    table.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const course = allCourses.get(button.dataset.id);
        if (!course) return;
        try {
            if (button.dataset.action === 'delete') {
                if (!await window.NYCUI.confirm(`Delete “${course.title}” and all its enrollments and progress? This cannot be undone.`)) return;
                await window.api.courses.delete(course._id);
            } else {
                const status = button.dataset.action === 'publish' ? 'published' : button.dataset.action === 'unpublish' ? 'unpublished' : 'archived';
                if (status === 'archived' && !await window.NYCUI.confirm(`Archive “${course.title}”?`)) return;
                await window.api.courses.update(course._id, { status });
            }
            await load();
        } catch (error) {
            window.NYCUI.alert(error.message);
        }
    });

    await load();
});

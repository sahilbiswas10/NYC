const instructorEscape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const instructorButtonClass = 'bg-[var(--bg-color)] text-[var(--foreground)] brutal-border px-3 py-1 font-black uppercase text-xs brutal-shadow hover:bg-[var(--primary)] hover:text-black';
const instructorDangerClass = 'hover:bg-[var(--accent)] hover:text-white';

document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('instructor-course-list');
    let coursesById = new Map();
    const pageUser = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) {
        window.location.replace('../login.html');
        return;
    }
    if (pageUser?.role === 'admin') { window.location.replace('../admin/dashboard.html'); return; }
    if (pageUser?.role !== 'instructor') { window.location.replace('../student/dashboard.html'); return; }

    const render = (courses) => {
        if (!courses.length) {
            list.innerHTML = '<p class="font-bold bg-[var(--bg-color)] brutal-border p-6">You have not created any courses yet.</p>';
            return;
        }
        list.innerHTML = courses.map((course) => `
            <article class="bg-[var(--bg-color)] brutal-border brutal-shadow p-6 flex flex-col">
                <div class="flex justify-between items-start gap-3 mb-4">
                    <span class="bg-[var(--primary)] text-black px-2 py-1 text-xs font-black uppercase brutal-border">${instructorEscape(course.status)}</span>
                    <span class="font-black text-sm">${Number(course.totalStudents) || 0} STUDENTS</span>
                </div>
                <h2 class="text-2xl font-black uppercase mb-3">${instructorEscape(course.title)}</h2>
                <p class="font-bold flex-grow mb-5">${instructorEscape(course.shortDescription || course.description || 'Add a description in the course editor.')}</p>
                <div class="flex flex-wrap gap-2">
                    <a class="${instructorButtonClass}" href="edit-course.html?id=${encodeURIComponent(course._id)}">EDIT COURSE</a>
                    <a class="${instructorButtonClass}" href="../course.html?course=${encodeURIComponent(course._id)}">PREVIEW</a>
                    ${course.status === 'published' ? `<button class="${instructorButtonClass}" data-action="unpublish" data-id="${course._id}">UNPUBLISH</button>` : course.status !== 'archived' ? `<button class="${instructorButtonClass}" data-action="publish" data-id="${course._id}">PUBLISH</button>` : ''}
                    <button class="${instructorButtonClass}" data-action="archive" data-id="${course._id}">ARCHIVE</button>
                    <button class="${instructorButtonClass} ${instructorDangerClass}" data-action="delete" data-id="${course._id}">DELETE</button>
                </div>
            </article>`).join('');
        if (window.lucide) lucide.createIcons();
    };

    try {
        const response = await window.api.admin.getCourses();
        const courses = response.data || [];
        coursesById = new Map(courses.map((course) => [course._id, course]));
        render(document.body.dataset.page === 'courses' ? courses : courses.slice(0, 6));
        const greeting = document.getElementById('instructor-greeting');
        if (greeting) greeting.textContent = `Welcome, ${pageUser.name || 'Instructor'}. Build and manage your courses here.`;
        const stats = document.getElementById('instructor-stats');
        if (stats) {
            const published = courses.filter((course) => course.status === 'published').length;
            const drafts = courses.filter((course) => course.status === 'draft').length;
            const students = courses.reduce((sum, course) => sum + (Number(course.totalStudents) || 0), 0);
            stats.innerHTML = [
                ['PUBLISHED', published], ['DRAFTS', drafts], ['TOTAL ENROLLMENTS', students]
            ].map(([label, value]) => `<div class="bg-[var(--bg-color)] brutal-border brutal-shadow p-5"><p class="font-black uppercase">${label}</p><p class="text-4xl font-black mt-2">${value}</p></div>`).join('');
        }
    } catch (error) {
        list.textContent = `Unable to load your courses: ${error.message}`;
    }

    list.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const course = coursesById.get(button.dataset.id);
        if (!course) return;
        try {
            if (button.dataset.action === 'delete') {
                if (!await window.NYCUI.confirm(`Delete “${course.title}” and its course content? This cannot be undone.`)) return;
                await window.api.courses.delete(course._id);
            } else {
                const status = button.dataset.action === 'publish' ? 'published' : button.dataset.action === 'unpublish' ? 'unpublished' : 'archived';
                if (status === 'archived' && !await window.NYCUI.confirm(`Archive “${course.title}”?`)) return;
                await window.api.courses.update(course._id, { status });
            }
            window.location.reload();
        } catch (error) {
            window.NYCUI.alert(error.message);
        }
    });
});

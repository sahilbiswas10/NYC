const instructorPageText = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

document.addEventListener('DOMContentLoaded', async () => {
    const backLink = document.getElementById('back-instructor-page');
    if (backLink && document.referrer) {
        try {
            if (new URL(document.referrer).origin === window.location.origin && window.history.length > 1) {
                backLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    window.history.back();
                });
            }
        } catch (error) {}
    }
    const id = new URLSearchParams(location.search).get('id');
    const error = document.getElementById('instructor-error');
    const courseList = document.getElementById('instructor-courses');
    if (!id) { error.textContent = 'No instructor profile was selected.'; error.classList.remove('hidden'); return; }
    try {
        const response = await window.api.instructors.getById(id);
        const profile = response.data;
        document.title = `${profile.name} - Instructor - NYC`;
        document.getElementById('instructor-name').textContent = profile.name;
        document.getElementById('instructor-title').textContent = profile.title || 'NYC Instructor';
        document.getElementById('instructor-bio').textContent = profile.bio;
        const image = document.getElementById('instructor-photo'); image.src = profile.photoUrl; image.classList.remove('hidden');
        courseList.replaceChildren();
        if (!profile.courses.length) { courseList.textContent = 'No published courses are assigned to this instructor yet.'; return; }
        for (const course of profile.courses) {
            const card = document.createElement('article'); card.className = 'bg-[var(--bg-color)] brutal-border brutal-shadow p-6 flex flex-col';
            const title = document.createElement('h3'); title.className = 'text-2xl font-black uppercase'; title.textContent = course.title;
            const description = document.createElement('p'); description.className = 'font-bold mt-3 flex-grow'; description.textContent = course.shortDescription || '';
            const link = document.createElement('a'); link.href = `course.html?course=${encodeURIComponent(course._id)}`; link.className = 'mt-6 bg-[var(--primary)] text-black brutal-border py-3 text-center font-black uppercase'; link.textContent = 'VIEW COURSE';
            card.append(title, description, link); courseList.appendChild(card);
        }
    } catch (apiError) {
        document.getElementById('instructor-name').textContent = 'PROFILE UNAVAILABLE';
        error.textContent = apiError.message; error.classList.remove('hidden');
        courseList.replaceChildren();
    }
});

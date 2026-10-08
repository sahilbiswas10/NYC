const dashboardEscape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const token = localStorage.getItem('token');
        if(!token) {
            window.location.href = '../login.html';
            return;
        }

        
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                const nameEl = document.getElementById('profile-name');
                const emailEl = document.getElementById('profile-email');
                if (nameEl) nameEl.textContent = user.name || 'User';
                if (emailEl) emailEl.textContent = user.email || '';
            } catch(e) {}
        }
        
        // Load Continue Watching

        const cwContainer = document.getElementById('continue-watching');
        if (cwContainer) {
            try {
                const cwRes = await window.api.student.getContinueWatching();
                if (cwRes.data.length === 0) {
                    cwContainer.innerHTML = '<p class="text-xl font-bold text-[var(--foreground)] p-6 bg-[var(--bg-color)] brutal-border brutal-shadow">No lessons in progress.</p>';
                } else {
                    cwContainer.innerHTML = '';
                        cwRes.data.forEach(item => {
                        const percent = Math.max(0, Math.min(100, Number(item.progress) || 0));
                        cwContainer.innerHTML += `
                            <div class="bg-[var(--primary)] brutal-border p-6 brutal-shadow flex flex-col h-full hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[10px_10px_0px_0px_var(--foreground)] transition-all">
                                <h3 class="font-black uppercase text-2xl mb-2 text-black">${dashboardEscape(item.courseTitle)}</h3>
                                <p class="text-black font-bold mb-4 flex-grow">${dashboardEscape(item.lessonTitle)}</p>
                                <div class="w-full bg-[var(--bg-color)] brutal-border h-4 mb-6">
                                    <div class="bg-[var(--accent)] h-full border-r-4 border-black" style="width: ${percent}%"></div>
                                </div>
                        <a href="../learn.html?course=${encodeURIComponent(item.courseId)}&lesson=${encodeURIComponent(item.lessonId)}&time=${encodeURIComponent(Number(item.currentTime) || 0)}" class="bg-[var(--accent)] text-white brutal-border py-3 px-4 font-black uppercase text-xl brutal-shadow hover:bg-black transition-colors block text-center mt-auto">
                                    CONTINUE
                                </a>
                            </div>
                        `;
                    });
                }
            } catch(e) {
                cwContainer.innerHTML = '<p class="text-xl font-bold text-red-600">Error loading progress.</p>';
            }
        }

        // Load Enrolled Courses
        const enContainer = document.getElementById('enrolled-courses');
        if (enContainer) {
            try {
                const enRes = await window.api.student.getEnrolled();
                if (enRes.data.length === 0) {
                    enContainer.innerHTML = '<p class="text-xl font-bold text-[var(--foreground)] p-6 bg-[var(--bg-color)] brutal-border brutal-shadow">You are not enrolled in any courses.</p>';
                } else {
                    enContainer.innerHTML = '';
                    enRes.data.filter(en => en.course).forEach(en => {
                        const progress = Math.max(0, Math.min(100, Number(en.progress) || 0));
                        const completed = en.status === 'completed';
                        enContainer.innerHTML += `
                            <div class="bg-[var(--bg-color)] brutal-border p-6 brutal-shadow flex flex-col h-full hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[10px_10px_0px_0px_var(--accent)] transition-all">
                                <div class="flex justify-between items-center gap-3 mb-4"><span class="bg-[var(--primary)] text-black px-2 py-1 text-xs font-black uppercase brutal-border">${completed ? 'Completed' : 'Enrolled'}</span><span class="font-black">${progress}%</span></div>
                                <h3 class="font-black uppercase text-3xl mb-6 text-[var(--foreground)] flex-grow">${dashboardEscape(en.course.title)}</h3>
                                <div class="w-full bg-black/10 dark:bg-white/10 brutal-border h-3 mb-6"><div class="bg-[var(--accent)] h-full" style="width:${progress}%"></div></div>
                                <a href="../course.html?course=${encodeURIComponent(en.course._id)}&view=curriculum" class="bg-black dark:bg-white text-white dark:text-black brutal-border py-3 px-4 font-black uppercase text-xl brutal-shadow hover:bg-[var(--primary)] hover:text-black transition-colors block text-center mt-auto">
                                    OPEN CURRICULUM
                                </a>
                                ${(completed || en.certificateId) ? `<a href="../certificate.html?course=${encodeURIComponent(en.course._id)}" class="bg-[var(--primary)] text-black brutal-border py-3 px-4 mt-3 font-black uppercase text-lg brutal-shadow hover:-translate-y-1 transition-transform block text-center">VIEW CERTIFICATE</a>` : ''}
                            </div>
                        `;
                    });
                }
            } catch(e) {
                enContainer.innerHTML = '<p class="text-xl font-bold text-red-600">Error loading courses.</p>';
            }
        }
    } catch(err) {
        console.error(err);
    }
});

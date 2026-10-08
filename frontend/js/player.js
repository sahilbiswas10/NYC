document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('course');
    const lessonId = params.get('lesson');
    const resumeTime = Math.max(0, Number(params.get('time')) || 0);
    const showPlayerError = (message) => {
        const error = document.getElementById('player-error');
        error.textContent = message;
        error.classList.remove('hidden');
    };
    if (!courseId) { showPlayerError('No course was selected.'); return; }
    if (!localStorage.getItem('token')) {
        window.location.replace(`course.html?course=${encodeURIComponent(courseId)}`);
        return;
    }

    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    const dashboardLink = document.getElementById('back-dashboard-btn');
    if (dashboardLink && user?.role === 'admin') dashboardLink.href = 'admin/dashboard.html';
    else if (dashboardLink && user?.role === 'instructor') dashboardLink.href = 'instructor/dashboard.html';
    else if (dashboardLink) dashboardLink.href = 'student/dashboard.html';

    const curriculumContainer = document.getElementById('curriculum-container');
    const video = document.getElementById('course-video');
    const playerFrame = document.getElementById('player-frame');
    const lessonTitle = document.getElementById('lesson-title');
    const lessonDescription = document.getElementById('lesson-desc');
    const textPanel = document.getElementById('text-lesson-panel');
    const textContent = document.getElementById('text-lesson-content');
    const textStatus = document.getElementById('text-lesson-status');

    try {
        const courseResponse = await window.api.courses.getById(courseId);
        const course = courseResponse.data;
        const moduleResponse = await window.api.courses.getModules(courseId);
        const modules = moduleResponse.data || [];
        let activeLesson = null;
        const sections = [];
        for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
            const module = modules[moduleIndex];
            const response = await window.api.modules.getLessons(module._id);
            const lessons = response.data || [];
            const section = document.createElement('section');
            section.className = `mb-6 p-4 border-l-8 ${moduleIndex % 2 ? 'border-l-[var(--accent)]' : 'border-l-[var(--primary)]'} bg-[var(--bg-color)]`;
            const heading = document.createElement('h3');
            heading.className = 'font-black uppercase text-xl mb-3 text-[var(--foreground)] border-b-4 border-[var(--foreground)] pb-1';
            heading.textContent = `MODULE ${moduleIndex + 1} · ${module.title}`;
            const list = document.createElement('ul'); list.className = 'space-y-3';
            lessons.forEach((lesson, lessonIndex) => {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = `?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lesson._id)}`;
                link.className = lesson._id === lessonId
                    ? 'block p-3 font-bold bg-[var(--primary)] text-black brutal-border brutal-shadow'
                    : 'block p-3 font-bold text-[var(--foreground)] brutal-border border-transparent hover:border-[var(--foreground)]';
                link.textContent = `LESSON ${moduleIndex + 1}.${lessonIndex + 1} · ${lesson.title}${lesson.type ? ` · ${lesson.type}` : ''}`;
                if (lesson._id === lessonId) { activeLesson = lesson; link.setAttribute('aria-current', 'page'); }
                item.appendChild(link); list.appendChild(item);
            });
            section.append(heading);
            if (module.notesOriginalFilename) {
                const notesButton = document.createElement('button'); notesButton.type = 'button'; notesButton.dataset.moduleNotes = module._id;
                notesButton.className = 'module-notes-link mb-4';
                notesButton.setAttribute('aria-label', `View notes for module ${moduleIndex + 1}`);
                notesButton.innerHTML = `<span class="module-notes-label">MODULE ${moduleIndex + 1} NOTES</span><span class="module-notes-filename">${String(module.notesOriginalFilename).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))}</span><span class="module-notes-action">VIEW NOTES</span>`;
                section.appendChild(notesButton);
            }
            section.append(list); sections.push(section);
        }
        curriculumContainer.replaceChildren(...sections);
        curriculumContainer.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-module-notes]');
            if (!button) return;
            try { await window.openProtectedFile(() => window.api.modules.getNotes(courseId, button.dataset.moduleNotes)); }
            catch (error) { showPlayerError(error.message); }
        });

        const player = new StreamingPlayer('course-video');
        if (lessonId) {
            if (!activeLesson) {
                showPlayerError('That lesson is not part of this course.');
                return;
            }
            lessonTitle.textContent = activeLesson.title;
            lessonDescription.textContent = activeLesson.description || '';
            if (['text', 'document'].includes(activeLesson.type)) {
                playerFrame.classList.add('hidden');
                textPanel.classList.remove('hidden');
                textContent.textContent = activeLesson.content || 'No written content has been added for this lesson.';
                document.getElementById('complete-text-lesson').addEventListener('click', async (event) => {
                    const completeButton = event.currentTarget;
                    completeButton.disabled = true;
                    try {
                        await window.apiCall(`/lessons/${encodeURIComponent(activeLesson._id)}/complete`, { method: 'POST' });
                        textStatus.textContent = 'Lesson completed. Your course progress is updated.';
                        completeButton.textContent = 'COMPLETED';
                    } catch (error) {
                        textStatus.textContent = error.message;
                        completeButton.disabled = false;
                    }
                });
                return;
            }
            if (!activeLesson.media) {
                playerFrame.classList.add('hidden');
                showPlayerError('This lesson does not have media attached yet.');
                return;
            }
            if (resumeTime > 0) {
                const resume = () => {
                    if (Number.isFinite(video.duration) && video.duration > resumeTime) video.currentTime = resumeTime;
                };
                video.addEventListener('loadedmetadata', resume, { once: true });
                video.addEventListener('durationchange', resume, { once: true });
            }
            try {
                await player.loadManifest(activeLesson.media);
                new ProgressTracker(video, activeLesson._id);
            } catch (error) {
                showPlayerError(error.message || 'Unable to play this lesson.');
            }
            return;
        }

        lessonTitle.textContent = course.title;
        lessonDescription.textContent = course.description || course.shortDescription || 'Welcome to the course.';
        if (course.demoVideo) {
            try { await player.loadManifest(course.demoVideo); }
            catch (error) { showPlayerError(`Course preview unavailable: ${error.message}`); }
        } else {
            playerFrame.classList.add('hidden');
            showPlayerError('No course preview is available yet.');
        }
    } catch (error) {
        if (error.status === 401) {
            localStorage.removeItem('token'); localStorage.removeItem('user');
            window.location.replace(`login.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            return;
        }
        if (error.status === 403) {
            window.location.replace(`course.html?course=${encodeURIComponent(courseId)}`);
            return;
        }
        showPlayerError(error.message || 'Unable to load the course.');
        curriculumContainer.textContent = 'Course content could not be loaded.';
    }
});

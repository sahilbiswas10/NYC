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
    if (dashboardLink) dashboardLink.href = `course.html?course=${encodeURIComponent(courseId)}`;

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
        const completedLessonIds = new Set();
        if (user?.role === 'student') {
            try {
                const progressResponse = await window.api.progress.getCourseLessons(courseId);
                (progressResponse.data.completedLessonIds || []).forEach((id) => completedLessonIds.add(String(id)));
            } catch (error) {
                console.error('Unable to load lesson completion state:', error);
            }
        }
        let activeLesson = null;
        const sections = [];
        for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
            const module = modules[moduleIndex];
            const response = await window.api.modules.getLessons(module._id);
            const lessons = response.data || [];
            const section = document.createElement('details');
            section.className = 'curriculum-module';
            section.dataset.playerModule = module._id;
            section.open = lessons.some((lesson) => String(lesson._id) === String(lessonId)) || (moduleIndex === 0 && !lessonId);
            const completedCount = lessons.filter((lesson) => completedLessonIds.has(String(lesson._id))).length;
            const moduleComplete = lessons.length > 0 && completedCount === lessons.length;
            const summary = document.createElement('summary');
            summary.className = 'curriculum-module-summary';
            const heading = document.createElement('span');
            heading.className = 'curriculum-module-heading';
            heading.textContent = `MODULE ${moduleIndex + 1} · ${module.title}`;
            const summaryMeta = document.createElement('span');
            summaryMeta.className = 'curriculum-module-summary-meta';
            const count = document.createElement('span');
            count.className = 'curriculum-module-count';
            count.dataset.moduleCount = '';
            count.textContent = `${completedCount}/${lessons.length}`;
            count.hidden = user?.role !== 'student';
            const moduleCheck = document.createElement('span');
            moduleCheck.className = `completion-check${moduleComplete ? '' : ' hidden'}`;
            moduleCheck.dataset.moduleCheck = '';
            moduleCheck.setAttribute('role', 'img');
            moduleCheck.setAttribute('aria-label', 'Module completed');
            moduleCheck.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
            const chevron = document.createElement('i');
            chevron.dataset.lucide = 'chevron-down';
            chevron.className = 'curriculum-chevron';
            chevron.setAttribute('aria-hidden', 'true');
            summaryMeta.append(count, moduleCheck, chevron);
            summary.append(heading, summaryMeta);

            const content = document.createElement('div');
            content.className = 'curriculum-module-content';
            if (module.description) {
                const description = document.createElement('p');
                description.className = 'module-copy curriculum-module-description';
                description.textContent = module.description;
                content.appendChild(description);
            }
            const list = document.createElement('ul');
            list.className = 'curriculum-lesson-list';
            lessons.forEach((lesson, lessonIndex) => {
                const item = document.createElement('li');
                item.className = 'curriculum-lesson-row';
                const link = document.createElement('a');
                link.href = `?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lesson._id)}`;
                link.className = 'curriculum-player-lesson';
                if (String(lesson._id) === String(lessonId)) link.classList.add('is-active');
                link.dataset.playerLesson = lesson._id;
                const label = document.createElement('span');
                label.className = 'curriculum-player-lesson-label';
                label.textContent = `LESSON ${moduleIndex + 1}.${lessonIndex + 1} · ${lesson.title}${lesson.type ? ` · ${lesson.type}` : ''}`;
                link.appendChild(label);
                if (completedLessonIds.has(String(lesson._id))) {
                    const lessonCheck = document.createElement('span');
                    lessonCheck.className = 'completion-check';
                    lessonCheck.setAttribute('role', 'img');
                    lessonCheck.setAttribute('aria-label', 'Lesson completed');
                    lessonCheck.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
                    link.appendChild(lessonCheck);
                }
                if (String(lesson._id) === String(lessonId)) { activeLesson = lesson; link.setAttribute('aria-current', 'page'); }
                item.appendChild(link); list.appendChild(item);
            });
            section.append(summary);
            if (module.notesOriginalFilename) {
                const notesButton = document.createElement('button'); notesButton.type = 'button'; notesButton.dataset.moduleNotes = module._id;
                notesButton.className = 'module-notes-link mb-4';
                notesButton.setAttribute('aria-label', `View notes for module ${moduleIndex + 1}`);
                notesButton.innerHTML = `<span class="module-notes-label">MODULE ${moduleIndex + 1} NOTES</span><span class="module-notes-filename">${String(module.notesOriginalFilename).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))}</span><span class="module-notes-action">VIEW NOTES</span>`;
                content.appendChild(notesButton);
            }
            if (lessons.length) content.appendChild(list);
            else {
                const empty = document.createElement('p');
                empty.className = 'curriculum-empty';
                empty.textContent = 'No lessons in this module yet.';
                content.appendChild(empty);
            }
            section.appendChild(content);
            sections.push(section);
        }
        curriculumContainer.replaceChildren(...sections);
        const updateCompletionUI = (completedId) => {
            if (completedId) completedLessonIds.add(String(completedId));
            curriculumContainer.querySelectorAll('[data-player-module]').forEach((moduleElement) => {
                const lessonsInModule = [...moduleElement.querySelectorAll('[data-player-lesson]')];
                lessonsInModule.forEach((lessonElement) => {
                    const lessonDone = completedLessonIds.has(String(lessonElement.dataset.playerLesson));
                    let lessonCheck = lessonElement.querySelector('.completion-check');
                    if (lessonDone && !lessonCheck) {
                        lessonCheck = document.createElement('span');
                        lessonCheck.className = 'completion-check';
                        lessonCheck.setAttribute('role', 'img');
                        lessonCheck.setAttribute('aria-label', 'Lesson completed');
                        lessonCheck.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
                        lessonElement.appendChild(lessonCheck);
                    }
                });
                const completedCount = lessonsInModule.filter((lesson) => completedLessonIds.has(String(lesson.dataset.playerLesson))).length;
                const countElement = moduleElement.querySelector('[data-module-count]');
                if (countElement) countElement.textContent = `${completedCount}/${lessonsInModule.length}`;
                const isComplete = lessonsInModule.length > 0 && completedCount === lessonsInModule.length;
                moduleElement.querySelector('[data-module-check]')?.classList.toggle('hidden', !isComplete);
            });
            const allModulesComplete = sections.length > 0 && [...curriculumContainer.querySelectorAll('[data-player-module]')]
                .every((moduleElement) => {
                    const lessonElements = [...moduleElement.querySelectorAll('[data-player-lesson]')];
                    return lessonElements.length > 0 && lessonElements.every((lesson) => completedLessonIds.has(String(lesson.dataset.playerLesson)));
                });
            document.getElementById('player-course-completed')?.classList.toggle('hidden', !allModulesComplete);
            if (window.lucide) lucide.createIcons();
        };
        updateCompletionUI();
        const progressStatus = document.getElementById('lesson-progress-status');
        const isCurrentLessonEvent = (event) => String(event.detail?.lessonId) === String(lessonId);
        window.addEventListener('lesson:completed', (event) => {
            updateCompletionUI(event.detail?.lessonId);
            if (progressStatus && isCurrentLessonEvent(event)) {
                progressStatus.textContent = 'Lesson completed. Your progress is saved.';
                progressStatus.classList.remove('hidden', 'text-red-600', 'dark:text-red-400');
                progressStatus.classList.add('text-green-700', 'dark:text-green-400');
            }
        });
        window.addEventListener('lesson:progress-saved', (event) => {
            if (!progressStatus || !isCurrentLessonEvent(event)) return;
            const percentage = Number(event.detail?.percentage);
            progressStatus.textContent = Number.isFinite(percentage) ? `Progress saved · ${percentage}%` : 'Progress saved.';
            progressStatus.classList.remove('hidden', 'text-red-600', 'dark:text-red-400');
        });
        window.addEventListener('lesson:progress-error', (event) => {
            if (!progressStatus || !isCurrentLessonEvent(event)) return;
            progressStatus.textContent = `Progress could not be saved: ${event.detail?.message || 'Please try again.'}`;
            progressStatus.classList.remove('hidden', 'text-green-700', 'dark:text-green-400');
            progressStatus.classList.add('text-red-600', 'dark:text-red-400');
        });
        window.addEventListener('lesson:completion-error', (event) => {
            if (!progressStatus || !isCurrentLessonEvent(event)) return;
            progressStatus.textContent = `Lesson completion could not be saved: ${event.detail?.message || 'Please try again.'}`;
            progressStatus.classList.remove('hidden', 'text-green-700', 'dark:text-green-400');
            progressStatus.classList.add('text-red-600', 'dark:text-red-400');
        });
        curriculumContainer.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-module-notes]');
            if (!button) return;
            try { await window.openProtectedFile(() => window.api.modules.getNotes(courseId, button.dataset.moduleNotes)); }
            catch (error) { showPlayerError(error.message); }
        });
        if (window.lucide) lucide.createIcons();

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
                        const completion = await window.apiCall(`/lessons/${encodeURIComponent(activeLesson._id)}/complete`, { method: 'POST' });
                        textStatus.textContent = 'Lesson completed. Your course progress is updated.';
                        completeButton.textContent = 'COMPLETED';
                        if (completion.data?.completed) window.dispatchEvent(new CustomEvent('lesson:completed', { detail: { lessonId: activeLesson._id } }));
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

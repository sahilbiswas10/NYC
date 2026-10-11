document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('course');
    const lessonId = params.get('lesson');
    const moduleTestId = params.get('module');
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
        let learningModules = modules.map(module => ({ id: String(module._id), ...module.learning }));
        let courseCompleted = null;
        if (user?.role === 'student') {
            try {
                const progressResponse = await window.api.progress.getCourseLessons(courseId);
                learningModules = progressResponse.data.modules || learningModules;
                (progressResponse.data.completedLessonIds || []).forEach((id) => completedLessonIds.add(String(id)));
                if (typeof progressResponse.data.courseCompleted === 'boolean') courseCompleted = progressResponse.data.courseCompleted;
            } catch (error) {
                console.error('Unable to load lesson completion state:', error);
            }
        }
        let activeLesson = null;
        const orderedLessons = [];
        const sections = [];
        for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
            const module = modules[moduleIndex];
            const response = await window.api.modules.getLessons(module._id);
            const lessons = response.data || [];
            orderedLessons.push(...lessons);
            const section = document.createElement('details');
            section.className = 'curriculum-module';
            section.dataset.playerModule = module._id;
            section.open = String(module._id) === moduleTestId || lessons.some((lesson) => String(lesson._id) === String(lessonId)) || (moduleIndex === 0 && !lessonId && !moduleTestId);
            const requiredLessons = lessons.filter((lesson) => lesson.isRequired !== false || lesson.hasQuiz);
            const completedCount = requiredLessons.filter((lesson) => completedLessonIds.has(String(lesson._id))).length;
            const moduleComplete = module.learning?.completed === true;
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
            count.textContent = `${completedCount}/${requiredLessons.length}`;
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
                link.dataset.lessonRequired = String(lesson.isRequired !== false || lesson.hasQuiz);
                link.dataset.destination = link.href;
                if (module.learning?.locked) { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.title = module.learning.lockReason; }
                const label = document.createElement('span');
                label.className = 'curriculum-player-lesson-label';
                label.textContent = `Lesson ${moduleIndex + 1}.${lessonIndex + 1} · ${lesson.title}${lesson.type ? ` · ${lesson.type}` : ''}`;
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
            const lockMessage = document.createElement('p'); lockMessage.className = 'module-lock-message';
            lockMessage.textContent = module.learning?.lockReason || ''; content.appendChild(lockMessage);
            if (module.learning?.moduleQuiz) {
                const test = document.createElement('a'); test.className = 'feature-button module-test-link';
                test.href = `?course=${encodeURIComponent(courseId)}&module=${module._id}`;
                test.dataset.destination = test.href;
                test.dataset.moduleTest = module._id;
                test.textContent = module.learning.moduleQuiz.passed ? '✓ Module test passed' : 'Take module test';
                if (module.learning.locked) { test.removeAttribute('href'); test.setAttribute('aria-disabled', 'true'); }
                // Appended after lessons below.
                section._testLink = test;
            }
            if (module.notesOriginalFilename) {
                const notesButton = document.createElement('button'); notesButton.type = 'button'; notesButton.dataset.moduleNotes = module._id;
                notesButton.className = 'module-notes-link mb-4';
                notesButton.disabled = module.learning?.locked === true;
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
            if (section._testLink) content.appendChild(section._testLink);
            section.appendChild(content);
            sections.push(section);
        }
        curriculumContainer.replaceChildren(...sections);
        const updateCompletionUI = (completedId) => {
            if (completedId) completedLessonIds.add(String(completedId));
            curriculumContainer.querySelectorAll('[data-player-module]').forEach((moduleElement) => {
                const learning = learningModules.find(item => item.id === moduleElement.dataset.playerModule);
                moduleElement.querySelectorAll('[data-destination]').forEach(link => {
                    if (learning?.locked) { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
                    else { link.href = link.dataset.destination; link.removeAttribute('aria-disabled'); }
                });
                const notes = moduleElement.querySelector('[data-module-notes]'); if (notes) notes.disabled = learning?.locked === true;
                const lock = moduleElement.querySelector('.module-lock-message'); if (lock) lock.textContent = learning?.lockReason || '';
                const test = moduleElement.querySelector('[data-module-test]'); if (test) test.textContent = learning?.moduleQuiz?.passed ? '✓ Module test passed' : 'Take module test';
                const lessonsInModule = [...moduleElement.querySelectorAll('[data-player-lesson]')];
                lessonsInModule.forEach((lessonElement) => {
                    const lessonDone = completedLessonIds.has(String(lessonElement.dataset.playerLesson));
                    let lessonCheck = lessonElement.querySelector('.completion-check');
                    if (!lessonDone && lessonCheck) lessonCheck.remove();
                    if (lessonDone && !lessonCheck) {
                        lessonCheck = document.createElement('span');
                        lessonCheck.className = 'completion-check';
                        lessonCheck.setAttribute('role', 'img');
                        lessonCheck.setAttribute('aria-label', 'Lesson completed');
                        lessonCheck.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
                        lessonElement.appendChild(lessonCheck);
                    }
                });
                const requiredLessons = lessonsInModule.filter((lesson) => lesson.dataset.lessonRequired !== 'false');
                const completedCount = requiredLessons.filter((lesson) => completedLessonIds.has(String(lesson.dataset.playerLesson))).length;
                const countElement = moduleElement.querySelector('[data-module-count]');
                if (countElement) countElement.textContent = `${completedCount}/${requiredLessons.length}`;
                const isComplete = learning?.completed === true;
                moduleElement.querySelector('[data-module-check]')?.classList.toggle('hidden', !isComplete);
            });
            const requiredLessonElements = [...curriculumContainer.querySelectorAll('[data-player-lesson]')]
                .filter((lesson) => lesson.dataset.lessonRequired !== 'false');
            const isCourseComplete = courseCompleted ?? (requiredLessonElements.length > 0 && requiredLessonElements.every((lesson) => completedLessonIds.has(String(lesson.dataset.playerLesson))));
            document.getElementById('player-course-completed')?.classList.toggle('hidden', !isCourseComplete);
            if (window.lucide) lucide.createIcons();
        };
        updateCompletionUI();
        const refreshLearning = async () => {
            if (user?.role !== 'student') return;
            const response = await window.api.progress.getCourseLessons(courseId);
            completedLessonIds.clear();
            (response.data.completedLessonIds || []).forEach(id => completedLessonIds.add(String(id)));
            learningModules = response.data.modules || learningModules;
            courseCompleted = response.data.courseCompleted;
            updateCompletionUI();
        };
        window.addEventListener('quiz:updated', async () => {
            try {
                await refreshLearning();
                const status = document.getElementById('lesson-progress-status');
                if (completedLessonIds.has(String(lessonId))) { status.textContent = 'Lesson completed. Your progress is saved.'; status.classList.remove('hidden'); }
            }
            catch (error) { showPlayerError(`Quiz saved, but progress could not refresh: ${error.message}`); }
        });
        window.addEventListener('lesson:content-completed', async () => {
            const status = document.getElementById('lesson-progress-status');
            status.textContent = 'Content completed and saved. Pass the lesson quiz to complete this lesson. You can continue to the next lesson.';
            status.classList.remove('hidden');
            try { await refreshLearning(); } catch (error) { console.error(error); }
        });
        const progressStatus = document.getElementById('lesson-progress-status');
        const isCurrentLessonEvent = (event) => String(event.detail?.lessonId) === String(lessonId);
        window.addEventListener('lesson:completed', async (event) => {
            const newlyCompleted = event.detail?.lessonId && !completedLessonIds.has(String(event.detail.lessonId));
            if (typeof event.detail?.courseCompleted === 'boolean') courseCompleted = event.detail.courseCompleted;
            updateCompletionUI(event.detail?.lessonId);
            if (progressStatus && isCurrentLessonEvent(event)) {
                progressStatus.textContent = 'Lesson completed. Your progress is saved.';
                progressStatus.classList.remove('hidden', 'text-red-600', 'dark:text-red-400');
                progressStatus.classList.add('text-green-700', 'dark:text-green-400');
            }
            if (newlyCompleted && user?.role === 'student') {
                try {
                    const progressResponse = await window.api.progress.getCourseLessons(courseId);
                    learningModules = progressResponse.data.modules || learningModules;
                    (progressResponse.data.completedLessonIds || []).forEach((id) => completedLessonIds.add(String(id)));
                    if (typeof progressResponse.data.courseCompleted === 'boolean') courseCompleted = progressResponse.data.courseCompleted;
                    updateCompletionUI();
                } catch (error) {
                    console.error('Unable to refresh course completion state:', error);
                }
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

        const quizPanel = document.getElementById('lesson-quiz');
        if (moduleTestId) {
            playerFrame.classList.add('hidden'); lessonDescription.classList.add('hidden');
            const module = modules.find(item => String(item._id) === moduleTestId);
            if (!module) { showPlayerError('Module not found in this course.'); return; }
            lessonTitle.textContent = `${module.title} · Module test`;
            await window.mountQuiz(quizPanel, 'module', moduleTestId, courseId);
            return;
        }
        const player = new StreamingPlayer('course-video');
        if (lessonId) {
            if (!activeLesson) {
                showPlayerError('That lesson is not part of this course.');
                return;
            }
            if (activeLesson.locked) {
                playerFrame.classList.add('hidden'); lessonDescription.classList.add('hidden');
                lessonTitle.textContent = activeLesson.title;
                showPlayerError(learningModules.find(item => item.id === String(activeLesson.module))?.lockReason || 'Pass the previous module test first.');
                return;
            }
            await window.mountQuiz(quizPanel, 'lesson', activeLesson._id, courseId);
            lessonTitle.textContent = activeLesson.title;
            lessonDescription.textContent = activeLesson.description || '';
            const activeIndex = orderedLessons.findIndex((lesson) => String(lesson._id) === String(activeLesson._id));
            for (const [direction, adjacent, boundary] of [
                ['previous', orderedLessons[activeIndex - 1], 'First lesson'],
                ['next', orderedLessons[activeIndex + 1], 'Last lesson']
            ]) {
                const link = document.getElementById(`${direction}-lesson`);
                const title = document.getElementById(`${direction}-lesson-title`);
                if (!link || !title) continue;
                const activeModule = modules.find(item => String(item._id) === String(activeLesson.module));
                const needsModuleTest = direction === 'next' && activeModule?.learning?.moduleQuiz && !activeModule.learning.moduleQuiz.passed && (!adjacent || String(adjacent.module) !== String(activeLesson.module));
                if (needsModuleTest) {
                    title.textContent = 'Module test';
                    link.querySelector('.lesson-navigation-label').textContent = 'Finish module';
                    link.href = `learn.html?course=${encodeURIComponent(courseId)}&module=${activeModule._id}`;
                    link.setAttribute('aria-disabled', 'false'); link.tabIndex = 0;
                    continue;
                }
                if (adjacent?.locked) { title.textContent = 'Pass the previous module test first'; continue; }
                title.textContent = adjacent?.title || boundary;
                link.setAttribute('aria-disabled', String(!adjacent));
                if (adjacent) {
                    link.href = `learn.html?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(adjacent._id)}`;
                    link.setAttribute('tabindex', '0');
                    link.setAttribute('aria-label', `${direction === 'previous' ? 'Previous' : 'Next'} lesson: ${adjacent.title}`);
                }
            }
            document.getElementById('lesson-navigation')?.classList.remove('hidden');
            if (['text', 'document'].includes(activeLesson.type)) {
                playerFrame.classList.add('hidden');
                textPanel.classList.remove('hidden');
                textContent.textContent = activeLesson.content || 'No written content has been added for this lesson.';
                const completeButton = document.getElementById('complete-text-lesson');
                completeButton.classList.toggle('hidden', user?.role !== 'student');
                if (user?.role !== 'student') return;
                completeButton.addEventListener('click', async (event) => {
                    const completeButton = event.currentTarget;
                    completeButton.disabled = true;
                    try {
                        const completion = await window.apiCall(`/lessons/${encodeURIComponent(activeLesson._id)}/complete`, { method: 'POST' });
                        textStatus.textContent = completion.data?.completed ? 'Lesson completed. Your course progress is updated.' : 'Content completed and saved. Pass the lesson quiz to complete this lesson.';
                        completeButton.textContent = 'CONTENT COMPLETED';
                        window.dispatchEvent(new CustomEvent(completion.data?.completed ? 'lesson:completed' : 'lesson:content-completed', { detail: { lessonId: activeLesson._id, courseCompleted: completion.data?.courseCompleted } }));
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
                if (user?.role === 'student') new ProgressTracker(video, activeLesson._id);
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

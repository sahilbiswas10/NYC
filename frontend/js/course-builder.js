const builderEscape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const builderButtonClass = 'bg-[var(--bg-color)] text-[var(--foreground)] brutal-border px-3 py-1 font-black uppercase text-xs brutal-shadow hover:bg-[var(--primary)] hover:text-black disabled:opacity-40 disabled:cursor-not-allowed';
const builderDangerClass = 'hover:bg-[var(--accent)] hover:text-white';

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('id');
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.replace(`../login.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
    }
    if (!courseId) {
        window.location.replace('dashboard.html');
        return;
    }

    const modulesContainer = document.getElementById('modules-container');
    const courseForm = document.getElementById('course-details-form');
    const moduleModal = document.getElementById('new-module-modal');
    const lessonModal = document.getElementById('new-lesson-modal');
    const uploadModal = document.getElementById('upload-media-modal');
    const statusBox = document.getElementById('upload-status');
    const uploadButton = document.getElementById('upload-submit-btn');
    const existingMediaSelect = document.getElementById('existing-media-select');
    const chooseExistingButton = document.getElementById('choose-existing-media');
    const instructorSelect = document.getElementById('instructor-profile');
    const courseIconInput = document.getElementById('course-icon-file');
    const courseIconPreview = document.getElementById('course-icon-preview');
    const courseIconStatus = document.getElementById('course-icon-status');
    const uploadCourseIconButton = document.getElementById('upload-course-icon');
    let currentCourse;
    let moduleItems = [];
    let instructorChoicesLoaded = false;

    const loadInstructorChoices = async () => {
        if (!instructorSelect || instructorChoicesLoaded) return;
        const response = await window.api.instructors.getAll();
        for (const profile of response.data) {
            const option = document.createElement('option'); option.value = profile._id; option.textContent = profile.name;
            instructorSelect.appendChild(option);
        }
        instructorChoicesLoaded = true;
    };

    const showCourseMessage = (message, isError = false) => {
        const element = document.getElementById('course-save-toast');
        if (!element) return window.NYCUI.alert(message);
        element.textContent = message;
        element.classList.toggle('course-save-toast--error', isError);
        element.classList.remove('hidden');
        element.classList.remove('is-visible');
        requestAnimationFrame(() => element.classList.add('is-visible'));
        clearTimeout(showCourseMessage.timer);
        showCourseMessage.timer = setTimeout(() => {
            element.classList.remove('is-visible');
            setTimeout(() => element.classList.add('hidden'), 260);
        }, isError ? 6000 : 3000);
    };

    if (new URLSearchParams(window.location.search).get('imageUpload') === 'failed') {
        showCourseMessage('Course created, but its image did not upload. Select it here and try again.', true);
    }

    courseIconInput?.addEventListener('change', () => {
        const file = courseIconInput.files?.[0];
        if (!file || !courseIconPreview) return;
        courseIconPreview.src = URL.createObjectURL(file);
        courseIconPreview.classList.remove('hidden');
        if (courseIconStatus) courseIconStatus.textContent = file.name;
    });

    uploadCourseIconButton?.addEventListener('click', async () => {
        const file = courseIconInput?.files?.[0];
        if (!file) { if (courseIconStatus) courseIconStatus.textContent = 'Choose an image first.'; return; }
        uploadCourseIconButton.disabled = true;
        if (courseIconStatus) courseIconStatus.textContent = 'Uploading course image…';
        try {
            const response = await window.api.courses.uploadThumbnail(courseId, file);
            if (courseIconPreview) courseIconPreview.src = response.data.thumbnailUrl;
            if (courseIconStatus) courseIconStatus.textContent = 'Course image uploaded.';
            courseIconInput.value = '';
        } catch (error) {
            if (courseIconStatus) courseIconStatus.textContent = error.message;
        } finally { uploadCourseIconButton.disabled = false; }
    });

    const setUploadState = (message, state = 'pending') => {
        statusBox.classList.remove('hidden', 'bg-red-500', 'bg-green-500', 'bg-yellow-400');
        statusBox.classList.add(state === 'failed' ? 'bg-red-500' : state === 'ready' ? 'bg-green-500' : 'bg-yellow-400');
        statusBox.textContent = message;
    };

    const fetchCourse = async () => {
        await loadInstructorChoices();
        const response = await window.api.courses.getById(courseId);
        currentCourse = response.data;
        document.title = `Edit ${currentCourse.title} - NYC`;
        document.getElementById('title').value = currentCourse.title || '';
        document.getElementById('description').value = currentCourse.description || '';
        document.getElementById('price').value = Number(currentCourse.price) || 0;
        document.getElementById('objectives').value = (currentCourse.objectives || []).join(', ');
        document.getElementById('status').value = currentCourse.status || 'draft';
        if (instructorSelect) instructorSelect.value = currentCourse.instructorProfile?._id || currentCourse.instructorProfile || '';
        if (currentCourse.thumbnailUrl && courseIconPreview) {
            courseIconPreview.src = currentCourse.thumbnailUrl;
            courseIconPreview.classList.remove('hidden');
            if (courseIconStatus) courseIconStatus.textContent = 'Current course image';
        }
        document.getElementById('demo-video-status').textContent = currentCourse.demoVideo ? 'Checking demo status…' : 'No demo uploaded';
        document.getElementById('remove-demo-btn')?.classList.toggle('hidden', !currentCourse.demoVideo);
        const previewLink = document.getElementById('preview-course-link');
        if (previewLink) previewLink.href = `../course.html?course=${encodeURIComponent(courseId)}`;
        if (currentCourse.demoVideo) updateMediaLabel(currentCourse.demoVideo, document.getElementById('demo-video-status'));
    };

    const updateMediaLabel = async (mediaId, label) => {
        try {
            const response = await window.api.media.getStatus(mediaId);
            const status = response.data.status.toUpperCase();
            label.textContent = response.data.status === 'failed'
                ? 'FAILED — upload a supported file again'
                : response.data.status === 'ready'
                    ? 'READY'
                    : response.data.status === 'uploaded'
                        ? 'WAITING IN QUEUE'
                        : response.data.progress
                            ? `PROCESSING HLS ${response.data.progress}%`
                            : 'PREPARING HLS…';
        } catch (error) {
            label.textContent = 'Media status unavailable';
        }
    };

    const loadExistingMedia = async () => {
        if (!existingMediaSelect) return;
        existingMediaSelect.innerHTML = '<option value="">Loading your media…</option>';
        try {
            const targetType = document.getElementById('upload-target-type').value;
            const expectedType = targetType === 'course' ? 'video' : document.getElementById('lesson-type').value;
            const response = await window.api.media.getAll();
            const matches = response.data.filter((media) => media.mediaType === expectedType && media.processingStatus === 'ready');
            existingMediaSelect.innerHTML = matches.length
                ? `<option value="">Choose a ready ${builderEscape(expectedType)}…</option>${matches.map((media) => `<option value="${builderEscape(media._id)}">${builderEscape(media.originalFilename || 'Uploaded media')} (${(media.fileSize / 1048576).toFixed(1)} MB)</option>`).join('')}`
                : `<option value="">No ready ${builderEscape(expectedType)} media found</option>`;
            if (chooseExistingButton) chooseExistingButton.disabled = !matches.length;
        } catch (error) {
            existingMediaSelect.innerHTML = '<option value="">Unable to load media library</option>';
            if (chooseExistingButton) chooseExistingButton.disabled = true;
        }
    };

    const attachExistingMedia = async () => {
        const mediaId = existingMediaSelect?.value;
        if (!mediaId) return showCourseMessage('Choose ready media first.', true);
        const targetType = document.getElementById('upload-target-type').value;
        const moduleId = document.getElementById('upload-module-id').value;
        const lessonId = document.getElementById('upload-lesson-id').value;
        chooseExistingButton.disabled = true;
        try {
            if (targetType === 'course') await window.api.courses.update(courseId, { demoVideo: mediaId });
            else await window.api.lessons.update(moduleId, lessonId, { media: mediaId });
            uploadModal.classList.add('hidden');
            setUploadState('Ready media attached.', 'ready');
            await loadModules();
            await fetchCourse();
        } catch (error) {
            showCourseMessage(error.message, true);
        } finally {
            chooseExistingButton.disabled = false;
        }
    };

    chooseExistingButton?.addEventListener('click', attachExistingMedia);

    const loadModules = async () => {
        try {
            const response = await window.api.courses.getModules(courseId);
            moduleItems = response.data;
            const groups = [];
            for (let moduleIndex = 0; moduleIndex < moduleItems.length; moduleIndex++) {
                const module = moduleItems[moduleIndex];
                const lessonResponse = await window.api.modules.getLessons(module._id);
                const lessons = lessonResponse.data;
                const lessonMarkup = lessons.map((lesson, lessonIndex) => `
                    <li class="bg-[var(--bg-color)] brutal-border p-4 flex flex-col gap-4 min-w-0">
                        <div class="min-w-0 w-full">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-bold text-lg">LESSON ${moduleIndex + 1}.${lessonIndex + 1} · ${builderEscape(lesson.title)}</span>
                                <span class="bg-[var(--primary)] text-black text-xs font-black uppercase px-2 py-1 brutal-border">${builderEscape(lesson.type)}</span>
                                <span class="lesson-media-status text-xs font-bold" data-media-status="${lesson.media || ''}">${lesson.media ? 'Checking media…' : 'No media'}</span>
                            </div>
                            ${lesson.description ? `<p class="module-copy font-medium text-sm mt-1">${builderEscape(lesson.description)}</p>` : ''}
                        </div>
                        <div class="flex flex-wrap items-center gap-2 w-full border-t-2 border-[var(--foreground)]/20 pt-3">
                            <button type="button" data-action="lesson-up" data-module="${module._id}" data-lesson="${lesson._id}" ${lessonIndex === 0 ? 'disabled' : ''} class="${builderButtonClass}">↑</button>
                            <button type="button" data-action="lesson-down" data-module="${module._id}" data-lesson="${lesson._id}" ${lessonIndex === lessons.length - 1 ? 'disabled' : ''} class="${builderButtonClass}">↓</button>
                            <button type="button" data-action="lesson-edit" data-module="${module._id}" data-lesson="${lesson._id}" class="${builderButtonClass}">EDIT</button>
                            ${['video', 'audio'].includes(lesson.type) ? `<button type="button" data-action="lesson-upload" data-module="${module._id}" data-lesson="${lesson._id}" class="${builderButtonClass}">${lesson.media ? 'REPLACE MEDIA' : 'UPLOAD MEDIA'}</button>` : ''}
                            ${lesson.media ? `<button type="button" data-action="lesson-remove-media" data-module="${module._id}" data-lesson="${lesson._id}" class="${builderButtonClass}">REMOVE MEDIA</button>` : ''}
                            <a href="../learn.html?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lesson._id)}" class="${builderButtonClass}">PREVIEW</a>
                            <button type="button" data-action="lesson-delete" data-module="${module._id}" data-lesson="${lesson._id}" class="${builderButtonClass} ${builderDangerClass}">DELETE</button>
                        </div>
                    </li>`).join('');
                groups.push(`
                    <article class="bg-[var(--bg-color)] brutal-border border-l-8 ${moduleIndex % 2 ? 'border-l-[var(--accent)]' : 'border-l-[var(--primary)]'} brutal-shadow p-6">
                        <div class="flex flex-col gap-4 border-b-4 border-[var(--foreground)] pb-4 mb-4">
                            <div class="min-w-0 w-full">
                                <span class="inline-block bg-[var(--foreground)] text-[var(--bg-color)] px-2 py-1 text-xs font-black uppercase mb-2">MODULE ${moduleIndex + 1}</span>
                                <h3 class="text-2xl font-black uppercase break-words">${builderEscape(module.title)}</h3>
                                ${module.description ? `<p class="module-copy font-medium text-sm mt-2">${builderEscape(module.description)}</p>` : ''}
                                ${module.notesOriginalFilename ? `<div class="module-notes-card mt-4"><span class="module-notes-label">MODULE ${moduleIndex + 1} NOTES</span><span class="module-notes-filename">${builderEscape(module.notesOriginalFilename)}</span></div>` : '<p class="font-bold text-sm mt-2">No module notes uploaded.</p>'}
                            </div>
                            <div class="flex flex-wrap items-center gap-2 w-full">
                                <button type="button" data-action="module-up" data-module="${module._id}" ${moduleIndex === 0 ? 'disabled' : ''} class="${builderButtonClass}">↑</button>
                                <button type="button" data-action="module-down" data-module="${module._id}" ${moduleIndex === moduleItems.length - 1 ? 'disabled' : ''} class="${builderButtonClass}">↓</button>
                                <button type="button" data-action="module-edit" data-module="${module._id}" class="${builderButtonClass}">EDIT</button>
                                <button type="button" data-action="lesson-add" data-module="${module._id}" class="${builderButtonClass}">+ LESSON</button>
                                <button type="button" data-action="module-notes" data-module="${module._id}" class="${builderButtonClass}">${module.notesOriginalFilename ? 'REPLACE MODULE NOTES' : 'UPLOAD MODULE NOTES'}</button>
                                ${module.notesOriginalFilename ? `<button type="button" data-action="module-view-notes" data-module="${module._id}" class="${builderButtonClass}">VIEW MODULE ${moduleIndex + 1} NOTES</button><button type="button" data-action="module-delete-notes" data-module="${module._id}" class="${builderButtonClass}">REMOVE NOTES</button>` : ''}
                                <button type="button" data-action="module-delete" data-module="${module._id}" class="${builderButtonClass} ${builderDangerClass}">DELETE</button>
                            </div>
                        </div>
                        <input type="file" data-module-notes-file="${module._id}" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" class="hidden">
                        ${lessons.length ? `<ul class="space-y-3">${lessonMarkup}</ul>` : '<p class="font-bold">No lessons in this module yet.</p>'}
                    </article>`);
            }
            modulesContainer.innerHTML = groups.length ? groups.join('') : '<p class="text-xl font-bold bg-[var(--bg-color)] p-6 brutal-border brutal-shadow">No modules added yet.</p>';
            modulesContainer.querySelectorAll('[data-media-status]').forEach((label) => {
                if (label.dataset.mediaStatus) updateMediaLabel(label.dataset.mediaStatus, label);
            });
            if (window.lucide) lucide.createIcons();
        } catch (error) {
            modulesContainer.textContent = `Unable to load course structure: ${error.message}`;
        }
    };

    const reorder = async (items, index, direction, saveItem) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= items.length) return;
        const reordered = [...items];
        [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
        try {
            await Promise.all(reordered.map((item, order) => saveItem(item, order)));
            await loadModules();
        } catch (error) {
            showCourseMessage(error.message, true);
        }
    };

    const getModuleLessons = async (moduleId) => (await window.api.modules.getLessons(moduleId)).data;

    courseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const saveButton = courseForm.querySelector('[type="submit"]');
        saveButton.disabled = true;
        try {
            const payload = {
                title: document.getElementById('title').value.trim(),
                description: document.getElementById('description').value.trim(),
                price: Number(document.getElementById('price').value),
                objectives: document.getElementById('objectives').value.split(',').map((value) => value.trim()).filter(Boolean),
                status: document.getElementById('status').value
            };
            if (instructorSelect) payload.instructorProfile = instructorSelect.value || null;
            await window.api.courses.update(courseId, payload);
            await fetchCourse();
            showCourseMessage(payload.status === 'published' ? '✓ COURSE PUBLISHED' : '✓ COURSE SAVED');
        } catch (error) {
            showCourseMessage(error.message, true);
        } finally {
            saveButton.disabled = false;
        }
    });

    document.getElementById('add-module-btn')?.addEventListener('click', () => {
        document.getElementById('module-edit-id').value = '';
        document.getElementById('module-title').value = '';
        document.getElementById('module-description').value = '';
        moduleModal.classList.remove('hidden');
    });

    document.getElementById('new-module-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const moduleId = document.getElementById('module-edit-id').value;
        const payload = {
            title: document.getElementById('module-title').value.trim(),
            description: document.getElementById('module-description').value.trim()
        };
        try {
            if (moduleId) await window.api.modules.update(courseId, moduleId, payload);
            else await window.api.modules.create(courseId, payload);
            moduleModal.classList.add('hidden');
            form.reset();
            await loadModules();
        } catch (error) {
            showCourseMessage(error.message, true);
        }
    });

    document.getElementById('lesson-type').addEventListener('change', (event) => {
        document.getElementById('lesson-content-wrap').classList.toggle('hidden', event.target.value !== 'text');
    });

    document.getElementById('new-lesson-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const moduleId = document.getElementById('lesson-module-id').value;
        const lessonId = document.getElementById('lesson-edit-id').value;
        const payload = {
            title: document.getElementById('lesson-title').value.trim(),
            type: document.getElementById('lesson-type').value,
            description: document.getElementById('lesson-description').value.trim(),
            content: document.getElementById('lesson-content').value
        };
        try {
            if (lessonId) await window.api.lessons.update(moduleId, lessonId, payload);
            else await window.api.lessons.create(moduleId, payload);
            lessonModal.classList.add('hidden');
            form.reset();
            await loadModules();
        } catch (error) {
            showCourseMessage(error.message, true);
        }
    });

    modulesContainer.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const { action, module: moduleId, lesson: lessonId } = button.dataset;
        try {
            if (action === 'module-edit') {
                const module = moduleItems.find((item) => item._id === moduleId);
                document.getElementById('module-edit-id').value = module._id;
                document.getElementById('module-title').value = module.title;
                document.getElementById('module-description').value = module.description || '';
                moduleModal.classList.remove('hidden');
            } else if (action === 'module-notes') {
                modulesContainer.querySelector(`[data-module-notes-file="${moduleId}"]`)?.click();
            } else if (action === 'module-view-notes') {
                await window.openProtectedFile(() => window.api.modules.getNotes(courseId, moduleId));
            } else if (action === 'module-delete-notes') {
                if (await window.NYCUI.confirm('Remove the notes attached to this module?')) {
                    await window.api.modules.deleteNotes(courseId, moduleId);
                    await loadModules();
                }
            } else if (action === 'lesson-add' || action === 'lesson-edit') {
                document.getElementById('lesson-module-id').value = moduleId;
                document.getElementById('lesson-edit-id').value = action === 'lesson-edit' ? lessonId : '';
                if (action === 'lesson-edit') {
                    const lesson = (await getModuleLessons(moduleId)).find((item) => item._id === lessonId);
                    if (!lesson) throw new Error('Lesson not found');
                    document.getElementById('lesson-title').value = lesson.title;
                    document.getElementById('lesson-type').value = lesson.type;
                    document.getElementById('lesson-description').value = lesson.description || '';
                    document.getElementById('lesson-content').value = lesson.content || '';
                    document.getElementById('lesson-content-wrap').classList.toggle('hidden', lesson.type !== 'text');
                } else {
                    document.getElementById('new-lesson-form').reset();
                    document.getElementById('lesson-module-id').value = moduleId;
                    document.getElementById('lesson-edit-id').value = '';
                    document.getElementById('lesson-content-wrap').classList.add('hidden');
                }
                lessonModal.classList.remove('hidden');
            } else if (action === 'module-delete') {
                if (await window.NYCUI.confirm('Delete this module and all of its lessons?')) {
                    await window.api.modules.delete(courseId, moduleId);
                    await loadModules();
                }
            } else if (action === 'lesson-delete') {
                if (await window.NYCUI.confirm('Delete this lesson and its saved progress?')) {
                    await window.api.lessons.delete(moduleId, lessonId);
                    await loadModules();
                }
            } else if (action === 'module-up' || action === 'module-down') {
                const index = moduleItems.findIndex((item) => item._id === moduleId);
                await reorder(moduleItems, index, action === 'module-up' ? -1 : 1, (item, order) => window.api.modules.update(courseId, item._id, { order }));
            } else if (action === 'lesson-up' || action === 'lesson-down') {
                const lessons = await getModuleLessons(moduleId);
                const index = lessons.findIndex((item) => item._id === lessonId);
                await reorder(lessons, index, action === 'lesson-up' ? -1 : 1, (item, order) => window.api.lessons.update(moduleId, item._id, { order }));
            } else if (action === 'lesson-upload') {
                document.getElementById('upload-target-type').value = 'lesson';
                document.getElementById('upload-module-id').value = moduleId;
                document.getElementById('upload-lesson-id').value = lessonId;
                const lesson = (await getModuleLessons(moduleId)).find((item) => item._id === lessonId);
                if (!lesson) throw new Error('Lesson not found');
                document.getElementById('lesson-type').value = lesson.type;
                document.getElementById('media-file').value = '';
                statusBox.classList.add('hidden');
                uploadModal.classList.remove('hidden');
                await loadExistingMedia();
            } else if (action === 'lesson-remove-media') {
                if (await window.NYCUI.confirm('Remove this lesson media?')) {
                    await window.api.lessons.update(moduleId, lessonId, { media: null });
                    await loadModules();
                }
            }
        } catch (error) {
            showCourseMessage(error.message, true);
        }
    });

    modulesContainer.addEventListener('change', async (event) => {
        const input = event.target;
        if (!input.matches('[data-module-notes-file]') || !input.files?.[0]) return;
        const formData = new FormData(); formData.append('notes', input.files[0]);
        input.disabled = true;
        try {
            await window.api.modules.uploadNotes(courseId, input.dataset.moduleNotesFile, formData);
            await loadModules();
            showCourseMessage('Module notes uploaded.');
        } catch (error) { showCourseMessage(error.message, true); }
        finally { input.disabled = false; input.value = ''; }
    });

    window.openCourseUploadModal = () => {
        document.getElementById('upload-target-type').value = 'course';
        document.getElementById('upload-module-id').value = '';
        document.getElementById('upload-lesson-id').value = '';
        document.getElementById('media-file').value = '';
        statusBox.classList.add('hidden');
        uploadModal.classList.remove('hidden');
        loadExistingMedia();
    };

    document.getElementById('remove-demo-btn')?.addEventListener('click', async () => {
        if (!currentCourse?.demoVideo || !await window.NYCUI.confirm('Remove the course demo video?')) return;
        try {
            await window.api.courses.update(courseId, { demoVideo: null });
            await fetchCourse();
        } catch (error) { showCourseMessage(error.message, true); }
    });

    document.getElementById('upload-media-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const file = document.getElementById('media-file').files[0];
        if (!file) return;
        const targetType = document.getElementById('upload-target-type').value;
        const moduleId = document.getElementById('upload-module-id').value;
        const lessonId = document.getElementById('upload-lesson-id').value;
        const formData = new FormData();
        formData.append('media', file);
        uploadButton.disabled = true;
        setUploadState('Uploading file…');
        let mediaId;
        let mediaLinked = false;
        try {
            const response = await window.api.media.upload(formData);
            mediaId = response.data._id;
            if (targetType === 'course') await window.api.courses.update(courseId, { demoVideo: mediaId });
            else await window.api.lessons.update(moduleId, lessonId, { media: mediaId });
            mediaLinked = true;
            setUploadState('Uploaded. FFmpeg is preparing the HLS stream…');
            await loadModules();
            await fetchCourse();
            let finished = false;
            for (let attempt = 0; attempt < 720; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                if (uploadModal.classList.contains('hidden')) {
                    setUploadState('Processing continues in the background. Reopen this course to check its status.');
                    finished = true;
                    break;
                }
                const status = await window.api.media.getStatus(mediaId);
                if (status.data.status === 'ready') {
                    setUploadState('Media is ready to play.', 'ready');
                    await loadModules();
                    await fetchCourse();
                    finished = true;
                    break;
                }
                if (status.data.status === 'failed') {
                    setUploadState(status.data.error || 'FFmpeg could not process this file.', 'failed');
                    finished = true;
                    break;
                }
                setUploadState(status.data.status === 'uploaded'
                    ? 'Waiting for an FFmpeg worker to pick up this upload…'
                    : status.data.progress
                        ? `Processing HLS: ${status.data.progress}%`
                        : 'FFmpeg is preparing media metadata and the HLS stream…');
            }
            if (!finished) setUploadState('Processing continues in the background. Reopen this course to check its status.');
        } catch (error) {
            setUploadState(mediaLinked
                ? 'Upload is saved and processing continues. Reopen this course to check its status.'
                : error.message, mediaLinked ? 'processing' : 'failed');
            if (mediaId && !mediaLinked) window.api.media.delete(mediaId).catch(() => {});
        } finally {
            uploadButton.disabled = false;
        }
    });

    document.getElementById('close-upload-modal').addEventListener('click', () => uploadModal.classList.add('hidden'));
    document.getElementById('new-module-cancel')?.addEventListener('click', () => moduleModal.classList.add('hidden'));
    document.getElementById('new-lesson-cancel')?.addEventListener('click', () => lessonModal.classList.add('hidden'));

    try {
        await fetchCourse();
        await loadModules();
    } catch (error) {
        showCourseMessage(error.message, true);
    }
});

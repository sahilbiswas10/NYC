const courseHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();

    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('course');
    const requestedView = params.get('view');
    const errorBox = document.getElementById('course-error');
    const viewLoading = document.getElementById('course-view-loading');
    const enrollmentMessage = document.getElementById('enrollment-message');
    const enrollButton = document.getElementById('enroll-button');
    const loginLink = document.getElementById('login-enroll-link');
    const curriculumSection = document.getElementById('curriculum-section');
    const courseContentArea = document.getElementById('course-content-area');
    const courseContentTabs = document.getElementById('course-content-tabs');
    const courseOverviewSection = document.getElementById('course-overview-section');
    const courseReviewsSection = document.getElementById('course-reviews');
    const discussionSection = document.getElementById('discussion-section');
    const notifyReviewEnrollment = () => window.dispatchEvent(new CustomEvent('course:review-access', { detail: { courseId, enrolled: true } }));
    let courseData = null;
    let demoLoadStarted = false;

    const loadDemoPreview = async () => {
        if (!courseData || demoLoadStarted) return;
        demoLoadStarted = true;
        const demoStatus = document.getElementById('demo-status');
        if (!courseData.demoVideo) {
            demoStatus.textContent = 'No course preview is available yet.';
            return;
        }
        demoStatus.textContent = 'Loading course preview...';
        try {
            const player = new StreamingPlayer('course-demo');
            await player.loadManifest(courseData.demoVideo);
            demoStatus.textContent = 'Course introduction';
        } catch (error) {
            demoStatus.textContent = `Preview unavailable: ${error.message}`;
        }
    };

    if (requestedView === 'curriculum') {
        courseOverviewSection?.classList.add('hidden');
        courseReviewsSection?.classList.add('hidden');
        viewLoading?.classList.remove('hidden');
    }

    const activateCourseTab = (view) => {
        const showPreview = view === 'preview';
        const showDiscussion = view === 'discussion';
        if (showPreview) loadDemoPreview();
        else document.getElementById('course-demo')?.pause();
        courseOverviewSection?.classList.toggle('hidden', !showPreview);
        courseReviewsSection?.classList.toggle('hidden', !showPreview);
        courseContentArea?.classList.toggle('hidden', showPreview);
        curriculumSection?.classList.toggle('hidden', showDiscussion || showPreview);
        discussionSection?.classList.toggle('hidden', !showDiscussion);
        courseContentTabs?.querySelectorAll('[data-course-tab]').forEach((tab) => {
            const active = tab.dataset.courseTab === view;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
    };

    const showEnrolledCourseTabs = (initialView = 'preview') => {
        viewLoading?.classList.add('hidden');
        courseContentTabs?.classList.remove('hidden');
        activateCourseTab(initialView);
        window.dispatchEvent(new CustomEvent('course:enrolled', { detail: { courseId } }));
    };

    courseContentTabs?.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-course-tab]');
        if (!tab) return;
        activateCourseTab(tab.dataset.courseTab);
    });

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
    };

    if (!courseId) {
        viewLoading?.classList.add('hidden');
        courseOverviewSection?.classList.remove('hidden');
        courseReviewsSection?.classList.remove('hidden');
        showError('No course was selected.');
        return;
    }

    loginLink.href = `login.html?returnTo=${encodeURIComponent(`course.html?course=${courseId}`)}`;

    const loadCurriculum = async () => {
        const container = document.getElementById('course-curriculum');
        const completedLessonIds = new Set();
        container.textContent = 'Loading course content...';
        try {
            let currentUser = null;
            try { currentUser = JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) {}
            const showCompletion = currentUser?.role === 'student';
            if (currentUser?.role === 'student') {
                try {
                    const progressResponse = await window.api.progress.getCourseLessons(courseId);
                    (progressResponse.data.completedLessonIds || []).forEach((lessonId) => completedLessonIds.add(String(lessonId)));
                } catch (error) {
                    console.error('Unable to load lesson completion state:', error);
                }
            }

            const modulesResponse = await window.api.courses.getModules(courseId);
            if (!modulesResponse.data.length) {
                container.textContent = 'No modules have been added to this course yet.';
                return;
            }

            const moduleSections = [];
            let completedModules = 0;
            for (let moduleIndex = 0; moduleIndex < modulesResponse.data.length; moduleIndex++) {
                const module = modulesResponse.data[moduleIndex];
                const lessonsResponse = await window.api.modules.getLessons(module._id);
                const lessons = lessonsResponse.data;
                const completedCount = lessons.filter((lesson) => completedLessonIds.has(String(lesson._id))).length;
                const isModuleComplete = lessons.length > 0 && completedCount === lessons.length;
                if (isModuleComplete) completedModules++;
                const completionIcon = (label) => `<span class="completion-check" role="img" aria-label="${label}"><i data-lucide="check" aria-hidden="true"></i></span>`;
                const lessonItems = lessons.map((lesson, lessonIndex) => {
                    const isCompleted = completedLessonIds.has(String(lesson._id));
                    return `
                        <li class="curriculum-lesson-row">
                            <div class="curriculum-lesson-info">
                                <h4 class="curriculum-lesson-title">LESSON ${moduleIndex + 1}.${lessonIndex + 1} · ${courseHtml(lesson.title)}${isCompleted ? completionIcon('Lesson completed') : ''}</h4>
                                <p class="curriculum-lesson-meta">${courseHtml(lesson.type)}${lesson.duration ? ` · ${Math.ceil(lesson.duration / 60)} min` : ''}</p>
                            </div>
                            <a href="learn.html?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lesson._id)}" class="curriculum-open-lesson">Open lesson</a>
                        </li>
                    `;
                }).join('');
                const moduleCompleteMark = isModuleComplete ? completionIcon('Module completed') : '';
                const notes = module.notesOriginalFilename
                    ? `<button type="button" data-module-notes="${module._id}" class="module-notes-link mb-4" aria-label="View notes for module ${moduleIndex + 1}"><span class="module-notes-label">MODULE ${moduleIndex + 1} NOTES</span><span class="module-notes-filename">${courseHtml(module.notesOriginalFilename)}</span><span class="module-notes-action">VIEW NOTES</span></button>`
                    : '';
                moduleSections.push(`
                    <details class="curriculum-module" data-course-module="${module._id}" ${moduleIndex === 0 ? 'open' : ''}>
                        <summary class="curriculum-module-summary">
                            <span class="curriculum-module-heading">MODULE ${moduleIndex + 1} · ${courseHtml(module.title)}</span>
                            <span class="curriculum-module-summary-meta">
                                ${showCompletion ? `<span class="curriculum-module-count">${completedCount}/${lessons.length}</span>` : ''}
                                ${moduleCompleteMark}
                                <i data-lucide="chevron-down" class="curriculum-chevron" aria-hidden="true"></i>
                            </span>
                        </summary>
                        <div class="curriculum-module-content">
                            ${module.description ? `<p class="module-copy curriculum-module-description">${courseHtml(module.description)}</p>` : ''}
                            ${notes}
                            ${lessonItems ? `<ul class="curriculum-lesson-list">${lessonItems}</ul>` : '<p class="curriculum-empty">No lessons in this module yet.</p>'}
                        </div>
                    </details>
                `);
            }
            container.innerHTML = moduleSections.join('');
            if (completedModules === modulesResponse.data.length && completedModules > 0) {
                document.getElementById('course-completion-state')?.classList.remove('hidden');
            }
            container.addEventListener('click', async (event) => {
                const button = event.target.closest('[data-module-notes]');
                if (!button) return;
                try { await window.openProtectedFile(() => window.api.modules.getNotes(courseId, button.dataset.moduleNotes)); }
                catch (error) { showError(error.message); }
            });
            if (window.lucide) lucide.createIcons();
        } catch (error) {
            curriculumSection.classList.add('hidden');
            if (error.message.includes('Enroll')) {
                showError('Enroll in this course to view its modules and lessons.');
            } else {
                showError(`Unable to load course content: ${error.message}`);
            }
        }
    };

    try {
        const response = await window.api.courses.getById(courseId);
        const course = response.data;
        courseData = course;
        document.title = `${course.title} - NYC`;
        document.getElementById('course-title').textContent = course.title;
        document.getElementById('course-description').textContent = course.description || course.shortDescription || 'Course description coming soon.';
        const priceBadge = document.getElementById('course-price');
        if (priceBadge) {
            const amount = Number(course.price) || 0;
            priceBadge.textContent = amount <= 0
                ? 'FREE COURSE'
                : `COURSE PRICE · ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)}`;
            priceBadge.classList.remove('hidden');
        }
        const instructorElement = document.getElementById('course-instructor');
        if (course.instructorProfile?._id) {
            const profile = course.instructorProfile;
            instructorElement.innerHTML = `<a href="instructor.html?id=${encodeURIComponent(profile._id)}" class="inline-flex items-center gap-4 bg-[var(--bg-color)] p-3 brutal-border brutal-shadow hover:bg-[var(--primary)]"><img src="/api/instructors/${encodeURIComponent(profile._id)}/photo" alt="" class="w-16 h-16 rounded-full object-cover brutal-border"><span class="text-left"><span class="block text-xs font-black uppercase">Instructor</span><span class="block text-xl font-black uppercase">${courseHtml(profile.name)}</span><span class="block text-sm font-bold">${courseHtml(profile.title || 'View profile')}</span></span></a>`;
        } else {
            instructorElement.textContent = 'Instructor profile coming soon.';
        }

        const objectives = Array.isArray(course.objectives) ? course.objectives : [];
        if (objectives.length) {
            const list = document.getElementById('course-objectives');
            list.replaceChildren(...objectives.map((objective) => {
                const item = document.createElement('li');
                item.textContent = objective;
                return item;
            }));
            document.getElementById('skills-panel').classList.remove('hidden');
        }

        const token = localStorage.getItem('token');
        let user = null;
        try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) {}
        const isOwner = user?.role === 'instructor' && String(course.instructor?._id) === String(user._id);
        const isManager = user?.role === 'admin' || isOwner;
        if (isManager) {
            viewLoading?.classList.add('hidden');
            courseOverviewSection?.classList.remove('hidden');
            courseReviewsSection?.classList.remove('hidden');
            courseContentArea?.classList.remove('hidden');
            curriculumSection?.classList.remove('hidden');
            discussionSection?.classList.add('hidden');
            document.getElementById('course-enrollment-card')?.classList.add('hidden');
            loadDemoPreview();
            await loadCurriculum();
            return;
        }

        if (!token) {
            viewLoading?.classList.add('hidden');
            courseOverviewSection?.classList.remove('hidden');
            courseReviewsSection?.classList.remove('hidden');
            document.getElementById('course-enrollment-card')?.classList.remove('hidden');
            enrollmentMessage.textContent = 'Sign in and enroll to view course modules and lessons.';
            loginLink.classList.remove('hidden');
            loadDemoPreview();
            return;
        }

        if (user?.role !== 'student') {
            viewLoading?.classList.add('hidden');
            courseOverviewSection?.classList.remove('hidden');
            courseReviewsSection?.classList.remove('hidden');
            document.getElementById('course-enrollment-card')?.classList.remove('hidden');
            enrollmentMessage.textContent = 'A student account is required to enroll in this course.';
            loadDemoPreview();
            return;
        }

        let enrolledResponse;
        try {
            enrolledResponse = await window.api.student.getEnrolled();
        } catch (error) {
            if (error.status === 401) {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                viewLoading?.classList.add('hidden');
                courseOverviewSection?.classList.remove('hidden');
                courseReviewsSection?.classList.remove('hidden');
                document.getElementById('course-enrollment-card')?.classList.remove('hidden');
                enrollmentMessage.textContent = 'Your session expired. Sign in to enroll in this course.';
                loginLink.classList.remove('hidden');
                loadDemoPreview();
                return;
            }
            throw error;
        }
        const isEnrolled = enrolledResponse.data.some((item) => String(item.course?._id) === String(courseId));
        if (isEnrolled) {
            document.getElementById('course-enrollment-card')?.classList.add('hidden');
            notifyReviewEnrollment();
            showEnrolledCourseTabs(requestedView === 'curriculum' ? 'curriculum' : 'preview');
            await loadCurriculum();
            return;
        }

        viewLoading?.classList.add('hidden');
        courseOverviewSection?.classList.remove('hidden');
        courseReviewsSection?.classList.remove('hidden');
        loadDemoPreview();

        const coursePrice = Number(course.price) || 0;
        enrollmentMessage.textContent = coursePrice > 0
            ? 'Complete payment to unlock all modules and lessons.'
            : 'Enroll to unlock all modules and lessons.';
        document.getElementById('course-enrollment-card')?.classList.remove('hidden');
        enrollButton.classList.remove('hidden');
        const formatPrice = () => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(coursePrice);
        const paidLabel = `PAY ${formatPrice()} & ENROLL`;
        let paymentStatusUnknown = false;
        enrollButton.textContent = coursePrice > 0 ? paidLabel : 'ENROLL IN COURSE';
        enrollButton.addEventListener('click', async () => {
            if (paymentStatusUnknown) { window.location.reload(); return; }
            enrollButton.disabled = true;
            enrollButton.textContent = coursePrice > 0 ? 'OPENING SECURE CHECKOUT…' : 'ENROLLING...';
            try {
                if (coursePrice > 0) {
                    if (!window.Razorpay) throw new Error('Secure checkout did not load. Refresh the page and try again.');
                    const orderResponse = await window.api.payments.createOrder(courseId);
                    const order = orderResponse.data;
                    const checkout = new window.Razorpay({
                        key: order.keyId,
                        amount: order.amount,
                        currency: order.currency,
                        name: 'NYC',
                        description: order.courseName,
                        order_id: order.orderId,
                        theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#a855f7' },
                        prefill: { email: user?.email || '' },
                        handler: async (payment) => {
                            enrollmentMessage.textContent = 'Payment received. Confirming your course access…';
                            try {
                                const verification = await window.api.payments.verify({
                                    orderId: payment.razorpay_order_id,
                                    paymentId: payment.razorpay_payment_id,
                                    signature: payment.razorpay_signature
                                });
                                if (verification.data.status !== 'captured') {
                                    enrollmentMessage.textContent = 'Payment is processing. Course access will appear after it is confirmed.';
                                    enrollButton.textContent = 'PAYMENT PROCESSING';
                                    setTimeout(() => window.location.reload(), 5000);
                                    return;
                                }
                                enrollmentMessage.textContent = 'Payment confirmed. You are enrolled in this course.';
                                document.getElementById('course-enrollment-card')?.classList.add('hidden');
                                enrollButton.classList.add('hidden');
                                notifyReviewEnrollment();
                                showEnrolledCourseTabs('curriculum');
                                await loadCurriculum();
                            } catch (error) {
                                enrollmentMessage.textContent = `${error.message} Refresh this page before trying another payment.`;
                                paymentStatusUnknown = true;
                                enrollButton.disabled = false;
                                enrollButton.textContent = 'REFRESH PAYMENT STATUS';
                            }
                        },
                        modal: { ondismiss: () => { enrollButton.disabled = false; enrollButton.textContent = paidLabel; } }
                    });
                    checkout.on('payment.failed', (event) => {
                        enrollmentMessage.textContent = event.error?.description || 'Payment was not completed. You can try again.';
                        enrollButton.disabled = false;
                        enrollButton.textContent = paidLabel;
                    });
                    checkout.open();
                    return;
                }
                await window.api.courses.enroll(courseId);
                enrollmentMessage.textContent = 'You are enrolled in this course.';
                document.getElementById('course-enrollment-card')?.classList.add('hidden');
                enrollButton.classList.add('hidden');
                notifyReviewEnrollment();
                showEnrolledCourseTabs('curriculum');
                await loadCurriculum();
            } catch (error) {
                enrollmentMessage.textContent = error.message;
                enrollButton.disabled = false;
                enrollButton.textContent = coursePrice > 0 ? paidLabel : 'ENROLL IN COURSE';
            }
        });
    } catch (error) {
        viewLoading?.classList.add('hidden');
        if (requestedView === 'curriculum') {
            courseOverviewSection?.classList.remove('hidden');
            courseReviewsSection?.classList.remove('hidden');
        }
        showError(error.message || 'Unable to load this course.');
    }
});

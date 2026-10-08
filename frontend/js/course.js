const courseHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();

    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('course');
    const errorBox = document.getElementById('course-error');
    const enrollmentMessage = document.getElementById('enrollment-message');
    const enrollButton = document.getElementById('enroll-button');
    const loginLink = document.getElementById('login-enroll-link');
    const curriculumSection = document.getElementById('curriculum-section');
    const courseContentArea = document.getElementById('course-content-area');
    const courseContentTabs = document.getElementById('course-content-tabs');
    const discussionSection = document.getElementById('discussion-section');

    const showEnrolledCourseTabs = () => {
        courseContentArea?.classList.remove('hidden');
        courseContentTabs?.classList.remove('hidden');
        curriculumSection?.classList.remove('hidden');
        discussionSection?.classList.add('hidden');
        courseContentTabs?.querySelectorAll('[data-course-tab]').forEach((tab) => {
            const active = tab.dataset.courseTab === 'curriculum';
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        window.dispatchEvent(new CustomEvent('course:enrolled', { detail: { courseId } }));
    };

    courseContentTabs?.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-course-tab]');
        if (!tab) return;
        const showDiscussion = tab.dataset.courseTab === 'discussion';
        curriculumSection.classList.toggle('hidden', showDiscussion);
        discussionSection.classList.toggle('hidden', !showDiscussion);
        courseContentTabs.querySelectorAll('[data-course-tab]').forEach((item) => {
            const active = item === tab;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-selected', String(active));
        });
    });

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
    };

    if (!courseId) {
        showError('No course was selected.');
        return;
    }

    loginLink.href = `login.html?returnTo=${encodeURIComponent(`course.html?course=${courseId}`)}`;

    const loadCurriculum = async () => {
        courseContentArea?.classList.remove('hidden');
        curriculumSection.classList.remove('hidden');
        const container = document.getElementById('course-curriculum');
        container.textContent = 'Loading course content...';
        try {
            const modulesResponse = await window.api.courses.getModules(courseId);
            if (!modulesResponse.data.length) {
                container.textContent = 'No modules have been added to this course yet.';
                return;
            }

            const moduleSections = [];
            for (let moduleIndex = 0; moduleIndex < modulesResponse.data.length; moduleIndex++) {
                const module = modulesResponse.data[moduleIndex];
                const lessonsResponse = await window.api.modules.getLessons(module._id);
                const lessons = lessonsResponse.data.map((lesson, lessonIndex) => `
                    <li class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-[var(--bg-color)] brutal-border">
                        <div>
                            <h4 class="text-lg font-black uppercase">LESSON ${moduleIndex + 1}.${lessonIndex + 1} · ${courseHtml(lesson.title)}</h4>
                            <p class="font-bold text-sm">${courseHtml(lesson.type)}${lesson.duration ? ` · ${Math.ceil(lesson.duration / 60)} min` : ''}</p>
                        </div>
                        <a href="learn.html?course=${encodeURIComponent(courseId)}&lesson=${encodeURIComponent(lesson._id)}" class="text-center bg-[var(--accent)] text-white brutal-border px-5 py-2 font-black uppercase brutal-shadow hover:bg-black transition-colors">OPEN LESSON</a>
                    </li>
                `).join('');
                moduleSections.push(`
                    <article class="bg-[var(--bg-color)] brutal-border border-l-8 ${moduleIndex % 2 ? 'border-l-[var(--accent)]' : 'border-l-[var(--primary)]'} brutal-shadow p-6">
                        <h3 class="text-2xl font-black uppercase border-b-4 border-[var(--foreground)] pb-3 mb-4">MODULE ${moduleIndex + 1} · ${courseHtml(module.title)}</h3>
                        ${module.description ? `<p class="module-copy font-medium text-sm mb-4">${courseHtml(module.description)}</p>` : ''}
                        ${module.notesOriginalFilename ? `<button type="button" data-module-notes="${module._id}" class="module-notes-link mb-4" aria-label="View notes for module ${moduleIndex + 1}"><span class="module-notes-label">MODULE ${moduleIndex + 1} NOTES</span><span class="module-notes-filename">${courseHtml(module.notesOriginalFilename)}</span><span class="module-notes-action">VIEW NOTES</span></button>` : ''}
                        ${lessons ? `<ul class="space-y-3">${lessons}</ul>` : '<p class="font-bold">No lessons in this module yet.</p>'}
                    </article>
                `);
            }
            container.innerHTML = moduleSections.join('');
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

        if (course.demoVideo) {
            const demoStatus = document.getElementById('demo-status');
            demoStatus.textContent = 'Loading course preview...';
            try {
                const player = new StreamingPlayer('course-demo');
                await player.loadManifest(course.demoVideo);
                demoStatus.textContent = 'Course introduction';
            } catch (error) {
                demoStatus.textContent = `Preview unavailable: ${error.message}`;
            }
        } else {
            document.getElementById('demo-status').textContent = 'No course preview is available yet.';
        }

        const token = localStorage.getItem('token');
        let user = null;
        try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) {}
        const isOwner = user?.role === 'instructor' && String(course.instructor?._id) === String(user._id);
        const isManager = user?.role === 'admin' || isOwner;
        if (isManager) {
            document.getElementById('course-enrollment-card')?.classList.add('hidden');
            await loadCurriculum();
            return;
        }

        if (!token) {
            document.getElementById('course-enrollment-card')?.classList.remove('hidden');
            enrollmentMessage.textContent = 'Sign in and enroll to view course modules and lessons.';
            loginLink.classList.remove('hidden');
            return;
        }

        if (user?.role !== 'student') {
            document.getElementById('course-enrollment-card')?.classList.remove('hidden');
            enrollmentMessage.textContent = 'A student account is required to enroll in this course.';
            return;
        }

        let enrolledResponse;
        try {
            enrolledResponse = await window.api.student.getEnrolled();
        } catch (error) {
            if (error.status === 401) {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                document.getElementById('course-enrollment-card')?.classList.remove('hidden');
                enrollmentMessage.textContent = 'Your session expired. Sign in to enroll in this course.';
                loginLink.classList.remove('hidden');
                return;
            }
            throw error;
        }
        const isEnrolled = enrolledResponse.data.some((item) => String(item.course?._id) === String(courseId));
        if (isEnrolled) {
            document.getElementById('course-enrollment-card')?.classList.remove('hidden');
            enrollmentMessage.textContent = 'You are enrolled in this course.';
            showEnrolledCourseTabs();
            await loadCurriculum();
            return;
        }

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
                                enrollButton.classList.add('hidden');
                                showEnrolledCourseTabs();
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
                enrollButton.classList.add('hidden');
                showEnrolledCourseTabs();
                await loadCurriculum();
            } catch (error) {
                enrollmentMessage.textContent = error.message;
                enrollButton.disabled = false;
                enrollButton.textContent = coursePrice > 0 ? paidLabel : 'ENROLL IN COURSE';
            }
        });
    } catch (error) {
        showError(error.message || 'Unable to load this course.');
    }
});

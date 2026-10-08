const reviewHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

document.addEventListener('DOMContentLoaded', async () => {
    const courseId = new URLSearchParams(window.location.search).get('course');
    const summary = document.getElementById('course-rating-summary');
    const list = document.getElementById('course-review-list');
    const form = document.getElementById('course-review-form');
    const access = document.getElementById('course-review-access');
    const accessText = document.getElementById('course-review-access-text');
    const loginLink = document.getElementById('course-review-login');
    const ratingInput = document.getElementById('course-review-rating');
    const commentInput = document.getElementById('course-review-comment');
    const submitButton = document.getElementById('course-review-submit');
    const formHeading = document.getElementById('course-review-form-heading');
    const formStatus = document.getElementById('course-review-status');
    if (!courseId || !summary || !list || !form) return;

    let user = null;
    try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) {}
    const token = localStorage.getItem('token');
    const returnTo = `course.html?course=${encodeURIComponent(courseId)}`;
    loginLink.href = `login.html?returnTo=${encodeURIComponent(returnTo)}`;
    let canReview = false;
    let reviewData = null;
    const explainReviewError = (error) => error?.status === 404 && error.message === 'API route not found'
        ? 'The running backend does not have the course reviews route yet. Restart the backend or redeploy the latest backend code.'
        : error?.message || 'Unable to load course reviews.';

    const showAccess = () => {
        form.classList.toggle('hidden', !canReview);
        access.classList.toggle('hidden', canReview);
        if (canReview) {
            if (reviewData?.myReview) {
                ratingInput.value = String(reviewData.myReview.rating);
                commentInput.value = reviewData.myReview.comment;
                formHeading.textContent = 'Update your review';
                submitButton.textContent = 'Save review';
            } else {
                ratingInput.value = '5';
                commentInput.value = '';
                formHeading.textContent = 'Leave a review';
                submitButton.textContent = 'Submit review';
            }
            return;
        }
        if (!token || !user) {
            accessText.textContent = 'Sign in and enroll to leave a course review.';
            loginLink.classList.remove('hidden');
        } else {
            accessText.textContent = user.role === 'student'
                ? 'Enroll in this course to rate it and leave feedback.'
                : 'Course reviews are available to enrolled students.';
            loginLink.classList.add('hidden');
        }
    };

    const renderReviews = (data) => {
        reviewData = data;
        const average = Number(data.averageRating) || 0;
        const count = Number(data.reviewCount) || 0;
        summary.textContent = count
            ? `${average.toFixed(1)} / 5 · ${count} ${count === 1 ? 'review' : 'reviews'}`
            : 'Not rated yet · Be the first to review';
        const reviews = Array.isArray(data.reviews) ? data.reviews : [];
        if (!reviews.length) {
            list.innerHTML = '<p class="course-review-empty">No student reviews yet. Enrolled students can share the first one.</p>';
        } else {
            list.innerHTML = reviews.map((review) => {
                const dateValue = new Date(review.updatedAt || review.createdAt);
                const date = Number.isNaN(dateValue.getTime()) ? '' : dateValue.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                const rating = Math.min(5, Math.max(1, Number(review.rating) || 0));
                return `<article class="course-review-card">
                    <div class="course-review-card-heading">
                        <strong>${reviewHtml(review.student?.name || 'NYC student')}</strong>
                        <span class="course-review-stars" aria-label="${rating} out of 5 stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>
                    </div>
                    <p class="course-review-date">${reviewHtml(date)}</p>
                    <p class="course-review-comment">${reviewHtml(review.comment)}</p>
                </article>`;
            }).join('');
        }
        showAccess();
    };

    window.addEventListener('course:review-access', (event) => {
        if (String(event.detail?.courseId) !== String(courseId) || user?.role !== 'student') return;
        canReview = event.detail.enrolled === true;
        showAccess();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        formStatus.textContent = '';
        submitButton.disabled = true;
        submitButton.textContent = 'Saving review…';
        try {
            const saved = await window.api.reviews.submitForCourse(courseId, {
                rating: Number(ratingInput.value),
                comment: commentInput.value.trim()
            });
            reviewData = {
                ...(reviewData || {}),
                myReview: { rating: saved.data.rating, comment: saved.data.comment }
            };
            formStatus.textContent = 'Your review has been saved.';
            try {
                const response = await window.api.reviews.getForCourse(courseId);
                renderReviews(response.data);
            } catch (error) {
                formStatus.textContent = 'Your review was saved. Ratings will refresh when you reopen this course.';
                showAccess();
            }
        } catch (error) {
            formStatus.textContent = explainReviewError(error);
        } finally {
            submitButton.disabled = false;
            if (canReview) submitButton.textContent = reviewData?.myReview ? 'Save review' : 'Submit review';
        }
    });

    try {
        const response = await window.api.reviews.getForCourse(courseId);
        renderReviews(response.data);
    } catch (error) {
        summary.textContent = 'Ratings unavailable';
        list.innerHTML = `<p class="course-review-empty">${reviewHtml(explainReviewError(error))}</p>`;
        showAccess();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const loading = document.getElementById('verification-loading');
    const result = document.getElementById('verification-result');
    const status = document.getElementById('verification-status');
    const message = document.getElementById('verification-message');
    const details = document.getElementById('verification-details');
    const certificateId = new URLSearchParams(window.location.search).get('id');

    const showInvalid = (text) => {
        loading.classList.add('hidden');
        result.classList.remove('hidden');
        status.className = 'certificate-verification-status is-invalid';
        status.textContent = 'CERTIFICATE NOT VERIFIED';
        message.textContent = text;
        details.classList.add('hidden');
    };

    if (!certificateId) {
        showInvalid('No certificate ID was provided. Check the QR code or link and try again.');
        return;
    }

    try {
        const response = await window.api.certificates.verify(certificateId);
        const certificate = response.data;
        loading.classList.add('hidden');
        result.classList.remove('hidden');
        status.className = 'certificate-verification-status is-valid';
        status.textContent = 'CERTIFICATE VERIFIED';
        message.textContent = 'This person has completed this course.';
        document.getElementById('verification-student').textContent = certificate.studentName;
        document.getElementById('verification-course').textContent = certificate.courseTitle;
        document.getElementById('verification-id').textContent = certificate.certificateId;

        const completedAt = new Date(certificate.completedAt);
        const date = document.getElementById('verification-date');
        date.dateTime = completedAt.toISOString();
        date.textContent = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(completedAt);
        details.classList.remove('hidden');
    } catch (error) {
        showInvalid(error.status === 404 ? 'This certificate ID does not match a certificate issued by NYC.' : (error.message || 'Unable to verify this certificate right now.'));
    }
});

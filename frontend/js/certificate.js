document.addEventListener('DOMContentLoaded', async () => {
    const loading = document.getElementById('certificate-loading');
    const errorMessage = document.getElementById('certificate-error');
    const sheet = document.getElementById('certificate-sheet');
    const printButton = document.getElementById('print-certificate');
    const courseId = new URLSearchParams(window.location.search).get('course');

    printButton.addEventListener('click', () => window.print());

    if (!courseId) {
        loading.classList.add('hidden');
        errorMessage.textContent = 'A course was not specified. Open your dashboard and select a completed course.';
        errorMessage.classList.remove('hidden');
        return;
    }

    try {
        const response = await window.api.certificates.getForCourse(courseId);
        const certificate = response.data;
        document.getElementById('certificate-student').textContent = certificate.studentName;
        document.getElementById('certificate-course').textContent = certificate.courseTitle;
        document.getElementById('certificate-id').textContent = certificate.certificateId;

        const issuedAt = new Date(certificate.issuedAt);
        const date = document.getElementById('certificate-date');
        date.dateTime = issuedAt.toISOString();
        date.textContent = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(issuedAt);

        const verifyUrl = new URL('certificate-verify.html', window.location.href);
        verifyUrl.searchParams.set('id', certificate.certificateId);
        const addVerificationFallback = async () => {
            const qrContainer = document.querySelector('.certificate-qr');
            const canvas = qrContainer.querySelector('canvas');
            const image = document.createElement('img');
            image.className = 'certificate-qr-image';
            image.alt = 'Scan this QR code to verify the certificate';
            image.width = 128;
            image.height = 128;
            image.src = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&margin=4&data=${encodeURIComponent(verifyUrl.href)}`;

            try {
                await new Promise((resolve, reject) => {
                    const timeout = window.setTimeout(() => reject(new Error('QR generation timed out')), 8000);
                    image.addEventListener('load', () => {
                        window.clearTimeout(timeout);
                        resolve();
                    }, { once: true });
                    image.addEventListener('error', () => {
                        window.clearTimeout(timeout);
                        reject(new Error('QR generation failed'));
                    }, { once: true });
                });
                canvas?.remove();
                qrContainer.prepend(image);
            } catch {
                // Keep the direct verification link usable if QR generation is unavailable.
                image.remove();
                const fallback = document.createElement('a');
                fallback.className = 'certificate-verify-link';
                fallback.href = verifyUrl.href;
                fallback.textContent = 'OPEN VERIFICATION PAGE';
                qrContainer.appendChild(fallback);
            }
        };
        if (window.QRCode?.toCanvas) {
            try {
                await window.QRCode.toCanvas(document.getElementById('certificate-qr-canvas'), verifyUrl.href, {
                    width: 128,
                    margin: 1,
                    errorCorrectionLevel: 'M',
                    color: { dark: '#171126', light: '#f2effa' }
                });
            } catch (error) {
                await addVerificationFallback();
            }
        } else {
            await addVerificationFallback();
        }

        loading.classList.add('hidden');
        sheet.classList.remove('hidden');
        printButton.classList.remove('hidden');
    } catch (error) {
        loading.classList.add('hidden');
        errorMessage.textContent = error.message || 'Unable to load your certificate.';
        errorMessage.classList.remove('hidden');
    }
});

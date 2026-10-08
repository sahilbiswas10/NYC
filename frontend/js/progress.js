class ProgressTracker {
    constructor(videoElement, lessonId) {
        this.video = videoElement;
        this.lessonId = lessonId;
        this.interval = null;
        this.saving = false;
        this.lastSavedTime = 0;
        this.setupListeners();
        window.addEventListener('pagehide', () => this.saveProgress(true), { once: true });
    }

    setupListeners() {
        this.video.addEventListener('play', () => this.startTracking());
        this.video.addEventListener('pause', () => {
            this.stopTracking();
            this.saveProgress();
        });
        this.video.addEventListener('ended', () => {
            this.stopTracking();
            this.saveProgress();
        });
        this.video.addEventListener('seeked', () => {
            if (Math.abs(this.video.currentTime - this.lastSavedTime) >= 15) this.saveProgress();
        });
    }

    startTracking() {
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(() => this.saveProgress(), 20000);
    }

    stopTracking() {
        if (this.interval) clearInterval(this.interval);
    }

    async saveProgress(keepalive = false) {
        const currentTime = this.video.currentTime;
        const duration = this.video.duration;
        if (!Number.isFinite(currentTime) || currentTime < 0 || !Number.isFinite(duration) || duration <= 0 || this.saving) return;
        
        try {
            this.saving = true;
            await window.apiCall(`/lessons/${this.lessonId}/progress`, {
                method: 'PUT',
                body: JSON.stringify({ currentTime, duration }),
                keepalive
            });
            this.lastSavedTime = currentTime;
        } catch (err) {
            console.error('Failed to save progress', err);
        } finally {
            this.saving = false;
        }
    }
}
window.ProgressTracker = ProgressTracker;

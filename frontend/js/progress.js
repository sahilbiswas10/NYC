class ProgressTracker {
    constructor(videoElement, lessonId) {
        this.video = videoElement;
        this.lessonId = lessonId;
        this.interval = null;
        this.saving = false;
        this.pendingSave = false;
        this.pendingCompletion = false;
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
            this.completeLesson();
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
        if (this.saving) {
            this.pendingSave = true;
            return;
        }
        const currentTime = this.video.currentTime;
        const duration = this.video.duration;
        if (!Number.isFinite(currentTime) || currentTime < 0 || !Number.isFinite(duration) || duration <= 0) return;
        
        try {
            this.saving = true;
            const response = await window.apiCall(`/lessons/${this.lessonId}/progress`, {
                method: 'PUT',
                body: JSON.stringify({ currentTime, duration }),
                keepalive
            });
            this.lastSavedTime = currentTime;
            if (response.data?.completed) {
                window.dispatchEvent(new CustomEvent('lesson:completed', { detail: { lessonId: this.lessonId } }));
            } else {
                window.dispatchEvent(new CustomEvent('lesson:progress-saved', {
                    detail: { lessonId: this.lessonId, percentage: response.data?.percentage }
                }));
            }
        } catch (err) {
            console.error('Failed to save progress', err);
            window.dispatchEvent(new CustomEvent('lesson:progress-error', { detail: { lessonId: this.lessonId, message: err.message } }));
        } finally {
            this.saving = false;
            if (this.pendingCompletion) {
                this.pendingCompletion = false;
                this.pendingSave = false;
                this.completeLesson();
                return;
            }
            if (this.pendingSave) {
                this.pendingSave = false;
                this.saveProgress(keepalive);
            }
        }
    }

    async completeLesson() {
        if (this.saving) {
            this.pendingCompletion = true;
            return;
        }
        try {
            this.saving = true;
            const response = await window.apiCall(`/lessons/${encodeURIComponent(this.lessonId)}/complete`, {
                method: 'POST',
                body: JSON.stringify({ duration: this.video.duration })
            });
            this.lastSavedTime = this.video.duration;
            if (response.data?.completed) {
                window.dispatchEvent(new CustomEvent('lesson:completed', { detail: { lessonId: this.lessonId } }));
            } else {
                throw new Error('The server did not confirm lesson completion');
            }
        } catch (error) {
            console.error('Failed to save lesson completion', error);
            window.dispatchEvent(new CustomEvent('lesson:completion-error', { detail: { lessonId: this.lessonId, message: error.message } }));
        } finally {
            this.saving = false;
            if (this.pendingSave) {
                this.pendingSave = false;
                this.saveProgress();
            }
        }
    }
}
window.ProgressTracker = ProgressTracker;

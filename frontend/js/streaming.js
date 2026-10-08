class StreamingPlayer {
    constructor(videoElementId) {
        this.video = document.getElementById(videoElementId);
        this.hls = null;
    }

    async loadManifest(mediaId) {
        const token = localStorage.getItem('token');
        const ticketHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const ticketResponse = await fetch(`/api/media/play/${encodeURIComponent(mediaId)}/ticket`, {
            method: 'POST',
            headers: ticketHeaders
        });
        if (!ticketResponse.ok) throw new Error('You are not authorized to play this media.');
        const manifestUrl = `/api/media/play/${encodeURIComponent(mediaId)}/manifest`;

        return new Promise((resolve, reject) => {
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                if (this.hls) this.hls.destroy();
                this.hls = new Hls({
                    xhrSetup: (xhr) => {
                        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                    }
                });
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
                this.hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (data.fatal) reject(new Error('The HLS stream could not be loaded.'));
                });
                this.hls.loadSource(manifestUrl);
                this.hls.attachMedia(this.video);
            } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                this.video.addEventListener('loadedmetadata', resolve, { once: true });
                this.video.addEventListener('error', () => reject(new Error('The HLS stream could not be loaded.')), { once: true });
                this.video.src = manifestUrl;
            } else {
                reject(new Error('HLS is not supported in this browser.'));
            }
        });
    }

    play() { this.video.play(); }
    pause() { this.video.pause(); }
    seek(time) { this.video.currentTime = time; }
    
    destroy() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }
}

window.StreamingPlayer = StreamingPlayer;

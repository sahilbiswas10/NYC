class StreamingPlayer {
    constructor(videoElementId) {
        this.video = document.getElementById(videoElementId);
        this.hls = null;
        this.ticketTimer = null;
        this.generation = 0;
        this.cancelLoad = null;
        this.nativeCleanup = null;
        this.nativeSource = null;
    }

    async loadManifest(mediaId) {
        this.destroy();
        const generation = this.generation;
        const token = localStorage.getItem('token');
        let ticketExpiresAt = 0;
        const authorize = async () => {
            const currentToken = localStorage.getItem('token');
            const ticketHeaders = currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
            const ticketResponse = await fetch(`/api/media/play/${encodeURIComponent(mediaId)}/ticket`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: ticketHeaders
            });
            if (!ticketResponse.ok) {
                const responseText = await ticketResponse.text();
                let message = '';
                try {
                    const payload = JSON.parse(responseText);
                    message = payload.error || payload.message || '';
                } catch (error) {
                    message = responseText.trim();
                }
                const error = new Error(message || `Unable to authorize media playback (HTTP ${ticketResponse.status}).`);
                error.status = ticketResponse.status;
                throw error;
            }
            ticketExpiresAt = Date.now() + 5 * 60 * 1000;
        };
        await authorize();
        if (generation !== this.generation) throw new Error('Media loading cancelled');
        const manifestUrl = `/api/media/play/${encodeURIComponent(mediaId)}/manifest`;

        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                this.cancelLoad = null;
                this.nativeCleanup?.();
                this.nativeCleanup = null;
                callback(value);
            };
            this.cancelLoad = () => finish(reject, new Error('Media loading cancelled'));
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                if (this.hls) this.hls.destroy();
                this.hls = new Hls({
                    xhrSetup: (xhr) => {
                        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                    }
                });
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => finish(resolve));
                this.hls.on(Hls.Events.ERROR, (_event, data) => {
                    if (!data.fatal) return;
                    const status = data.response?.code;
                    const responseText = data.response?.text?.trim();
                    finish(reject, new Error(responseText || (status
                        ? `The HLS stream request failed (HTTP ${status}).`
                        : 'The HLS stream could not be loaded.')));
                });
                this.hls.loadSource(manifestUrl);
                this.hls.attachMedia(this.video);
            } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                const loaded = () => finish(resolve);
                const failed = () => finish(reject, new Error('The HLS stream could not be loaded.'));
                this.nativeCleanup = () => {
                    this.video.removeEventListener('loadedmetadata', loaded);
                    this.video.removeEventListener('error', failed);
                };
                this.video.addEventListener('loadedmetadata', loaded, { once: true });
                this.video.addEventListener('error', failed, { once: true });
                this.nativeSource = manifestUrl;
                this.video.src = manifestUrl;
            } else {
                finish(reject, new Error('HLS is not supported in this browser.'));
            }
        });

        const renewTicket = async () => {
            if (generation !== this.generation) return;
            this.ticketTimer = null;
            try {
                await authorize();
                if (generation === this.generation) this.ticketTimer = setTimeout(renewTicket, 4 * 60 * 1000);
            } catch (error) {
                if (generation !== this.generation) return;
                const temporary = error.status === undefined || error.status >= 500 || [408, 429].includes(error.status);
                if (temporary && Date.now() < ticketExpiresAt) {
                    this.ticketTimer = setTimeout(renewTicket, Math.min(15000, ticketExpiresAt - Date.now()));
                    return;
                }
                this.pause();
                console.error('Unable to renew media playback authorization:', error.message);
            }
        };
        if (generation === this.generation) this.ticketTimer = setTimeout(renewTicket, 4 * 60 * 1000);
    }

    play() { this.video.play(); }
    pause() { this.video.pause(); }
    seek(time) { this.video.currentTime = time; }
    
    destroy() {
        this.generation++;
        clearTimeout(this.ticketTimer);
        this.ticketTimer = null;
        this.cancelLoad?.();
        this.cancelLoad = null;
        this.nativeCleanup?.();
        this.nativeCleanup = null;
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.nativeSource && this.video.getAttribute('src') === this.nativeSource) {
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
        }
        this.nativeSource = null;
    }
}

window.StreamingPlayer = StreamingPlayer;

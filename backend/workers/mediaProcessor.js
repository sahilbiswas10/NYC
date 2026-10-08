const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const Media = require('../models/Media');

const storageRoot = path.resolve(__dirname, '../../storage');
const originalsRoot = path.join(storageRoot, 'originals');
const hlsRoot = path.join(storageRoot, 'hls');

const failMedia = async (media, error) => {
    media.processingStatus = 'failed';
    media.processingError = String(error?.message || 'Media processing failed').slice(0, 500);
    await media.save();
};

const processMedia = async (mediaId, { signal } = {}) => {
    const media = await Media.findById(mediaId);
    if (!media) throw new Error('Media record not found');

    let hlsDir;
    let progressSaves = Promise.resolve();
    const ensureNotCancelled = () => {
        if (signal?.aborted) throw new Error('Media processing cancelled');
    };
    try {
        media.processingStatus = 'processing';
        media.processingProgress = 0;
        media.processingError = undefined;
        await media.save();
        ensureNotCancelled();

        const originalPath = path.resolve(media.originalPath || '');
        const originalRelative = path.relative(originalsRoot, originalPath);
        if (!media.originalPath || originalRelative.startsWith(`..${path.sep}`) || originalRelative === '..' || path.isAbsolute(originalRelative)) {
            throw new Error('Original media path is invalid');
        }
        await fs.promises.access(originalPath, fs.constants.R_OK);

        const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(originalPath, (error, data) => error ? reject(error) : resolve(data));
        });
        ensureNotCancelled();
        const streamType = media.mediaType === 'audio' ? 'audio' : 'video';
        if (!metadata.streams?.some((stream) => stream.codec_type === streamType)) {
            throw new Error(`The uploaded file does not contain a ${streamType} stream`);
        }
        const probedDuration = Number(metadata.format?.duration);
        if (Number.isFinite(probedDuration) && probedDuration > 0) media.duration = probedDuration;

        hlsDir = path.resolve(hlsRoot, media._id.toString());
        const relativeHls = path.relative(hlsRoot, hlsDir);
        if (!relativeHls || relativeHls.startsWith(`..${path.sep}`) || path.isAbsolute(relativeHls)) {
            throw new Error('HLS output path is invalid');
        }

        await fs.promises.rm(hlsDir, { recursive: true, force: true });
        await fs.promises.mkdir(hlsDir, { recursive: true });
        const manifestPath = path.join(hlsDir, 'master.m3u8');
        const segmentPattern = path.join(hlsDir, 'segment_%05d.ts');

        const outputOptions = [
            '-start_number', '0',
            '-hls_time', '10',
            '-hls_list_size', '0',
            '-hls_segment_filename', segmentPattern,
            '-f', 'hls'
        ];
        if (streamType === 'video') {
            outputOptions.push('-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k');
        } else {
            outputOptions.push('-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100');
        }

        await new Promise((resolve, reject) => {
            let lastProgressSave = 0;
            let command;
            let settled = false;
            let finalizing = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', abort);
                callback(value);
            };
            const abort = () => {
                if (finalizing) return;
                try { command?.kill('SIGKILL'); }
                catch (error) { finish(reject, error); }
            };
            command = ffmpeg(originalPath)
                .outputOptions(...outputOptions)
                .output(manifestPath)
                .on('progress', (progress) => {
                    if (!Number.isFinite(progress.percent)) return;
                    const now = Date.now();
                    if (now - lastProgressSave < 2000) return;
                    lastProgressSave = now;
                    media.processingProgress = Math.max(0, Math.min(99, Math.round(progress.percent)));
                    progressSaves = progressSaves
                        .then(() => media.save())
                        .catch((error) => console.error('Unable to save media progress:', error.message));
                })
                .on('end', async () => {
                    finalizing = true;
                    try {
                        await progressSaves;
                        ensureNotCancelled();
                        const manifest = await fs.promises.readFile(manifestPath, 'utf8');
                        ensureNotCancelled();
                        const segments = manifest.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
                        if (!segments.length) throw new Error('FFmpeg produced an empty HLS manifest');
                        for (const filename of segments) {
                            if (path.basename(filename) !== filename) throw new Error('FFmpeg produced an invalid segment path');
                            await fs.promises.access(path.join(hlsDir, filename), fs.constants.R_OK);
                        }
                        ensureNotCancelled();
                        media.processingStatus = 'ready';
                        media.processingProgress = 100;
                        media.processingError = undefined;
                        media.hlsManifestPath = manifestPath;
                        await media.save();
                        if (media.duration > 0) {
                            await require('../models/Lesson').updateMany({ media: media._id }, { $set: { duration: media.duration } });
                        }
                        finish(resolve);
                    } catch (error) {
                        finish(reject, error);
                    }
                })
                .on('error', (error) => finish(reject, error));

            if (signal?.aborted) return finish(reject, new Error('Media processing cancelled'));
            signal?.addEventListener('abort', abort, { once: true });
            command.run();
        });
        return media;
    } catch (error) {
        try {
            await progressSaves;
            if (!signal?.aborted) await failMedia(media, error);
        } catch (saveError) {
            console.error('Unable to mark media processing as failed:', saveError.message);
        }
        const failedHlsDir = path.resolve(hlsRoot, media._id.toString());
        const failedRelative = path.relative(hlsRoot, failedHlsDir);
        if (failedRelative && !failedRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(failedRelative)) {
            await fs.promises.rm(failedHlsDir, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
    }
};

module.exports = { processMedia };

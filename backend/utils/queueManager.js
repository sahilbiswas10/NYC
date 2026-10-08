const Media = require('../models/Media');
const { processMedia } = require('../workers/mediaProcessor');
const fs = require('fs/promises');
const path = require('path');

const configuredLimit = Number.parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10);
const MAX_CONCURRENT = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 2;
const queue = [];
const queued = new Set();
const activeIds = new Set();
const controllers = new Map();
const activeJobs = new Map();

const hasValidHls = async (media) => {
    const hlsDir = path.resolve(__dirname, '../../storage/hls', String(media._id));
    const manifestPath = path.join(hlsDir, 'master.m3u8');
    if (!media.hlsManifestPath || path.resolve(media.hlsManifestPath) !== manifestPath) return false;
    try {
        const manifest = await fs.readFile(manifestPath, 'utf8');
        const segments = manifest.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
        if (!segments.length) return false;
        for (const filename of segments) {
            if (path.basename(filename) !== filename || !/^[A-Za-z0-9_.-]+$/.test(filename) || filename === '.' || filename === '..') return false;
            await fs.access(path.join(hlsDir, filename), fs.constants.R_OK);
        }
        return true;
    } catch (error) {
        return false;
    }
};

const processNext = () => {
    while (activeIds.size < MAX_CONCURRENT && queue.length > 0) {
        const mediaId = queue.shift();
        queued.delete(mediaId);
        if (activeIds.has(mediaId)) continue;

        activeIds.add(mediaId);
        const controller = new AbortController();
        controllers.set(mediaId, controller);
        const job = processMedia(mediaId, { signal: controller.signal });
        activeJobs.set(mediaId, job);
        job
            .catch((error) => {
                if (!controller.signal.aborted) console.error(`Media processing failed (${mediaId}):`, error.message);
            })
            .finally(() => {
                activeIds.delete(mediaId);
                controllers.delete(mediaId);
                activeJobs.delete(mediaId);
                processNext();
                const cleanupTimer = setTimeout(async () => {
                    try {
                        const media = await Media.findById(mediaId);
                        if (media) await require('./mediaCleanup').cleanupMedia(media);
                    } catch (error) {
                        console.error(`Unable to clean orphan media (${mediaId}):`, error.message);
                    }
                }, 60_000);
                cleanupTimer.unref?.();
            });
    }
};

exports.cancelMediaProcessing = async (mediaId) => {
    const id = mediaId.toString();
    const queuedIndex = queue.indexOf(id);
    if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
    queued.delete(id);
    const controller = controllers.get(id);
    if (!controller) return;
    controller.abort();
    await activeJobs.get(id)?.catch(() => {});
};

exports.addToQueue = (mediaId) => {
    const id = mediaId.toString();
    if (queued.has(id) || activeIds.has(id)) return;
    queued.add(id);
    queue.push(id);
    processNext();
};

exports.recoverPendingJobs = async () => {
    const pending = await Media.find({ processingStatus: { $in: ['uploaded', 'processing'] } }).select('_id').lean();
    const ready = await Media.find({ processingStatus: 'ready' }).select('_id hlsManifestPath').lean();
    const invalidReady = [];
    for (const media of ready) {
        if (!(await hasValidHls(media))) {
            await Media.updateOne({ _id: media._id, processingStatus: 'ready' }, { $set: { processingStatus: 'uploaded', processingProgress: 0 } });
            invalidReady.push(media);
        }
    }
    const jobs = [...pending, ...invalidReady];
    jobs.forEach(({ _id }) => exports.addToQueue(_id));
    if (jobs.length) console.log(`Queued ${jobs.length} unfinished or invalid media job(s)`);
};

exports.hasValidHls = hasValidHls;

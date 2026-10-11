const fs = require('fs/promises');
const path = require('path');

const storageRoot = path.resolve(__dirname, '../../storage');
const originalsRoot = path.join(storageRoot, 'originals');
const hlsRoot = path.join(storageRoot, 'hls');
const pendingCleanup = new Set();

const isWithin = (root, target) => {
    const relative = path.relative(root, target);
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

exports.cleanupMedia = async (media) => {
    if (!media) return;
    const mediaId = String(media._id);

    const Lesson = require('../models/Lesson');
    const Course = require('../models/Course');
    const Media = require('../models/Media');
    if (await Lesson.exists({ media: media._id }) || await Course.exists({ demoVideo: media._id })) {
        pendingCleanup.delete(mediaId);
        return false;
    }
    if (['uploaded', 'processing'].includes(media.processingStatus)) {
        // Only an explicit detach/delete requests cleanup after processing.
        pendingCleanup.add(mediaId);
        // Controllers may have loaded this document before the worker finished.
        // Register first so the queue finalizer sees a concurrent detach request.
        const current = await Media.findById(mediaId);
        if (!current) {
            pendingCleanup.delete(mediaId);
            return false;
        }
        if (!['uploaded', 'processing'].includes(current.processingStatus)) return exports.cleanupMedia(current);
        return false;
    }

    const originalPath = media.originalPath ? path.resolve(media.originalPath) : null;
    const fileSharedByAnotherRecord = media.originalPath && await Media.exists({ _id: { $ne: media._id }, originalPath: media.originalPath });
    if (originalPath && isWithin(originalsRoot, originalPath) && !fileSharedByAnotherRecord) {
        try {
            const [realRoot, realOriginal] = await Promise.all([fs.realpath(originalsRoot), fs.realpath(originalPath)]);
            if (isWithin(realRoot, realOriginal)) await fs.rm(originalPath, { force: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    // Build the HLS folder from the media id, never from a stored path.
    if (/^[a-f\d]{24}$/i.test(mediaId)) {
        const hlsDir = path.resolve(hlsRoot, mediaId);
        if (isWithin(hlsRoot, hlsDir)) {
            await fs.rm(hlsDir, { recursive: true, force: true });
        }
    }

    await media.deleteOne();
    pendingCleanup.delete(mediaId);
    return true;
};

exports.isCleanupPending = (mediaId) => pendingCleanup.has(String(mediaId));

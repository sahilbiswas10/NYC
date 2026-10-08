const fs = require('fs/promises');
const path = require('path');

const storageRoot = path.resolve(__dirname, '../../storage');
const originalsRoot = path.join(storageRoot, 'originals');
const hlsRoot = path.join(storageRoot, 'hls');

const isWithin = (root, target) => {
    const relative = path.relative(root, target);
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

exports.cleanupMedia = async (media) => {
    if (!media) return;
    if (['uploaded', 'processing'].includes(media.processingStatus)) return false;

    const Lesson = require('../models/Lesson');
    const Course = require('../models/Course');
    const Media = require('../models/Media');
    if (await Lesson.exists({ media: media._id }) || await Course.exists({ demoVideo: media._id })) return;

    const originalPath = media.originalPath ? path.resolve(media.originalPath) : null;
    const fileSharedByAnotherRecord = media.originalPath && await Media.exists({ _id: { $ne: media._id }, originalPath: media.originalPath });
    if (originalPath && isWithin(originalsRoot, originalPath) && !fileSharedByAnotherRecord) {
        await fs.rm(originalPath, { force: true }).catch((error) => {
            console.error('Failed to remove an original media file:', error.message);
        });
    }

    // Build the HLS folder from the media id, never from a stored path.
    const mediaId = String(media._id);
    if (/^[a-f\d]{24}$/i.test(mediaId)) {
        const hlsDir = path.resolve(hlsRoot, mediaId);
        if (isWithin(hlsRoot, hlsDir)) {
            await fs.rm(hlsDir, { recursive: true, force: true }).catch((error) => {
                console.error('Failed to remove generated HLS files:', error.message);
            });
        }
    }

    await media.deleteOne();
    return true;
};

const mongoose = require('mongoose');

const ModuleSchema = new mongoose.Schema({
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, required: true },
    description: String,
    order: { type: Number, default: 0 },
    notesStorageFilename: String,
    notesOriginalFilename: String,
    notesMimeType: String
}, { timestamps: true });


ModuleSchema.pre('deleteOne', { document: true, query: false }, async function() {
    const Lesson = require('./Lesson');
    const lessons = await Lesson.find({ module: this._id });
    this.$locals.mediaIds = [...new Set(lessons.map((lesson) => lesson.media?.toString()).filter(Boolean))];
    await Lesson.deleteMany({ module: this._id });
});

ModuleSchema.post('deleteOne', { document: true, query: false }, async function() {
    const fs = require('fs/promises');
    const path = require('path');
    const notesRoot = path.resolve(__dirname, '../../storage/module-notes');
    const notesName = this.notesStorageFilename;
    if (notesName && path.basename(notesName) === notesName && /^module-notes-[a-f0-9-]+\.(pdf|txt|md)$/i.test(notesName)) {
        const notesPath = path.resolve(notesRoot, notesName);
        const relative = path.relative(notesRoot, notesPath);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.unlink(notesPath).catch(() => {});
    }
    const Media = require('./Media');
    const { cleanupMedia } = require('../utils/mediaCleanup');
    for (const mediaId of this.$locals.mediaIds || []) {
        const media = await Media.findById(mediaId);
        if (media) await cleanupMedia(media);
    }
});

module.exports = mongoose.model('Module', ModuleSchema);

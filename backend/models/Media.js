const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    originalFilename: String,
    originalPath: String,
    mediaType: { type: String, enum: ['video', 'audio', 'document'] },
    duration: { type: Number, default: 0 },
    fileSize: Number,
    processingStatus: { type: String, enum: ['uploaded', 'processing', 'ready', 'failed'], default: 'uploaded' },
    processingProgress: { type: Number, default: 0 },
    processingError: { type: String, select: false },
    hlsManifestPath: String,
    availableQualities: [String],
    thumbnail: String
}, { timestamps: true });

module.exports = mongoose.model('Media', MediaSchema);

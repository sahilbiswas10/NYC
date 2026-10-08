const mongoose = require('mongoose');

const DiscussionPostSchema = new mongoose.Schema({
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'DiscussionPost', default: null },
    message: { type: String, required: true, trim: true, maxlength: 3000 }
}, { timestamps: true });

DiscussionPostSchema.index({ course: 1, parent: 1, createdAt: 1 });

module.exports = mongoose.model('DiscussionPost', DiscussionPostSchema);

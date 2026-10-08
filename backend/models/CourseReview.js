const mongoose = require('mongoose');

const CourseReviewSchema = new mongoose.Schema({
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 2000 }
}, { timestamps: true });

CourseReviewSchema.index({ student: 1, course: 1 }, { unique: true });
CourseReviewSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model('CourseReview', CourseReviewSchema);

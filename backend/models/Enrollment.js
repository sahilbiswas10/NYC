const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
    progress: { type: Number, default: 0 },
    lastAccessedLesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    lastAccessedAt: Date,
    completedAt: Date,
    certificateId: { type: String, unique: true, sparse: true },
    certificateIssuedAt: Date,
    certificateStudentName: String,
    certificateCourseTitle: String
}, { timestamps: true });

EnrollmentSchema.index({ student: 1, course: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', EnrollmentSchema);

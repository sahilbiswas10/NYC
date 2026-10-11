const Enrollment = require('../models/Enrollment');

exports.recalculateEnrollment = async (enrollment) => {
    if (enrollment.status === 'cancelled') return enrollment;
    const state = await require('./learningAccess').getLearningState(enrollment.course, enrollment.student);
    enrollment.progress = state.progress;
    enrollment.status = state.courseCompleted ? 'completed' : 'active';
    enrollment.completedAt = state.courseCompleted ? (enrollment.completedAt || new Date()) : undefined;
    enrollment.$locals = enrollment.$locals || {};
    enrollment.$locals.learningState = state;
    if (typeof enrollment.isModified !== 'function' || enrollment.isModified()) await enrollment.save();
    return enrollment;
};

exports.recalculateCourseEnrollments = async (courseId) => {
    const enrollments = await Enrollment.find({ course: courseId, status: { $in: ['active', 'completed'] } });
    for (const enrollment of enrollments) await exports.recalculateEnrollment(enrollment);
};

const Lesson = require('../models/Lesson');
const LessonProgress = require('../models/LessonProgress');
const Enrollment = require('../models/Enrollment');

exports.recalculateEnrollment = async (enrollment) => {
    const required = await Lesson.find({ course: enrollment.course, isRequired: true }).select('_id');
    if (!required.length) {
        enrollment.progress = 0;
        enrollment.status = 'active';
        enrollment.completedAt = undefined;
        await enrollment.save();
        return enrollment;
    }
    const completed = await LessonProgress.countDocuments({
        student: enrollment.student,
        course: enrollment.course,
        lesson: { $in: required.map((lesson) => lesson._id) },
        completed: true
    });
    enrollment.progress = Math.round((completed / required.length) * 100);
    if (completed === required.length) {
        enrollment.status = 'completed';
        enrollment.completedAt = enrollment.completedAt || new Date();
    } else {
        enrollment.status = 'active';
        enrollment.completedAt = undefined;
    }
    await enrollment.save();
    return enrollment;
};

exports.recalculateCourseEnrollments = async (courseId) => {
    const enrollments = await Enrollment.find({ course: courseId, status: { $in: ['active', 'completed'] } });
    for (const enrollment of enrollments) await exports.recalculateEnrollment(enrollment);
};

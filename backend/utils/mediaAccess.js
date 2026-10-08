const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Lesson = require('../models/Lesson');

const isAdmin = (user) => user?.role === 'admin';

const canManageMedia = async (media, user) => {
    if (!media || !user) return false;
    if (isAdmin(user)) return true;
    if (media.uploadedBy && media.uploadedBy.toString() === user.id) return true;

    const lesson = await Lesson.findOne({ media: media._id }).select('course');
    const course = lesson
        ? await Course.findById(lesson.course).select('instructor')
        : await Course.findOne({ demoVideo: media._id }).select('instructor');

    return Boolean(course && user.role === 'instructor' && course.instructor.toString() === user.id);
};

const canStreamMedia = async (media, user) => {
    if (!media) return false;
    if (isAdmin(user)) return true;

    const lesson = await Lesson.findOne({ media: media._id }).select('course isPreview');
    if (lesson) {
        const course = await Course.findById(lesson.course).select('instructor status');
        if (!course) return false;
        if (!user) return false;
        if (user.role === 'instructor' && course.instructor.toString() === user.id) return true;
        if (user.role !== 'student') return false;
        return Boolean(await Enrollment.exists({
            student: user.id,
            course: course._id,
            status: { $in: ['active', 'completed'] }
        }));
    }

    const course = await Course.findOne({ demoVideo: media._id }).select('instructor status');
    if (!course) return false;
    if (user?.role === 'instructor') return course.instructor.toString() === user.id;
    return course.status === 'published' && (!user || user.role === 'student');
};

module.exports = { canManageMedia, canStreamMedia };

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lms_platform', {
        serverSelectionTimeoutMS: 10000
    });

    const totals = await Enrollment.aggregate([
        { $match: { status: { $in: ['active', 'completed'] } } },
        { $group: { _id: { course: '$course', student: '$student' } } },
        { $group: { _id: '$_id.course', totalStudents: { $sum: 1 } } }
    ]);
    const countByCourse = new Map(totals.map(({ _id, totalStudents }) => [String(_id), totalStudents]));
    const courses = await Course.find().select('_id title totalStudents').lean();
    const changes = courses
        .map((course) => ({
            _id: course._id,
            title: course.title,
            oldCount: Number(course.totalStudents) || 0,
            newCount: countByCourse.get(String(course._id)) || 0
        }))
        .filter((course) => course.oldCount !== course.newCount);

    if (!changes.length) {
        console.log(`Student totals already match enrollment records (${courses.length} courses checked).`);
        return;
    }

    console.log(`${changes.length} of ${courses.length} course student totals differ from active/completed enrollments:`);
    for (const course of changes) console.log(`- ${course.title}: ${course.oldCount} -> ${course.newCount}`);

    if (!process.argv.includes('--apply')) {
        console.log('\nPreview only. Run `npm run courses:sync-students -- --apply` to write these corrections.');
        return;
    }

    await Course.bulkWrite(changes.map((course) => ({
        updateOne: {
            filter: { _id: course._id },
            update: { $set: { totalStudents: course.newCount } }
        }
    })));
    console.log(`Updated ${changes.length} course student totals.`);
};

run()
    .catch((error) => {
        console.error(`Unable to reconcile course student totals: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });

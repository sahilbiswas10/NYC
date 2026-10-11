const Notification = require('../models/Notification');
const Enrollment = require('../models/Enrollment');

async function notify({ recipient, course, title, message, href, eventKey }) {
    // Destinations are supplied by server code, never arbitrary client URLs.
    await Notification.updateOne({ recipient, eventKey }, {
        $setOnInsert: { recipient, course, title, message, href, eventKey }
    }, { upsert: true });
}
async function notifyCourse(course, content) {
    let count = 0;
    const cursor = Enrollment.find({ course, status: { $in: ['active', 'completed'] } }).select('student').cursor();
    for await (const enrollment of cursor) {
        await notify({ ...content, course, recipient: enrollment.student });
        count++;
    }
    return count;
}
// A notification failure must not undo a saved quiz result or discussion reply.
async function bestEffort(work) {
    try { await work(); } catch (error) { console.error('Unable to deliver notification:', error.message); }
}
module.exports = { notify, notifyCourse, bestEffort };

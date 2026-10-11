const mongoose = require('mongoose');
const NotificationSchema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    title: { type: String, required: true, maxlength: 180 },
    message: { type: String, required: true, maxlength: 3000 },
    href: { type: String, required: true },
    eventKey: { type: String, required: true },
    readAt: { type: Date, default: null }
}, { timestamps: true });
NotificationSchema.index({ recipient: 1, eventKey: 1 }, { unique: true });
NotificationSchema.index({ recipient: 1, createdAt: -1 });
module.exports = mongoose.model('Notification', NotificationSchema);

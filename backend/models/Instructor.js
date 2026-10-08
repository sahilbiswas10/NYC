const mongoose = require('mongoose');

const InstructorSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    bio: { type: String, required: true, trim: true, maxlength: 5000 },
    title: { type: String, trim: true, maxlength: 160, default: '' },
    photoFilename: { type: String, required: true },
    photoContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Instructor', InstructorSchema);

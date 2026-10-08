const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs/promises');
const Instructor = require('../models/Instructor');
const Course = require('../models/Course');

const photoRoot = path.resolve(__dirname, '../../storage/instructors');
const photoUrl = (id) => `/api/instructors/${id}/photo`;
const publicInstructor = (item) => ({
    _id: item._id,
    name: item.name,
    bio: item.bio,
    title: item.title,
    photoUrl: photoUrl(item._id),
    active: item.active
});

const removePhoto = async (filename) => {
    if (!filename || path.basename(filename) !== filename || !/^instructor-[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) return;
    const target = path.resolve(photoRoot, filename);
    const relative = path.relative(photoRoot, target);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) await fs.unlink(target).catch(() => {});
};

exports.listPublicInstructors = async (_req, res) => {
    try {
        const instructors = await Instructor.find({ active: true }).sort('name').lean();
        res.json({ success: true, data: instructors.map(publicInstructor) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load instructors' });
    }
};

exports.getPublicInstructor = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Instructor not found' });
        const instructor = await Instructor.findOne({ _id: req.params.id, active: true }).lean();
        if (!instructor) return res.status(404).json({ success: false, error: 'Instructor not found' });
        const courses = await Course.find({ instructorProfile: instructor._id, status: 'published' }).select('title slug shortDescription thumbnail level').sort('-publishedAt').lean();
        res.json({ success: true, data: { ...publicInstructor(instructor), courses } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load instructor profile' });
    }
};

exports.getInstructorPhoto = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
        const instructor = await Instructor.findOne({ _id: req.params.id, active: true }).select('photoFilename photoContentType').lean();
        if (!instructor || path.basename(instructor.photoFilename || '') !== instructor.photoFilename) return res.status(404).end();
        const target = path.resolve(photoRoot, instructor.photoFilename);
        const relative = path.relative(photoRoot, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(404).end();
        res.type(instructor.photoContentType).set('Cache-Control', 'public, max-age=3600').sendFile(target, (error) => {
            if (error && !res.headersSent) res.status(404).end();
        });
    } catch (error) {
        res.status(404).end();
    }
};

exports.listAdminInstructors = async (_req, res) => {
    try {
        const instructors = await Instructor.find({}).sort('name').lean();
        res.json({ success: true, data: instructors.map(publicInstructor) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load instructor profiles' });
    }
};

exports.createInstructor = async (req, res) => {
    try {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : '';
        const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        if (!name || !bio || !req.file) {
            if (req.file) await removePhoto(req.file.filename);
            return res.status(400).json({ success: false, error: 'Name, bio, and a profile photo are required' });
        }
        const instructor = await Instructor.create({ name, bio, title, photoFilename: req.file.filename, photoContentType: req.file.mimetype });
        res.status(201).json({ success: true, data: publicInstructor(instructor) });
    } catch (error) {
        if (req.file) await removePhoto(req.file.filename);
        res.status(400).json({ success: false, error: 'Unable to create instructor profile' });
    }
};

exports.updateInstructor = async (req, res) => {
    const replacementFilename = req.file?.filename;
    let replacementSaved = false;
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Instructor not found' });
        const instructor = await Instructor.findById(req.params.id);
        if (!instructor) return res.status(404).json({ success: false, error: 'Instructor not found' });
        if (Object.hasOwn(req.body, 'name')) {
            if (typeof req.body.name !== 'string' || !req.body.name.trim()) return res.status(400).json({ success: false, error: 'Instructor name is required' });
            instructor.name = req.body.name.trim();
        }
        if (Object.hasOwn(req.body, 'bio')) {
            if (typeof req.body.bio !== 'string' || !req.body.bio.trim()) return res.status(400).json({ success: false, error: 'Instructor bio is required' });
            instructor.bio = req.body.bio.trim();
        }
        if (Object.hasOwn(req.body, 'title')) instructor.title = String(req.body.title || '').trim();
        if (req.file) {
            const oldFilename = instructor.photoFilename;
            instructor.photoFilename = req.file.filename;
            instructor.photoContentType = req.file.mimetype;
            await instructor.save();
            replacementSaved = true;
            await removePhoto(oldFilename);
        } else {
            await instructor.save();
        }
        res.json({ success: true, data: publicInstructor(instructor) });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Unable to update instructor profile' });
    } finally {
        if (replacementFilename && !replacementSaved) await removePhoto(replacementFilename);
    }
};

exports.deleteInstructor = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Instructor not found' });
        const instructor = await Instructor.findById(req.params.id);
        if (!instructor) return res.status(404).json({ success: false, error: 'Instructor not found' });
        await Course.updateMany({ instructorProfile: instructor._id }, { $unset: { instructorProfile: 1 } });
        await instructor.deleteOne();
        await removePhoto(instructor.photoFilename);
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete instructor profile' });
    }
};

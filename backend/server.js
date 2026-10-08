const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectWithRetry = async () => {
    const connected = await connectDB();
    if (connected) {
        require('./utils/queueManager').recoverPendingJobs()
            .catch((error) => console.error('Unable to recover media jobs:', error.message));
        return;
    }
    const retry = setTimeout(connectWithRetry, 5000);
    retry.unref?.();
};
connectWithRetry();

const app = express();

app.use(helmet({
    contentSecurityPolicy: false // Disabled for MVP to allow Tailwind and HLS CDNs
}));
app.use(cors());
const paymentRoutes = require('./routes/paymentRoutes');
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentRoutes.handleWebhook);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/api/health', (_req, res) => {
    const ready = require('mongoose').connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ success: ready, database: ready ? 'connected' : 'unavailable' });
});
app.get('/favicon.ico', (_req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/favicon.svg'));
});

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/courses', require('./routes/courseRoutes'));
app.use('/api/courses', require('./routes/discussionRoutes'));
app.use('/api/courses/:courseId/modules', require('./routes/moduleRoutes'));
app.use('/api/modules/:moduleId/lessons', require('./routes/lessonRoutes'));
app.use('/api/media', require('./routes/mediaRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/instructors', require('./routes/instructorRoutes'));
app.use('/api/payments', paymentRoutes.router);
const { getManifest, getSegment, issueStreamTicket } = require('./controllers/streamController');
const streamAuth = require('./middleware/streamAuth');
const { optionalProtect } = require('./middleware/auth');
app.post('/api/media/play/:mediaId/ticket', optionalProtect, issueStreamTicket);
app.get('/api/media/play/:mediaId/manifest', streamAuth, getManifest);
app.get('/api/media/play/:mediaId/segment/:filename', streamAuth, getSegment);
app.use('/api', require('./routes/enrollmentRoutes'));
app.use('/api', require('./routes/progressRoutes'));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
    res.status(404).sendFile(path.join(__dirname, '../frontend/404.html'), (error) => {
        if (error && !res.headersSent) res.status(404).send('Page not found');
    });
});
app.use((error, req, res, _next) => {
    console.error('Request failed:', error.message);
    if (res.headersSent) return;
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (req.path.startsWith('/api')) return res.status(status).json({ success: false, error: status >= 500 ? 'An internal server error occurred' : 'Request could not be processed' });
    res.status(status).send(status >= 500 ? 'An internal server error occurred' : 'Request could not be processed');
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});

module.exports = { app, server };

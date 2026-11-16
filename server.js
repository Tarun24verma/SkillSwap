const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middlewares
app.use(helmet({
    contentSecurityPolicy: false // Allows Bootstrap CDN and scripts
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets from public/
app.use(express.static(path.join(__dirname, 'public')));

// Root health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'SkillSwap API', timestamp: new Date() });
});

// Mount modular API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api', require('./routes/search')); // /api/subjects, /api/tutors
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/credits', require('./routes/credits'));

// 404 handler for API routes and fallback to index.html for frontend navigation
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server if run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`SkillSwap server running at http://localhost:${PORT}`);
    });
}

module.exports = app;

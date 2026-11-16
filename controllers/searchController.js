const pool = require('../models/db');

// GET /api/subjects - List all available subjects
exports.getSubjects = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, code FROM subjects ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching subjects:', err);
        res.status(500).json({ error: 'Server error fetching subjects' });
    }
};

// GET /api/tutors - Search tutors by subject or keyword
exports.searchTutors = async (req, res) => {
    const { subject_id, query } = req.query;
    const currentUserId = req.user ? req.user.id : null;

    try {
        let sql = `
            SELECT 
                u.id AS tutor_id,
                u.name AS tutor_name,
                u.email AS tutor_email,
                u.rating,
                u.total_sessions_taught,
                s.id AS subject_id,
                s.name AS subject_name,
                s.code AS subject_code,
                us.skill_level
            FROM user_skills us
            JOIN users u ON u.id = us.user_id
            JOIN subjects s ON s.id = us.subject_id
            WHERE us.can_teach = TRUE
        `;
        const params = [];

        // Exclude self if authenticated
        if (currentUserId) {
            params.push(currentUserId);
            sql += ` AND u.id != $${params.length}`;
        }

        // Filter by subject_id
        if (subject_id) {
            params.push(parseInt(subject_id, 10));
            sql += ` AND us.subject_id = $${params.length}`;
        }

        // Filter by keyword query (matches tutor name or subject name)
        if (query) {
            params.push(`%${query}%`);
            sql += ` AND (u.name ILIKE $${params.length} OR s.name ILIKE $${params.length})`;
        }

        sql += ` ORDER BY u.rating DESC NULLS LAST, u.total_sessions_taught DESC, u.name ASC`;

        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error searching tutors:', err);
        res.status(500).json({ error: 'Server error searching tutors' });
    }
};

// GET /api/tutors/:id - View a specific tutor's public profile and reviews
exports.getTutorProfile = async (req, res) => {
    const tutorId = parseInt(req.params.id, 10);
    if (isNaN(tutorId)) return res.status(400).json({ error: 'Invalid tutor ID' });

    try {
        // Fetch tutor details
        const tutorResult = await pool.query(
            `SELECT id, name, email, role, rating, total_sessions_taught, created_at
             FROM users WHERE id = $1`,
            [tutorId]
        );
        if (tutorResult.rows.length === 0) {
            return res.status(404).json({ error: 'Tutor not found' });
        }
        const tutor = tutorResult.rows[0];

        // Fetch subjects this tutor can teach
        const skillsResult = await pool.query(
            `SELECT s.id AS subject_id, s.name, s.code, us.skill_level
             FROM user_skills us
             JOIN subjects s ON s.id = us.subject_id
             WHERE us.user_id = $1 AND us.can_teach = TRUE
             ORDER BY s.name ASC`,
            [tutorId]
        );

        // Fetch recent feedback/reviews
        const reviewsResult = await pool.query(
            `SELECT sess.id AS session_id, sess.student_rating, sess.student_feedback,
                    sess.scheduled_at, u.name AS student_name, s.name AS subject_name
             FROM sessions sess
             JOIN users u ON u.id = sess.student_id
             JOIN subjects s ON s.id = sess.subject_id
             WHERE sess.tutor_id = $1 AND sess.student_rating IS NOT NULL
             ORDER BY sess.scheduled_at DESC
             LIMIT 10`,
            [tutorId]
        );

        res.json({
            tutor,
            subjects: skillsResult.rows,
            reviews: reviewsResult.rows,
        });
    } catch (err) {
        console.error('Error fetching tutor profile:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

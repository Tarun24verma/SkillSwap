const pool = require('../models/db');
const { validationResult } = require('express-validator');

// GET /api/profile - View own profile with credit balance and stats
exports.getProfile = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, role, credits, rating,
                    total_sessions_taught, total_sessions_taken, created_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0)
            return res.status(404).json({ error: 'User not found' });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// PUT /api/profile - Update own name and/or role
exports.updateProfile = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, role } = req.body;

    try {
        const result = await pool.query(
            `UPDATE users SET
                name = COALESCE($1, name),
                role = COALESCE($2, role)
             WHERE id = $3
             RETURNING id, name, email, role, credits, rating, total_sessions_taught, total_sessions_taken`,
            [name, role, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating profile:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// GET /api/profile/skills - List user's skills (can_teach and learning-only)
exports.getSkills = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT us.subject_id, s.name AS subject_name, s.code,
                    us.skill_level, us.can_teach,
                    CASE WHEN us.can_teach THEN 'teach' ELSE 'learn' END AS type
             FROM user_skills us
             JOIN subjects s ON s.id = us.subject_id
             WHERE us.user_id = $1
             ORDER BY s.name ASC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching skills:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// POST /api/profile/skills - Add or update a subject skill
exports.addSkill = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { subject_id, skill_level = 'beginner' } = req.body;
    const can_teach = req.body.can_teach !== undefined 
        ? Boolean(req.body.can_teach) 
        : (req.body.type === 'teach');

    try {
        // Validate subject exists
        const subject = await pool.query('SELECT id, name FROM subjects WHERE id = $1', [subject_id]);
        if (subject.rows.length === 0)
            return res.status(404).json({ error: 'Subject not found' });

        // Upsert skill on (user_id, subject_id)
        const result = await pool.query(
            `INSERT INTO user_skills (user_id, subject_id, skill_level, can_teach)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, subject_id)
             DO UPDATE SET 
                skill_level = EXCLUDED.skill_level,
                can_teach = EXCLUDED.can_teach
             RETURNING user_id, subject_id, skill_level, can_teach,
                       CASE WHEN can_teach THEN 'teach' ELSE 'learn' END AS type`,
            [req.user.id, subject_id, skill_level, can_teach]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error saving skill:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// DELETE /api/profile/skills/:subject_id - Remove a skill
exports.removeSkill = async (req, res) => {
    const subject_id = parseInt(req.params.subject_id, 10);
    if (isNaN(subject_id)) return res.status(400).json({ error: 'Invalid subject ID' });

    try {
        const result = await pool.query(
            `DELETE FROM user_skills WHERE user_id = $1 AND subject_id = $2 RETURNING subject_id`,
            [req.user.id, subject_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Skill not found in profile' });
        }
        res.json({ message: 'Skill removed successfully', subject_id });
    } catch (err) {
        console.error('Error removing skill:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

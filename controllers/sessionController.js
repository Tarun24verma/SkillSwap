const pool = require('../models/db');
const { validationResult } = require('express-validator');

// POST /api/sessions - Student books a session
exports.bookSession = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const student_id = req.user.id;
    const { tutor_id, subject_id, scheduled_at, duration_mins = 60 } = req.body;

    // 1. Cannot book yourself
    if (parseInt(tutor_id, 10) === student_id) {
        return res.status(400).json({ error: 'You cannot book a tutoring session with yourself' });
    }

    // 2. Scheduled time must be in future
    const scheduledDate = new Date(scheduled_at);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        return res.status(400).json({ error: 'Scheduled time must be a valid future date and time' });
    }

    try {
        // 3. Check student's current credit balance (must have >= 5)
        const studentResult = await pool.query('SELECT credits FROM users WHERE id = $1', [student_id]);
        if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
        
        const balance = studentResult.rows[0].credits;
        if (balance < 5) {
            return res.status(400).json({
                error: `Insufficient credits. You have ${balance} credit(s), but at least 5 credits are required to book a session. Please purchase credits first.`
            });
        }

        // 4. Verify tutor exists and can teach this subject
        const tutorSkillResult = await pool.query(
            `SELECT us.can_teach, u.name AS tutor_name
             FROM user_skills us
             JOIN users u ON u.id = us.user_id
             WHERE us.user_id = $1 AND us.subject_id = $2`,
            [tutor_id, subject_id]
        );
        if (tutorSkillResult.rows.length === 0 || !tutorSkillResult.rows[0].can_teach) {
            return res.status(400).json({ error: 'Selected tutor does not teach this subject' });
        }

        // 5. Insert new session in pending status
        const sessionResult = await pool.query(
            `INSERT INTO sessions (tutor_id, student_id, subject_id, status, scheduled_at, duration_mins)
             VALUES ($1, $2, $3, 'pending', $4, $5)
             RETURNING *`,
            [tutor_id, student_id, subject_id, scheduledDate, duration_mins]
        );

        res.status(201).json({
            message: 'Session requested successfully',
            session: sessionResult.rows[0]
        });
    } catch (err) {
        console.error('Error booking session:', err);
        res.status(500).json({ error: 'Server error booking session' });
    }
};

// GET /api/sessions - Get user's sessions (as student or tutor)
exports.getSessions = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT 
                s.id, s.tutor_id, s.student_id, s.subject_id, s.status,
                s.scheduled_at, s.duration_mins, s.student_rating, s.student_feedback, s.created_at,
                subj.name AS subject_name, subj.code AS subject_code,
                tutor.name AS tutor_name, tutor.email AS tutor_email,
                student.name AS student_name, student.email AS student_email,
                CASE WHEN s.tutor_id = $1 THEN 'tutor' ELSE 'student' END AS user_role
             FROM sessions s
             JOIN subjects subj ON subj.id = s.subject_id
             JOIN users tutor ON tutor.id = s.tutor_id
             JOIN users student ON student.id = s.student_id
             WHERE s.student_id = $1 OR s.tutor_id = $1
             ORDER BY s.scheduled_at DESC`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching sessions:', err);
        res.status(500).json({ error: 'Server error fetching sessions' });
    }
};

// PATCH /api/sessions/:id/accept - Tutor accepts request
exports.acceptSession = async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const tutorId = req.user.id;

    try {
        const session = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
        if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

        if (session.rows[0].tutor_id !== tutorId) {
            return res.status(403).json({ error: 'Only the assigned tutor can accept this session' });
        }
        if (session.rows[0].status !== 'pending') {
            return res.status(400).json({ error: `Cannot accept session with status '${session.rows[0].status}'` });
        }

        const updated = await pool.query(
            `UPDATE sessions SET status = 'accepted' WHERE id = $1 RETURNING *`,
            [sessionId]
        );
        res.json({ message: 'Session accepted', session: updated.rows[0] });
    } catch (err) {
        console.error('Error accepting session:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// PATCH /api/sessions/:id/decline - Tutor declines request
exports.declineSession = async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const tutorId = req.user.id;

    try {
        const session = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
        if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

        if (session.rows[0].tutor_id !== tutorId) {
            return res.status(403).json({ error: 'Only the assigned tutor can decline this session' });
        }
        if (session.rows[0].status !== 'pending') {
            return res.status(400).json({ error: `Cannot decline session with status '${session.rows[0].status}'` });
        }

        const updated = await pool.query(
            `UPDATE sessions SET status = 'declined' WHERE id = $1 RETURNING *`,
            [sessionId]
        );
        res.json({ message: 'Session declined', session: updated.rows[0] });
    } catch (err) {
        console.error('Error declining session:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// PATCH /api/sessions/:id/cancel - Student or tutor cancels
exports.cancelSession = async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    try {
        const session = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
        if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

        const s = session.rows[0];
        if (s.student_id !== userId && s.tutor_id !== userId) {
            return res.status(403).json({ error: 'You are not a participant in this session' });
        }
        if (s.status === 'completed' || s.status === 'cancelled' || s.status === 'declined') {
            return res.status(400).json({ error: `Cannot cancel session with status '${s.status}'` });
        }

        const updated = await pool.query(
            `UPDATE sessions SET status = 'cancelled' WHERE id = $1 RETURNING *`,
            [sessionId]
        );
        res.json({ message: 'Session cancelled', session: updated.rows[0] });
    } catch (err) {
        console.error('Error cancelling session:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// POST /api/sessions/:id/complete - The core atomic 5/4/1 SkillCredit transfer
exports.completeSession = async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Lock and fetch session row
        const sessionResult = await client.query(
            `SELECT * FROM sessions WHERE id = $1 FOR UPDATE`,
            [sessionId]
        );
        if (sessionResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = sessionResult.rows[0];

        // Only participants can complete
        if (session.student_id !== userId && session.tutor_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only session participants can complete this session' });
        }

        // Idempotency check: Cannot complete twice or if not accepted
        if (session.status === 'completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Session has already been completed' });
        }
        if (session.status !== 'accepted') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Cannot complete a session with status '${session.status}'. Session must be 'accepted' first.` });
        }

        // 2. Lock student row and verify credit balance
        const studentResult = await client.query(
            `SELECT credits FROM users WHERE id = $1 FOR UPDATE`,
            [session.student_id]
        );
        const studentCredits = studentResult.rows[0].credits;
        if (studentCredits < 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `Student has insufficient credits (${studentCredits}). A minimum of 5 credits is required.`
            });
        }

        // 3. Atomically update balances:
        // Student pays 5
        await client.query(
            `UPDATE users 
             SET credits = credits - 5, total_sessions_taken = total_sessions_taken + 1 
             WHERE id = $1`,
            [session.student_id]
        );
        // Tutor earns 4
        await client.query(
            `UPDATE users 
             SET credits = credits + 4, total_sessions_taught = total_sessions_taught + 1 
             WHERE id = $1`,
            [session.tutor_id]
        );
        // Platform collects 1 (sink account id = 0)
        await client.query(
            `UPDATE users 
             SET credits = credits + 1 
             WHERE id = 0`
        );

        // 4. Create 3 ledger entries in transactions
        await client.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, transaction_type, session_id)
             VALUES 
                ($1, 0, 5, 'session_charge', $3),
                (0, $2, 4, 'session_earning', $3),
                (0, 0, 1, 'platform_fee', $3)`,
            [session.student_id, session.tutor_id, session.id]
        );

        // 5. Update session status to completed
        const updatedSession = await client.query(
            `UPDATE sessions SET status = 'completed' WHERE id = $1 RETURNING *`,
            [session.id]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Session completed successfully. 5 credits deducted from student, 4 credited to tutor, 1 platform fee.',
            session: updatedSession.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error completing session:', err);
        res.status(500).json({ error: 'Server error during credit transfer. Transaction rolled back.' });
    } finally {
        client.release();
    }
};

// POST /api/sessions/:id/rate - Rate tutor after completed session
exports.rateSession = async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    const studentId = req.user.id;
    const { rating, feedback } = req.body;

    const numericRating = parseInt(rating, 10);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
        return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check session exists and is completed
        const sessionResult = await client.query(
            `SELECT * FROM sessions WHERE id = $1 FOR UPDATE`,
            [sessionId]
        );
        if (sessionResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = sessionResult.rows[0];

        if (session.student_id !== studentId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Only the student of this session can submit a rating' });
        }
        if (session.status !== 'completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Only completed sessions can be rated' });
        }
        if (session.student_rating !== null) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This session has already been rated' });
        }

        // Save rating on session
        await client.query(
            `UPDATE sessions 
             SET student_rating = $1, student_feedback = $2 
             WHERE id = $3`,
            [numericRating, feedback || null, sessionId]
        );

        // Update tutor's aggregate rating dynamically
        const tutorUpdate = await client.query(
            `UPDATE users 
             SET rating = (
                 SELECT ROUND(AVG(student_rating)::numeric, 2) 
                 FROM sessions 
                 WHERE tutor_id = $1 AND student_rating IS NOT NULL
             )
             WHERE id = $1
             RETURNING id, name, rating`,
            [session.tutor_id]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Feedback submitted successfully',
            tutor: tutorUpdate.rows[0],
            rating: numericRating,
            feedback
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error submitting feedback:', err);
        res.status(500).json({ error: 'Server error submitting feedback' });
    } finally {
        client.release();
    }
};

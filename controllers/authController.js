const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { getFirebaseAuth } = require('../utils/firebaseAdmin');

const SIGNUP_BONUS = 5;

// POST /api/auth/firebase-session - Verify Firebase identity and provision SkillSwap account
exports.createFirebaseSession = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    }

    const authorization = req.headers.authorization || '';
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
        return res.status(401).json({ error: 'Firebase ID token is required' });
    }
    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET is not configured');
        return res.status(500).json({ error: 'Authentication is not configured' });
    }

    let firebaseAuth;
    try {
        firebaseAuth = getFirebaseAuth();
    } catch (err) {
        console.error('Firebase Admin configuration error:', err.stack || err.message);
        return res.status(500).json({ error: 'Firebase authentication is not configured' });
    }

    let decodedToken;
    try {
        decodedToken = await firebaseAuth.verifyIdToken(tokenMatch[1]);
    } catch (err) {
        console.warn('Firebase ID token verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired Firebase session' });
    }

    if (!decodedToken.uid || !decodedToken.email) {
        return res.status(401).json({ error: 'Firebase account must have a verified email address' });
    }
    if (decodedToken.email_verified !== true) {
        return res.status(403).json({ error: 'Verify your email address before continuing' });
    }

    const email = decodedToken.email.trim().toLowerCase();
    const body = req.body || {};
    const suppliedName = typeof body.name === 'string' ? body.name.trim() : '';
    const tokenName = typeof decodedToken.name === 'string' ? decodedToken.name.trim() : '';
    const name = suppliedName || tokenName || email.split('@')[0];
    const role = body.role || 'both';
    if (email.length > 150) {
        return res.status(400).json({ error: 'Email address is too long' });
    }
    if (name.length > 100) {
        return res.status(400).json({ error: 'Name must be 100 characters or fewer' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        let created = false;
        let userResult = await client.query(
            `SELECT id, name, email, role, credits, rating,
                    total_sessions_taught, total_sessions_taken, created_at
             FROM users
             WHERE firebase_uid = $1
             FOR UPDATE`,
            [decodedToken.uid]
        );
        let user = userResult.rows[0];

        if (user) {
            if (user.email !== email) {
                userResult = await client.query(
                    `UPDATE users SET email = $1
                     WHERE id = $2
                     RETURNING id, name, email, role, credits, rating,
                               total_sessions_taught, total_sessions_taken, created_at`,
                    [email, user.id]
                );
                user = userResult.rows[0];
            }
        } else {
            const existingEmail = await client.query(
                `SELECT id, firebase_uid
                 FROM users
                 WHERE email = $1
                 FOR UPDATE`,
                [email]
            );

            if (existingEmail.rows.length > 0) {
                const existing = existingEmail.rows[0];
                if (existing.firebase_uid && existing.firebase_uid !== decodedToken.uid) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'This email is already linked to another account' });
                }

                userResult = await client.query(
                    `UPDATE users
                     SET firebase_uid = $1, password_hash = NULL
                     WHERE id = $2
                     RETURNING id, name, email, role, credits, rating,
                               total_sessions_taught, total_sessions_taken, created_at`,
                    [decodedToken.uid, existing.id]
                );
                user = userResult.rows[0];
            } else {
                userResult = await client.query(
                    `INSERT INTO users (firebase_uid, name, email, password_hash, role, credits)
                     VALUES ($1, $2, $3, NULL, $4, $5)
                     ON CONFLICT (firebase_uid) DO NOTHING
                     RETURNING id, name, email, role, credits, rating,
                               total_sessions_taught, total_sessions_taken, created_at`,
                    [decodedToken.uid, name, email, role, SIGNUP_BONUS]
                );
                user = userResult.rows[0];

                if (user) {
                    created = true;
                    await client.query(
                        `INSERT INTO transactions (sender_id, receiver_id, amount, transaction_type)
                         VALUES (0, $1, $2, 'signup_bonus')`,
                        [user.id, SIGNUP_BONUS]
                    );
                } else {
                    userResult = await client.query(
                        `SELECT id, name, email, role, credits, rating,
                                total_sessions_taught, total_sessions_taken, created_at
                         FROM users
                         WHERE firebase_uid = $1
                         FOR UPDATE`,
                        [decodedToken.uid]
                    );
                    user = userResult.rows[0];
                    if (!user) throw new Error('Firebase account could not be provisioned');
                }
            }
        }

        await client.query('COMMIT');

        const sessionToken = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.status(created ? 201 : 200).json({
            token: sessionToken,
            user
        });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ error: 'An account already exists for this email' });
        }
        console.error('Error creating SkillSwap session:', err);
        return res.status(500).json({ error: 'Server error creating account session' });
    } finally {
        if (client) client.release();
    }
};

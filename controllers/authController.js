const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const pool = require('../models/db');
const { sendOtpEmail } = require('../utils/mailer');

const SIGNUP_BONUS = 5;

// POST /api/auth/register-initiate - Step 1: Validate, generate OTP, send email
exports.initiateRegister = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    }

    const { name, email, password, role = 'both' } = req.body;

    try {
        // 1. Check if email is already a registered user
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered. Please sign in instead.' });
        }

        // 2. Generate 6-digit numeric OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const hashedPassword = await bcrypt.hash(password, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // 3. Upsert into email_verifications table
        await pool.query(
            `INSERT INTO email_verifications (email, name, password_hash, role, otp, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (email)
             DO UPDATE SET
                name = EXCLUDED.name,
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                otp = EXCLUDED.otp,
                expires_at = EXCLUDED.expires_at,
                created_at = NOW()`,
            [email, name, hashedPassword, role, otp, expiresAt]
        );

        // 4. Send email via nodemailer
        await sendOtpEmail(email, name, otp);

        res.status(200).json({
            message: `Verification code sent to ${email}. Please check your inbox.`,
            email
        });
    } catch (err) {
        console.error('Error initiating registration:', err);
        res.status(500).json({ error: 'Server error sending verification code' });
    }
};

// POST /api/auth/verify-otp - Step 2: Validate OTP, create user & credit bonus
exports.verifyOtp = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    }

    const { email, otp } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check verification record
        const verResult = await client.query(
            'SELECT * FROM email_verifications WHERE email = $1 FOR UPDATE',
            [email]
        );

        if (verResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No pending registration found for this email. Please register again.' });
        }

        const record = verResult.rows[0];

        // 2. Check if expired
        if (new Date() > new Date(record.expires_at)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
        }

        // 3. Validate OTP
        if (record.otp !== otp.trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid verification code. Please check your email and try again.' });
        }

        // 4. Double check if email got registered in between
        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Email already registered. Please sign in.' });
        }

        // 5. Create user with 5 credits
        const userResult = await client.query(
            `INSERT INTO users (name, email, password_hash, role, credits)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, email, role, credits, rating, total_sessions_taught, total_sessions_taken, created_at`,
            [record.name, record.email, record.password_hash, record.role, SIGNUP_BONUS]
        );
        const user = userResult.rows[0];

        // 6. Record signup_bonus in transactions ledger
        await client.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, transaction_type)
             VALUES (0, $1, $2, 'signup_bonus')`,
            [user.id, SIGNUP_BONUS]
        );

        // 7. Clean up email_verifications
        await client.query('DELETE FROM email_verifications WHERE email = $1', [email]);

        await client.query('COMMIT');

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Email verified successfully! Welcome to SkillSwap.',
            token,
            user
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error verifying OTP:', err);
        res.status(500).json({ error: 'Server error during verification' });
    } finally {
        client.release();
    }
};

// POST /api/auth/resend-otp - Resend code
exports.resendOtp = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const verResult = await pool.query('SELECT * FROM email_verifications WHERE email = $1', [email]);
        if (verResult.rows.length === 0) {
            return res.status(400).json({ error: 'No pending registration found for this email.' });
        }

        const record = verResult.rows[0];
        const newOtp = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            'UPDATE email_verifications SET otp = $1, expires_at = $2, created_at = NOW() WHERE email = $3',
            [newOtp, expiresAt, email]
        );

        await sendOtpEmail(email, record.name, newOtp);

        res.json({ message: `New verification code sent to ${email}.` });
    } catch (err) {
        console.error('Error resending OTP:', err);
        res.status(500).json({ error: 'Server error resending code' });
    }
};

// Legacy direct register kept for backward compatibility (e.g. tests)
exports.register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, role = 'both' } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const userResult = await client.query(
            `INSERT INTO users (name, email, password_hash, role, credits)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, email, role, credits, rating, total_sessions_taught, total_sessions_taken, created_at`,
            [name, email, hashedPassword, role, SIGNUP_BONUS]
        );
        const user = userResult.rows[0];

        await client.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, transaction_type)
             VALUES (0, $1, $2, 'signup_bonus')`,
            [user.id, SIGNUP_BONUS]
        );

        await client.query('COMMIT');

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({ token, user });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error during registration:', err);
        res.status(500).json({ error: 'Server error during registration' });
    } finally {
        client.release();
    }
};

exports.login = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0)
            return res.status(401).json({ error: 'Invalid credentials' });

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch)
            return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const { password_hash: _, ...safeUser } = user;
        res.json({ token, user: safeUser });
    } catch (err) {
        console.error('Error during login:', err);
        res.status(500).json({ error: 'Server error during login' });
    }
};

jest.mock('../utils/firebaseAdmin', () => ({
    getFirebaseAuth: () => ({
        verifyIdToken: async token => JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    })
}));

const request = require('supertest');
const app = require('../server');
const pool = require('../models/db');

const tokenFor = (uid, email, emailVerified = true) => Buffer.from(JSON.stringify({
    uid,
    email,
    email_verified: emailVerified
})).toString('base64url');

describe('Firebase authentication and account provisioning', () => {
    const testEmail = `student_${Date.now()}@university.edu`;
    const testUid = `firebase_student_${Date.now()}`;
    const unverifiedEmail = `unverified_${Date.now()}@university.edu`;
    let userToken = '';
    let userId;

    afterAll(async () => {
        if (userId) {
            await pool.query(
                `DELETE FROM transactions
                 WHERE sender_id = $1 OR receiver_id = $1`,
                [userId]
            );
            await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        }
        await pool.query('DELETE FROM users WHERE email = $1', [unverifiedEmail]);
    });

    test('verified Firebase identity creates a user and one signup bonus', async () => {
        const res = await request(app)
            .post('/api/auth/firebase-session')
            .set('Authorization', `Bearer ${tokenFor(testUid, testEmail)}`)
            .send({ name: 'Test Student', role: 'both' });

        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toHaveProperty('credits', 5);
        userId = res.body.user.id;
        userToken = res.body.token;

        const user = await pool.query(
            'SELECT firebase_uid, password_hash FROM users WHERE id = $1',
            [userId]
        );
        expect(user.rows[0].firebase_uid).toBe(testUid);
        expect(user.rows[0].password_hash).toBeNull();

        const transactions = await pool.query(
            `SELECT sender_id, amount FROM transactions
             WHERE receiver_id = $1 AND transaction_type = 'signup_bonus'`,
            [userId]
        );
        expect(transactions.rows).toEqual([{ sender_id: 0, amount: 5 }]);
    });

    test('repeated Firebase session does not grant another signup bonus', async () => {
        const res = await request(app)
            .post('/api/auth/firebase-session')
            .set('Authorization', `Bearer ${tokenFor(testUid, testEmail)}`)
            .send({ name: 'Changed Name', role: 'student' });

        expect(res.statusCode).toBe(200);
        expect(res.body.user.id).toBe(userId);
        expect(res.body.user.name).toBe('Test Student');
        expect(res.body.user.credits).toBe(5);

        const transactions = await pool.query(
            `SELECT id FROM transactions
             WHERE receiver_id = $1 AND transaction_type = 'signup_bonus'`,
            [userId]
        );
        expect(transactions.rows).toHaveLength(1);
    });

    test('unverified Firebase identity cannot create a user or receive credits', async () => {
        const res = await request(app)
            .post('/api/auth/firebase-session')
            .set('Authorization', `Bearer ${tokenFor('firebase_unverified', unverifiedEmail, false)}`)
            .send({ name: 'Unverified Student' });

        expect(res.statusCode).toBe(403);
        const user = await pool.query('SELECT id FROM users WHERE email = $1', [unverifiedEmail]);
        expect(user.rows).toHaveLength(0);
    });

    test('legacy direct registration endpoint is no longer available', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Unverified', email: unverifiedEmail, password: 'password123' });

        expect(res.statusCode).toBe(404);
    });

    test('protected profile uses the SkillSwap session token', async () => {
        const res = await request(app)
            .get('/api/profile')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.email).toBe(testEmail);
        expect(res.body.credits).toBe(5);
    });
});

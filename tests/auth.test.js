const request = require('supertest');
const app = require('../server');
const pool = require('../models/db');

describe('1. Authentication & Accounts', () => {
    const testEmail = `student_${Date.now()}@university.edu`;
    let userToken = '';

    afterAll(async () => {
        // Clean up test user and transactions
        if (testEmail) {
            await pool.query('DELETE FROM transactions WHERE sender_id IN (SELECT id FROM users WHERE email = $1) OR receiver_id IN (SELECT id FROM users WHERE email = $1)', [testEmail]);
            await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
        }
    });

    test('POST /api/auth/register should create user with 5 credits and signup_bonus transaction', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: 'Test Student',
                email: testEmail,
                password: 'password123',
                role: 'both'
            });

        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toHaveProperty('credits', 5);
        userToken = res.body.token;

        // Verify signup_bonus ledger entry
        const txRes = await pool.query(
            `SELECT * FROM transactions WHERE receiver_id = $1 AND transaction_type = 'signup_bonus'`,
            [res.body.user.id]
        );
        expect(txRes.rows.length).toBe(1);
        expect(txRes.rows[0].sender_id).toBe(0); // platform wallet
        expect(txRes.rows[0].amount).toBe(5);
    });

    test('POST /api/auth/register with duplicate email should return 409 conflict', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                name: 'Duplicate Student',
                email: testEmail,
                password: 'password123',
                role: 'student'
            });

        expect(res.statusCode).toBe(409);
        expect(res.body).toHaveProperty('error', 'Email already registered');
    });

    test('POST /api/auth/login should authenticate and return a valid JWT', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: testEmail,
                password: 'password123'
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.email).toBe(testEmail);
    });

    test('GET /api/profile without token should return 401 Unauthorized', async () => {
        const res = await request(app).get('/api/profile');
        expect(res.statusCode).toBe(401);
    });

    test('GET /api/profile with valid token should return user profile', async () => {
        const res = await request(app)
            .get('/api/profile')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.email).toBe(testEmail);
        expect(res.body.credits).toBe(5);
    });
});

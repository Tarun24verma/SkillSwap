jest.mock('../utils/firebaseAdmin', () => ({
    getFirebaseAuth: () => ({
        verifyIdToken: async token => JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    })
}));

const request = require('supertest');
const app = require('../server');
const pool = require('../models/db');

const tokenFor = (uid, email) => Buffer.from(JSON.stringify({
    uid,
    email,
    email_verified: true
})).toString('base64url');

describe('Core SkillCredit Economy, Lifecycle & Purchase Rules', () => {
    const studentEmail = `student_engine_${Date.now()}@university.edu`;
    const tutorEmail = `tutor_engine_${Date.now()}@university.edu`;
    const studentFirebaseUid = `student_engine_${Date.now()}`;
    const tutorFirebaseUid = `tutor_engine_${Date.now()}`;

    let studentToken, studentId;
    let tutorToken, tutorId;
    let subjectId;
    let sessionId;
    let platformCreditsBefore;

    beforeAll(async () => {
        const platform = await pool.query('SELECT credits FROM users WHERE id = 0');
        platformCreditsBefore = platform.rows[0].credits;
        const subject = await pool.query(
            'INSERT INTO subjects (name, code) VALUES ($1, $2) RETURNING id',
            ['Credit Engine Test Subject', `TEST${Date.now()}`]
        );
        subjectId = subject.rows[0].id;

        // Register Student
        const resStudent = await request(app)
            .post('/api/auth/firebase-session')
            .set('Authorization', `Bearer ${tokenFor(studentFirebaseUid, studentEmail)}`)
            .send({ name: 'Student Alice', role: 'student' });
        studentToken = resStudent.body.token;
        studentId = resStudent.body.user.id;

        // Register Tutor
        const resTutor = await request(app)
            .post('/api/auth/firebase-session')
            .set('Authorization', `Bearer ${tokenFor(tutorFirebaseUid, tutorEmail)}`)
            .send({ name: 'Tutor Bob', role: 'tutor' });
        tutorToken = resTutor.body.token;
        tutorId = resTutor.body.user.id;

        // Tutor adds skill with can_teach = true
        await request(app)
            .post('/api/profile/skills')
            .set('Authorization', `Bearer ${tutorToken}`)
            .send({ subject_id: subjectId, skill_level: 'advanced', can_teach: true });
    });

    afterAll(async () => {
        // Clean up test data in reverse foreign key order
        const userIds = [studentId, tutorId].filter(Boolean);
        if (userIds.length > 0) {
            await pool.query('DELETE FROM credit_purchases WHERE user_id = ANY($1)', [userIds]);
            await pool.query('DELETE FROM transactions WHERE sender_id = ANY($1) OR receiver_id = ANY($1)', [userIds]);
            await pool.query('DELETE FROM sessions WHERE student_id = ANY($1) OR tutor_id = ANY($1)', [userIds]);
            await pool.query('DELETE FROM user_skills WHERE user_id = ANY($1)', [userIds]);
            await pool.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
        }
        if (subjectId) {
            await pool.query('DELETE FROM subjects WHERE id = $1', [subjectId]);
        }
        if (platformCreditsBefore !== undefined) {
            await pool.query('UPDATE users SET credits = $1 WHERE id = 0', [platformCreditsBefore]);
        }
    });

    test('Tutor should appear in search results for subject', async () => {
        const res = await request(app)
            .get(`/api/tutors?subject_id=${subjectId}`)
            .set('Authorization', `Bearer ${studentToken}`);

        expect(res.statusCode).toBe(200);
        const match = res.body.find(t => t.tutor_id === tutorId);
        expect(match).toBeDefined();
        expect(match.tutor_name).toBe('Tutor Bob');
    });

    test('Student cannot book session with themselves', async () => {
        const futureDate = new Date(Date.now() + 86400000).toISOString();
        const res = await request(app)
            .post('/api/sessions')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({
                tutor_id: studentId,
                subject_id: subjectId,
                scheduled_at: futureDate,
                duration_mins: 60
            });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/cannot book.*yourself/i);
    });

    test('Student books session with tutor successfully (status: pending)', async () => {
        const futureDate = new Date(Date.now() + 86400000).toISOString();
        const res = await request(app)
            .post('/api/sessions')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({
                tutor_id: tutorId,
                subject_id: subjectId,
                scheduled_at: futureDate,
                duration_mins: 60
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.session.status).toBe('pending');
        sessionId = res.body.session.id;
    });

    test('Tutor accepts session (status: pending -> accepted)', async () => {
        const res = await request(app)
            .patch(`/api/sessions/${sessionId}/accept`)
            .set('Authorization', `Bearer ${tutorToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.session.status).toBe('accepted');
    });

    test('Atomic Credit Split: Student -5, Tutor +4, Platform +1 on completion', async () => {
        // Get initial platform balance
        const platformBefore = await pool.query('SELECT credits FROM users WHERE id = 0');
        const initialPlatformCredits = platformBefore.rows[0].credits;

        const res = await request(app)
            .post(`/api/sessions/${sessionId}/complete`)
            .set('Authorization', `Bearer ${tutorToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.session.status).toBe('completed');

        // Check Student Balance (started with 5, now should be 0)
        const studentRes = await pool.query('SELECT credits FROM users WHERE id = $1', [studentId]);
        expect(studentRes.rows[0].credits).toBe(0);

        // Check Tutor Balance (started with 5, now should be 9)
        const tutorRes = await pool.query('SELECT credits FROM users WHERE id = $1', [tutorId]);
        expect(tutorRes.rows[0].credits).toBe(9);

        // Check Platform Balance (+1)
        const platformAfter = await pool.query('SELECT credits FROM users WHERE id = 0');
        expect(platformAfter.rows[0].credits).toBe(initialPlatformCredits + 1);

        // Verify 3 ledger entries in transactions
        const txs = await pool.query(
            'SELECT * FROM transactions WHERE session_id = $1 ORDER BY id ASC',
            [sessionId]
        );
        expect(txs.rows.length).toBe(3);

        const types = txs.rows.map(t => t.transaction_type);
        expect(types).toContain('session_charge');
        expect(types).toContain('session_earning');
        expect(types).toContain('platform_fee');
    });

    test('Idempotency Check: Completing an already completed session must fail', async () => {
        const res = await request(app)
            .post(`/api/sessions/${sessionId}/complete`)
            .set('Authorization', `Bearer ${tutorToken}`);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/already.*completed/i);
    });

    test('Feedback: Student rates tutor (5 stars) -> updates tutor average rating', async () => {
        const res = await request(app)
            .post(`/api/sessions/${sessionId}/rate`)
            .set('Authorization', `Bearer ${studentToken}`)
            .send({ rating: 5, feedback: 'Super clear explanations on algorithms!' });

        expect(res.statusCode).toBe(200);
        expect(res.body.rating).toBe(5);
        expect(Number(res.body.tutor.rating)).toBe(5.00);

        // Submitting rating a second time on the same session should fail
        const resDup = await request(app)
            .post(`/api/sessions/${sessionId}/rate`)
            .set('Authorization', `Bearer ${studentToken}`)
            .send({ rating: 4 });
        expect(resDup.statusCode).toBe(400);
    });

    test('Credit Purchase Buy-Gate: Tutor with 9 credits cannot purchase', async () => {
        const res = await request(app)
            .post('/api/credits/buy-mock')
            .set('Authorization', `Bearer ${tutorToken}`)
            .send({ credits: 2 });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/below 5 credits/i);
    });

    test('Credit Purchase Cap: Student with 0 credits cannot buy > 10 credits', async () => {
        const res = await request(app)
            .post('/api/credits/buy-mock')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({ credits: 11 });

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/between 1 and 10|at most 10 credit/i);
    });

    test('Credit Purchase Success: Student with 0 credits buys 5 credits', async () => {
        const res = await request(app)
            .post('/api/credits/buy-mock')
            .set('Authorization', `Bearer ${studentToken}`)
            .send({ credits: 5 });

        expect(res.statusCode).toBe(201);
        expect(res.body.new_balance).toBe(5);

        // Verify purchase transaction
        const pTx = await pool.query(
            `SELECT * FROM transactions WHERE receiver_id = $1 AND transaction_type = 'purchase'`,
            [studentId]
        );
        expect(pTx.rows.length).toBe(1);
        expect(pTx.rows[0].amount).toBe(5);
    });
});

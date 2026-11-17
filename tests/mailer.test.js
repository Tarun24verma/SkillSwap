jest.mock('nodemailer', () => ({
    createTransport: jest.fn()
}));

const originalSmtpUser = process.env.SMTP_USER;
const originalSmtpAppPassword = process.env.SMTP_APP_PASSWORD;

afterEach(() => {
    if (originalSmtpUser === undefined) {
        delete process.env.SMTP_USER;
    } else {
        process.env.SMTP_USER = originalSmtpUser;
    }

    if (originalSmtpAppPassword === undefined) {
        delete process.env.SMTP_APP_PASSWORD;
    } else {
        process.env.SMTP_APP_PASSWORD = originalSmtpAppPassword;
    }
});

test('sends verification emails through Gmail SMTP with an app password', async () => {
    process.env.SMTP_USER = 'skillswap@example.com';
    process.env.SMTP_APP_PASSWORD = 'abcd efgh ijkl mnop';
    jest.resetModules();

    const nodemailer = require('nodemailer');
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-message-id' });
    nodemailer.createTransport.mockReturnValue({ sendMail });

    const { sendOtpEmail } = require('../utils/mailer');
    const result = await sendOtpEmail('student@example.com', 'Test Student', '123456');

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: 'skillswap@example.com',
            pass: 'abcdefghijklmnop'
        }
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: 'SkillSwap <skillswap@example.com>',
        to: 'student@example.com',
        subject: expect.stringContaining('123456'),
        html: expect.stringContaining('123456')
    }));
    expect(result.messageId).toBe('test-message-id');
});

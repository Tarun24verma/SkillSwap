const { Resend } = require('resend');
require('dotenv').config();

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Send 6-digit verification OTP email using Resend
 * @param {string} toEmail 
 * @param {string} name 
 * @param {string} otp 
 */
exports.sendOtpEmail = async (toEmail, name, otp) => {
    // Always print in console as well for easy developer testing
    console.log('\n======================================================');
    console.log(`🔑 OTP Code for ${name} (${toEmail}): [ ${otp} ]`);
    console.log('======================================================\n');

    if (!resend) {
        console.warn('⚠️ No RESEND_API_KEY found in .env; email was not sent externally.');
        return { devMode: true };
    }

    try {
        const { data, error } = await resend.emails.send({
            from: 'SkillSwap <onboarding@resend.dev>',
            to: [toEmail],
            subject: `⚡ SkillSwap Verification Code: ${otp}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #4f46e5; margin: 0;">⚡ SkillSwap</h2>
                        <p style="color: #64748b; font-size: 14px; margin-top: 4px;">University Peer Tutoring & Time Banking</p>
                    </div>
                    <div style="padding: 24px; background-color: #f8fafc; border-radius: 8px; text-align: center;">
                        <p style="color: #334155; font-size: 16px; margin-bottom: 12px;">Hello <strong>${name}</strong>,</p>
                        <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">Use the following 6-digit verification code to complete your registration and claim your <strong>5 free SkillCredits</strong>:</p>
                        <div style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5; background: #ffffff; padding: 12px 24px; border-radius: 8px; border: 2px dashed #4f46e5;">
                            ${otp}
                        </div>
                        <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
                    </div>
                    <div style="text-align: center; margin-top: 24px; color: #94a3b8; font-size: 12px;">
                        SkillSwap Academic Platform &bull; Automated System Message
                    </div>
                </div>
            `
        });

        if (error) {
            console.error('Resend API error:', error);
            // Note: On Resend's free tier with onboarding@resend.dev, 
            // you can send to your own account email until a custom domain is verified.
        } else {
            console.log('✓ Resend email dispatched successfully, id:', data.id);
        }

        return { data, error };
    } catch (err) {
        console.error('Failed to dispatch email via Resend:', err);
        return { error: err.message };
    }
};

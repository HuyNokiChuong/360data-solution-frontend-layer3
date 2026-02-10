
import { Resend } from 'resend';

// NOTE: Ensure your RESEND_API_KEY is set in .env
const resend = new Resend(process.env.RESEND_API_KEY);

export const emailService = {
    /**
     * Send verification code for registration
     * Limit to corporate users only
     */
    sendVerificationCode: async (email: string, code: string, name: string) => {
        try {
            // --- DEVELOPMENT MODE ---
            // Always log the code to console so we can test without a real email provider
            console.log('\n=================================================');
            console.log(`🔐 [DEV VERIFICATION] To: ${email} | Code: ${code}`);
            console.log('=================================================\n');

            // If no API key is set, we just simulate success
            if (!process.env.RESEND_API_KEY) {
                console.warn('⚠️ No RESEND_API_KEY found. Email sending skipped (simulated success).');
                return true;
            }

            // Validate domain (Basic check, though Auth route should handle it too)
            const publicDomains = [
                'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'
            ];
            const domain = email.split('@')[1].toLowerCase();
            if (publicDomains.includes(domain)) {
                throw new Error('Public email domains are not allowed for registration.');
            }

            const { data, error } = await resend.emails.send({
                from: '360data <onboarding@resend.dev>', // Use verified domain internally later
                to: [email],
                subject: `Verify your 360data Workspace Access`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                        <h2 style="color: #4f46e5; text-align: center;">Welcome to 360data-solutions, ${name}!</h2>
                        <p style="color: #64748b; font-size: 16px; line-height: 1.5;">
                            You are one step away from setting up your corporate data workspace.
                        </p>
                        
                        <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-radius: 8px; margin: 30px 0;">
                            <span style="font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #64748b; display: block; margin-bottom: 10px;">Your Verification Code</span>
                            <span style="font-size: 32px; font-weight: bold; color: #0f172a; letter-spacing: 5px;">${code}</span>
                        </div>

                        <p style="color: #64748b; font-size: 14px; text-align: center;">
                            This code will expire in 10 minutes. <br/>
                            If you did not request this, please ignore this email.
                        </p>
                        
                        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
                        
                        <p style="color: #94a3b8; font-size: 12px; text-align: center;">
                            © ${new Date().getFullYear()} 360data-solutions. AI-Powered Data Intelligence.
                        </p>
                    </div>
                `
            });

            if (error) {
                console.error('Resend Error:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Email Dispatch Error:', error);
            return false;
        }
    }
};

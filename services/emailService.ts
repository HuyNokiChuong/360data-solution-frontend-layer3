
/**
 * Email Service for 360data-solutions
 * 
 * Note: For production, integrate with a real provider like Resend, SendGrid, or AWS SES.
 * This mock simulates the behavior of an asynchronous email dispatch system.
 */

export const emailService = {
    /**
     * Sends a security verification code to the target email.
     */
    sendVerificationCode: async (email: string, code: string): Promise<boolean> => {
        console.log(`%c📧 EMAIL DISPATCH SYSTEM`, 'background: #4f46e5; color: white; padding: 2px 5px; border-radius: 3px;', `Sending code [${code}] to ${email}`);

        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 1500));

        // In a real implementation, you would make an API call here:
        /*
        const response = await fetch('https://api.your-backend.com/send-email', {
            method: 'POST',
            body: JSON.stringify({ email, code, type: 'VERIFICATION' })
        });
        return response.ok;
        */

        return true;
    }
};

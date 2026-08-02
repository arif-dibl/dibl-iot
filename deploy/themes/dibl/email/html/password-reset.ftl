<html>
<body>
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>DIBL IOT - Password Reset</h2>
    <p>Hello,</p>
    <p>Someone just requested to change your password for the DIBL IOT platform. If this was you, click on the link below to reset it.</p>
    
    <p style="text-align: center; margin: 30px 0;">
        <a href="${link?replace('auth/realms/[^/]+/login-actions/action-token', 'reset-action', 'r')}" 
           style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Reset Password
        </a>
    </p>

    <p>This link will expire in ${linkExpiration} minutes.</p>
    <p>If you don't want to reset your password, just ignore this email and nothing will be changed.</p>
</div>
</body>
</html>

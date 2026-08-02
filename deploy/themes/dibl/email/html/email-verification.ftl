<html>
<body>
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>DIBL IOT - Verify Email</h2>
    <p>Hello,</p>
    <p>Someone has created an account in the DIBL IOT platform with this email address. If this was you, click the link below to verify your email address and complete the registration.</p>
    
    <p style="text-align: center; margin: 30px 0;">
        <a href="${link?replace('auth/realms/master/login-actions/action-token', 'verify-action')}" 
           style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Verify Email
        </a>
    </p>

    <p>This link will expire in ${linkExpiration} minutes.</p>
    <p>If you didn't create this account, just ignore this message.</p>
</div>
</body>
</html>

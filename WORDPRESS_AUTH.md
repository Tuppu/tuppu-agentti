# WordPress Authentication Setup Guide

## Problem
Your WordPress credentials are not working. The error "Et ole kirjautunut sisään" (Not logged in) indicates authentication failure.

## Solution Options

### Option 1: Create Application Password (Recommended)

Application Passwords are the secure way to authenticate with WordPress REST API:

1. **Log in to WordPress admin** (https://tuppu.fi/wp-admin)

2. **Go to your profile**:
   - Click on your username in the top right
   - Or go to: Users → Profile

3. **Scroll to "Application Passwords" section**

4. **Create new application password**:
   - Name: `Tuppu Agent`
   - Click "Add New Application Password"
   - **Copy the generated password** (it will look like: `xxxx xxxx xxxx xxxx xxxx xxxx`)

5. **Update your `.env` file**:
   ```bash
   WP_USERNAME=your_wordpress_username
   WP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
   ```
   (Use the application password, not your regular password)

6. **Restart your server**

### Option 2: Enable Basic Authentication Plugin

If Application Passwords don't work, you may need a plugin:

1. **Install** [Application Passwords plugin](https://wordpress.org/plugins/application-passwords/) or [Basic Auth plugin](https://github.com/WP-API/Basic-Auth)

2. **For Basic Auth** (development only - not recommended for production):
   ```bash
   # Download and install
   cd wp-content/plugins
   git clone https://github.com/WP-API/Basic-Auth.git basic-auth
   ```

3. **Activate the plugin** in WordPress admin

4. **Update .env** with your regular WordPress credentials

### Option 3: Use JWT Authentication

For more secure authentication:

1. **Install** [JWT Authentication plugin](https://wordpress.org/plugins/jwt-authentication-for-wp-rest-api/)

2. **Configure** the plugin

3. **Update code** to use JWT tokens instead of Basic Auth

## Testing Your Credentials

After setting up credentials, test them:

```bash
# Via web browser
http://localhost:3000/test-wordpress

# Via PowerShell
curl http://localhost:3000/test-wordpress
```

Successful response:
```json
{
  "success": true,
  "user": {
    "id": 1,
    "name": "Your Name",
    "username": "yourusername",
    "capabilities": {...}
  }
}
```

## Common Issues

### Issue: "rest_not_logged_in"
**Solution**: Use Application Password instead of regular password

### Issue: "rest_cannot_create"
**Solution**: Your user needs `publish_posts` capability
- Check: Users → Your User → Role
- Ensure role is "Editor" or "Administrator"

### Issue: "Application Passwords not available"
**Solutions**:
- Update WordPress to 5.6+
- Install Application Passwords plugin
- Check if HTTPS is enabled (required for Application Passwords)

### Issue: Still not working
**Alternative**: Use WordPress XML-RPC API instead
- Check if XML-RPC is enabled: https://tuppu.fi/xmlrpc.php
- Or use a plugin like "WP REST API - OAuth 1.0a Server"

## Current Setup Check

Your current `.env` configuration:
- Username: `tuppu-agentti`
- Password: `*hidden*`

**Action needed**: 
1. Verify this username exists in WordPress
2. Create an Application Password for this user
3. Update the `.env` file with the Application Password

## WordPress Version Check

Application Passwords require:
- WordPress 5.6 or higher
- HTTPS enabled (or local development environment)

Check your version: https://tuppu.fi/wp-admin/

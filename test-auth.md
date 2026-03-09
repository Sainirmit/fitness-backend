# Firebase Authentication Testing Guide

## Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your Firebase credentials:
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate new private key"
   - Download the JSON file and copy the values to your `.env`

## Firebase Console Setup

### Enable Authentication Providers:
1. Go to Firebase Console → Authentication → Sign-in method
2. Enable **Google** provider
3. Enable **Apple** provider (requires Apple Developer account)

### For Apple Sign-In:
1. You need an Apple Developer account ($99/year)
2. Create App ID with "Sign In with Apple" capability
3. Create Service ID
4. Generate private key in Apple Developer Portal
5. Add Team ID, Key ID, and private key to Firebase Apple provider settings

## Testing Steps

### 1. Start Your Server
```bash
npm install
npm start
```

### 2. Test Google Sign-In

#### Frontend Testing (HTML):
```html
<!DOCTYPE html>
<html>
<head>
    <title>Test Firebase Auth</title>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-auth-compat.js"></script>
</head>
<body>
    <button onclick="testGoogle()">Test Google Sign-In</button>
    <button onclick="testApple()">Test Apple Sign-In</button>
    <div id="result"></div>

    <script>
        // Initialize Firebase (use your config)
        const firebaseConfig = {
            apiKey: "your-api-key",
            authDomain: "your-project.firebaseapp.com",
            projectId: "your-project-id",
            appId: "your-app-id"
        };
        firebase.initializeApp(firebaseConfig);

        async function testGoogle() {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                const result = await firebase.auth().signInWithPopup(provider);
                const idToken = await result.user.getIdToken();
                
                const response = await fetch('/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken })
                });
                
                const data = await response.json();
                document.getElementById('result').innerHTML = JSON.stringify(data, null, 2);
                console.log('Success:', data);
            } catch (error) {
                console.error('Error:', error);
                document.getElementById('result').innerHTML = 'Error: ' + error.message;
            }
        }

        async function testApple() {
            try {
                const provider = new firebase.auth.OAuthProvider('apple.com');
                const result = await firebase.auth().signInWithPopup(provider);
                const idToken = await result.user.getIdToken();
                
                const response = await fetch('/api/auth/apple', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        idToken,
                        user: result.user.providerData[0] // Contains name on first sign-in
                    })
                });
                
                const data = await response.json();
                document.getElementById('result').innerHTML = JSON.stringify(data, null, 2);
                console.log('Success:', data);
            } catch (error) {
                console.error('Error:', error);
                document.getElementById('result').innerHTML = 'Error: ' + error.message;
            }
        }
    </script>
</body>
</html>
```

#### Backend Testing (cURL):
```bash
# Test Google Sign-In (you need a real Google ID token)
curl -X POST http://localhost:3000/api/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken":"YOUR_GOOGLE_ID_TOKEN"}'

# Test Apple Sign-In (you need a real Apple ID token)
curl -X POST http://localhost:3000/api/auth/apple \
  -H "Content-Type: application/json" \
  -d '{"idToken":"YOUR_APPLE_ID_TOKEN","user":{"name":{"firstName":"John","lastName":"Doe"}}}'
```

### 3. Test Protected Routes

After getting your `accessToken`:
```bash
# Test a protected route
curl -X GET http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Common Issues & Solutions

### Firebase Token Verification Errors:
- **"Firebase token verification failed"**: Check your Firebase credentials in `.env`
- **"Missing Firebase credentials"**: Ensure all Firebase env variables are set
- **"Invalid token"**: Token might be expired, get a fresh one from Firebase

### Apple Sign-In Issues:
- **"Apple provider not enabled"**: Enable Apple provider in Firebase Console
- **"Missing Apple Developer account"**: You need an Apple Developer account
- **"Invalid Apple token"**: Check your Apple Developer configuration

### Database Issues:
- **"MongoDB connection failed"**: Ensure MongoDB is running and URI is correct
- **"User already exists"**: Try with a different email address

## Testing Checklist

- [ ] Server starts without errors
- [ ] Environment variables are loaded
- [ ] Firebase Admin SDK initializes successfully
- [ ] MongoDB connection works
- [ ] Google sign-in creates/returns user
- [ ] Apple sign-in creates/returns user (if configured)
- [ ] JWT tokens are generated
- [ ] Protected routes work with valid tokens
- [ ] Invalid tokens are rejected

## Production Considerations

1. **Environment Variables**: Never commit `.env` file
2. **Firebase Security**: Restrict Firebase rules in production
3. **JWT Security**: Use strong `JWT_SECRET` in production
4. **Domain Whitelisting**: Add your domain to Firebase authorized domains
5. **HTTPS**: Always use HTTPS in production for auth endpoints

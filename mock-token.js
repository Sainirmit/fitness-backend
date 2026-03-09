// Generate a mock Firebase ID token for testing
// This simulates what Firebase would return after successful sign-in

const mockFirebaseToken = {
  // This is a decoded token structure (what your backend expects after verification)
  decoded: {
    uid: "mock-user-12345",
    email: "test@example.com", 
    name: "Test User",
    picture: "https://example.com/avatar.jpg",
    email_verified: true,
    aud: "your-firebase-project-id",
    iss: "https://securetoken.google.com/your-firebase-project-id",
    iat: 1640995200,
    exp: 1640998800
  }
};

// For Postman testing, you need a REAL Firebase ID token
// To get one:
// 1. Go to Firebase Console → Authentication → Sign-in method
// 2. Enable Google provider
// 3. Use the test.html file above to get a real token
// 4. Copy that token to Postman

console.log("For testing, use test.html to get a real Firebase ID token");
console.log("Then in Postman:");
console.log("POST http://localhost:3000/api/auth/google");
console.log("Headers: Content-Type: application/json");
console.log('Body: {"idToken": "paste-real-token-here"}');

/**
 * Validation middleware for authentication endpoints
 */

export const validateGoogleLogin = (req, res, next) => {
  const { idToken } = req.body;
  
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ 
      message: 'idToken (string) is required in the request body.' 
    });
  }
  
  next();
};

export const validateAppleLogin = (req, res, next) => {
  const { idToken } = req.body;
  
  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ 
      message: 'idToken (string) is required in the request body.' 
    });
  }
  
  // Apple user info is optional and only provided on first sign-in
  const { user } = req.body;
  if (user && typeof user !== 'object') {
    return res.status(400).json({ 
      message: 'user field must be an object when provided.' 
    });
  }
  
  next();
};

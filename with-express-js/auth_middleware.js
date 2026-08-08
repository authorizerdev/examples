const { Authorizer } = require('@authorizerdev/authorizer-js');

const authorizerURL = 'https://demo.authorizer.dev';

const authRef = new Authorizer({
  authorizerURL,
  redirectURL: `${authorizerURL}/app`,
  clientID: '96fed66c-9779-4694-a79a-260fc489ce33',
  // The server's CSRF guard rejects any state-changing request without an
  // Origin (or Referer) header, and POST /graphql — which the SDK uses for
  // validateJWTToken — is state-changing. A browser sets Origin itself, but
  // this middleware runs in Node, where nothing does, so send it explicitly.
  // The server's own origin always passes.
  extraHeaders: { Origin: authorizerURL },
});

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(403).json({ error: 'Authorization not found' });
  }

  const splitHeader = authHeader.split(' ');
  if (splitHeader.length != 2) {
    return res.status(403).json({ error: 'Invalid auth header' });
  }

  if (splitHeader[0].toLowerCase() != 'bearer') {
    return res.status(403).json({ error: 'Bearer token not found' });
  }

  const token = splitHeader[1];
  // Validate jwt token via authorizer sdk
  try {
    const { data, errors } = await authRef.validateJWTToken({
      token,
      token_type: 'id_token', // This can be access_token, refresh_token
      // roles: [user] // specify roles that you want to validate jwt for, by default it will just verify jwt.
    });
    if (errors.length) {
      throw new Error(errors[0].message);
    }
    if (!data?.is_valid) {
      throw new Error('Invalid token');
    }
    req.user = data.claims;
  } catch (err) {
    console.error(err);
    return res.status(403).json({ error: 'Invalid JWT token' });
  }

  next();
};

module.exports = authMiddleware;

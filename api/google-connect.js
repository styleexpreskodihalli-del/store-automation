export default function handler(req, res) {

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: 'Google OAuth environment variables are not configured'
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/business.manage'
  });

  res.redirect(
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    params.toString()
  );
}

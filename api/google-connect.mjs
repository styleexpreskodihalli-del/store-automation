export default {
  async fetch(request) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return new Response(
        JSON.stringify({
          error: "Google OAuth environment variables are not configured"
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/business.manage"
    });

    return Response.redirect(
      "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
      302
    );
  }
};

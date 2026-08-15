export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        return new Response(
          `<h2>Google authorization failed</h2><p>${escapeHtml(error)}</p>`,
          {
            status: 400,
            headers: { "content-type": "text/html; charset=utf-8" }
          }
        );
      }

      if (!code) {
        return new Response(
          "<h2>Missing Google authorization code.</h2>",
          {
            status: 400,
            headers: { "content-type": "text/html; charset=utf-8" }
          }
        );
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        return new Response(
          JSON.stringify({
            error: "Google OAuth environment variables are not configured"
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code"
          })
        }
      );

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("Google token exchange failed:", tokenData);

        return new Response(
          `<h2>Google connection failed</h2><p>Token exchange was rejected by Google.</p>`,
          {
            status: 400,
            headers: { "content-type": "text/html; charset=utf-8" }
          }
        );
      }

      console.log("Google OAuth successful");
      console.log("Scope:", tokenData.scope);
      console.log("Has access token:", !!tokenData.access_token);
      console.log("Has refresh token:", !!tokenData.refresh_token);

      return new Response(
        `<html>
          <head>
            <title>Google Business Connected</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>✅ Google Business connected</h2>
            <p>Google authorization was successful.</p>
            <p>You can close this window and return to STore Automation.</p>
          </body>
        </html>`,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );

    } catch (err) {
      console.error("Google callback error:", err);

      return new Response(
        "<h2>Google connection failed</h2><p>Unexpected server error.</p>",
        {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" }
        }
      );
    }
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

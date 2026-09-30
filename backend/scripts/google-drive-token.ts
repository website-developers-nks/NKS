import 'dotenv/config';
import { createServer } from 'http';

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const port = Number(process.env.GOOGLE_OAUTH_PORT ?? 53682);
const redirectUri = `http://localhost:${port}/oauth2callback`;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive',
  access_type: 'offline',
  prompt: 'consent',
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(`Authorisation failed: ${url.searchParams.get('error') ?? 'no code'}`);
    server.close();
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  const body = await tokenRes.json() as { refresh_token?: string; error_description?: string; error?: string };

  if (!body.refresh_token) {
    res.writeHead(400).end('No refresh token returned. Check the terminal.');
    console.error('Token exchange failed:', body.error_description || body.error || body);
  } else {
    res.writeHead(200).end('Done. You can close this tab and go back to the terminal.');
    console.log(`\nAdd this to backend/.env:\n\nGOOGLE_DRIVE_REFRESH_TOKEN=${body.refresh_token}\n`);
  }
  server.close();
});

server.listen(port, () => {
  console.log(`Open this URL and sign in with the Google account that owns the Drive folders:\n\n${authUrl}\n`);
});

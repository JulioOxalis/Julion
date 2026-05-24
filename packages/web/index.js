const express = require('express');
const path = require('path');
const session = require('express-session');
const { google } = require('googleapis');
const {
  loadMergedEnv,
  loadGoogleClientConfig,
  GOOGLE_DRIVE_SCOPES,
  resolvePublicBaseUrl,
  createAuthSession,
  completeAuthSession,
  claimAuthSession,
  getAuthSessionStatus,
  upsertUser,
  saveUserDriveToken,
  deleteUserDriveToken,
  loadUserDriveToken,
  getDbConnection
} = require('julion-shared');

const app = express();
const port = Number(process.env.PORT || 3000);
let cachedEnv = null;

async function getEnv() {
  if (!cachedEnv) {
    cachedEnv = await loadMergedEnv(path.join(__dirname, '..', '..'));
  }
  return cachedEnv;
}

function requireLogin(req, res, next) {
  if (!req.session?.user?.email) {
    return res.redirect('/auth/google');
  }
  return next();
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} · JULION</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="app-shell">
    ${body}
  </div>
</body>
</html>`;
}

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'julion-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

app.get('/api/auth/session/:sessionId', async (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId || sessionId.length > 64) {
    return res.status(400).json({ status: 'invalid', message: 'Invalid session id.' });
  }

  const projectRoot = path.join(__dirname, '..', '..');
  try {
    const status = await getAuthSessionStatus(sessionId, projectRoot);
    if (status === 'pending') {
      return res.status(202).json({ status: 'pending' });
    }
    if (status === 'complete') {
      const claimed = await claimAuthSession(sessionId, projectRoot);
      if (!claimed) {
        return res.status(202).json({ status: 'pending' });
      }
      return res.json({
        status: 'complete',
        sessionId: claimed.sessionId,
        token: claimed.token,
        user_email: claimed.user_email,
        user_name: claimed.user_name,
        user_picture: claimed.user_picture
      });
    }
    if (status === 'claimed') {
      return res.status(410).json({ status: 'claimed', message: 'Session already used.' });
    }
    return res.status(404).json({ status: status === 'expired' ? 'expired' : 'missing' });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Auth session lookup failed.'
    });
  }
});

app.get('/api/status', async (req, res) => {
  const env = await getEnv();
  let database = 'not_configured';
  try {
    const connection = await getDbConnection(path.join(__dirname, '..', '..'));
    await connection.ping();
    await connection.end();
    database = 'connected';
  } catch (error) {
    database = error instanceof Error ? error.message : 'error';
  }

  res.json({
    name: 'JULION Web',
    status: 'ready',
    baseUrl: resolvePublicBaseUrl(env),
    database,
    loggedIn: Boolean(req.session?.user?.email)
  });
});

app.get('/', async (req, res) => {
  if (req.session?.user?.email) {
    return res.redirect('/dashboard');
  }

  const env = await getEnv();
  const baseUrl = resolvePublicBaseUrl(env);
  res.send(
    layout(
      'Home',
      `
      <header class="app-header">
        <div>
          <p class="eyebrow">JULION</p>
          <h1>Sign in to connect Google Drive</h1>
          <p class="lead">Log in here, then run Julion commands in VS Code to snapshot and upload your project.</p>
        </div>
      </header>
      <main>
        <section class="card card-primary">
          <h2>Get started</h2>
          <p>Use the website login when the CLI opens your browser, or sign in manually below.</p>
          <div class="button-row">
            <a class="button" href="/auth/google">Sign in with Google</a>
          </div>
        </section>
        <section class="card card-secondary">
          <h2>VS Code flow</h2>
          <pre class="code-block">julion auth google --website
julion save --ultra --push --repository my-repo</pre>
          <p class="status-text">Site URL: ${baseUrl}</p>
        </section>
      </main>
      <footer class="app-footer"><p>JULION · ${baseUrl}</p></footer>
      `
    )
  );
});

app.get('/dashboard', requireLogin, async (req, res) => {
  const user = req.session.user;
  let driveConnected = false;
  try {
    const token = await loadUserDriveToken(user.email, path.join(__dirname, '..', '..'));
    driveConnected = Boolean(token?.access_token || token?.refresh_token);
  } catch {
    driveConnected = false;
  }

  res.send(
    layout(
      'Dashboard',
      `
      <header class="app-header">
        <div>
          <p class="eyebrow">JULION</p>
          <h1>Dashboard</h1>
          <p class="lead">You are signed in and ready for CLI uploads.</p>
        </div>
      </header>
      <main>
        <section class="card card-primary">
          <div class="profile-row">
            ${
              user.picture
                ? `<img class="avatar" src="${user.picture}" alt="" width="56" height="56" />`
                : '<div class="avatar avatar-fallback">J</div>'
            }
            <div>
              <h2>${user.name || user.email}</h2>
              <p class="status-text">${user.email}</p>
            </div>
          </div>
          <p><strong>Google Drive:</strong> ${driveConnected ? 'Connected' : 'Not connected yet'}</p>
          ${
            !driveConnected
              ? '<div class="button-row"><a class="button" href="/auth/google">Connect Google Drive</a></div>'
              : ''
          }
        </section>
        <section class="card card-secondary">
          <h2>Next in VS Code</h2>
          <pre class="code-block">julion save --ultra --push --repository my-repo
julion pull my-repo my-project.on -o downloaded.on</pre>
        </section>
        <section class="card card-secondary">
          <form method="post" action="/logout">
            <button class="button button-secondary" type="submit">Log out</button>
          </form>
        </section>
      </main>
      `
    )
  );
});

app.post('/logout', requireLogin, async (req, res) => {
  const email = req.session.user.email;
  try {
    await deleteUserDriveToken(email, path.join(__dirname, '..', '..'));
  } catch {
    // ignore db errors on logout
  }
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/auth/google', async (req, res) => {
  const env = await getEnv();
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig(path.join(__dirname, '..', '..'));
  const cliSession = typeof req.query.session === 'string' ? req.query.session.trim() : '';

  if (cliSession) {
    await createAuthSession(cliSession, path.join(__dirname, '..', '..'));
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const statePayload = {
    cliSession: cliSession || null,
    siteLogin: !cliSession
  };

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_DRIVE_SCOPES,
    prompt: 'consent',
    state: Buffer.from(JSON.stringify(statePayload)).toString('base64url')
  });

  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code) {
    return res.status(400).send(layout('Login failed', '<main><section class="card card-primary"><h2>Missing authorization code</h2></section></main>'));
  }

  let statePayload = { cliSession: null, siteLogin: true };
  if (stateRaw) {
    try {
      statePayload = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    } catch {
      // keep defaults
    }
  }

  const projectRoot = path.join(__dirname, '..', '..');
  const { clientId, clientSecret, redirectUri } = await loadGoogleClientConfig(projectRoot);
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const tokenResponse = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokenResponse.tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const profile = await oauth2.userinfo.get();
  const email = profile.data.email;
  const name = profile.data.name || email;
  const picture = profile.data.picture || undefined;

  if (!email) {
    return res.status(400).send(layout('Login failed', '<main><section class="card card-primary"><h2>Google did not return an email address.</h2></section></main>'));
  }

  const user = { email, name, picture };
  await upsertUser(user, projectRoot);

  if (statePayload.cliSession) {
    await completeAuthSession(statePayload.cliSession, tokenResponse.tokens, user, projectRoot);
    return res.redirect(`/auth/complete?session=${encodeURIComponent(statePayload.cliSession)}`);
  }

  await saveUserDriveToken(email, tokenResponse.tokens, projectRoot);
  req.session.user = user;
  return res.redirect('/dashboard');
});

app.get('/auth/complete', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth-complete.html'));
});

app.get('/auth-google', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(`/auth/google${query}`);
});

app.listen(port, async () => {
  const env = await getEnv();
  const baseUrl = resolvePublicBaseUrl(env);
  console.log(`Julion web running at ${baseUrl}`);
  console.log(`Local: http://localhost:${port}`);
  console.log(`Google callback: ${env.GOOGLE_REDIRECT_URI || baseUrl + '/auth/google/callback'}`);
});

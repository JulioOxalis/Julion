const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    name: 'JULION Web UI',
    status: 'ready',
    ui: 'local-preview',
    support: ['login', 'snapshot', 'drive', 'help']
  });
});

app.get('/auth-google', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth-google.html'));
});

app.listen(port, () => {
  console.log(`Julion web UI available at http://localhost:${port}`);
});

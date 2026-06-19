import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT ?? 4273);
const appName = 'Maintenance Command Center';
const version = '0.1.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistPath = path.resolve(__dirname, '../../../frontend/dist');

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    app: appName,
    port,
  });
});

app.get('/api/version', (_request, response) => {
  response.json({
    app: appName,
    version,
    environment: process.env.NODE_ENV ?? 'local',
  });
});

app.use(express.static(frontendDistPath));

app.get('*', (_request, response) => {
  response.sendFile(path.join(frontendDistPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`${appName} running at http://localhost:${port}`);
});

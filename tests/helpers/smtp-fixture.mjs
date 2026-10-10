import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { root } from './security-process.mjs';

// Public test-only certificate/key; never use this fixture for deployed services.
export const certPath = path.join(root, 'tests/fixtures/smtp-local-test-cert.pem');
const credentials = { user: 'smtp-fixture', pass: 'Dummy-SMTP-Only!9' };
export { credentials };

export async function smtpFixture({ implicitTLS = false, startTLS = true, rejectAuth = false } = {}) {
  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(path.join(root, 'tests/fixtures/smtp-local-test-key.pem'));
  const secureContext = tls.createSecureContext({ key, cert });
  const sockets = new Set();
  const servers = [];
  let closing;
  function track(socket) {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    if (closing) socket.destroy();
  }
  function close() {
    return closing ??= (async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map(server => new Promise((resolve, reject) => {
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      })));
    })();
  }
  function createServer() {
    const server = implicitTLS ? tls.createServer({ key, cert }, accept) : net.createServer(accept);
    servers.push(server);
    // Include raw TLS connections that have not completed their handshake.
    server.on('connection', track);
    server.on('tlsClientError', () => {});
    return server;
  }
  function listen(server, port, host) {
    return new Promise((resolve, reject) => {
      function removeListeners() { server.removeListener('error', failed); server.removeListener('listening', ready); }
      function failed(error) { removeListeners(); reject(error); }
      function ready() { removeListeners(); resolve(); }
      server.once('error', failed);
      server.once('listening', ready);
      try { server.listen(port, host); } catch (error) { failed(error); }
    });
  }
  const messages = [];
  const authentications = [];
  const recipients = [];
  function bind(socket, session) {
    track(socket);
    let buffer = '';
    function reply(text) { socket.write(text + '\r\n'); }
    function authenticated(user, pass) {
      const accepted = !rejectAuth && user === credentials.user && pass === credentials.pass;
      authentications.push({ accepted, encrypted: session.encrypted });
      session.authenticated = accepted;
      reply(accepted ? '235 2.7.0 Authenticated' : '535 5.7.8 Authentication failed');
    }
    function line(value) {
      if (session.data) {
        if (value === '.') {
          messages.push({ from: session.from, to: [...session.to], text: session.lines.join('\r\n'), encrypted: session.encrypted });
          session.data = false; reply('250 2.0.0 Stored locally');
        } else session.lines.push(value.replace(/^\.\./, '.'));
        return;
      }
      if (session.authStage === 'user') {
        session.user = Buffer.from(value, 'base64').toString(); session.authStage = 'pass'; reply('334 UGFzc3dvcmQ6'); return;
      }
      if (session.authStage === 'pass') {
        session.authStage = ''; authenticated(session.user, Buffer.from(value, 'base64').toString()); return;
      }
      const verb = value.split(' ', 1)[0].toUpperCase();
      if (verb === 'EHLO' || verb === 'HELO') {
        reply('250-localhost\r\n250-SMTPUTF8\r\n' + (startTLS && !session.encrypted ? '250-STARTTLS\r\n' : '') + '250 AUTH PLAIN LOGIN');
      } else if (verb === 'STARTTLS' && startTLS && !session.encrypted) {
        reply('220 2.0.0 Begin TLS');
        socket.removeListener('data', data);
        const secured = new tls.TLSSocket(socket, { isServer: true, secureContext });
        session.encrypted = true; bind(secured, session);
      } else if (verb === 'STARTTLS') { reply('454 4.7.0 STARTTLS unavailable');
      } else if (verb === 'AUTH') {
        const [, method, encoded] = value.split(' ');
        if (method === 'PLAIN') {
          const [, user, pass] = Buffer.from(encoded || '', 'base64').toString().split('\0'); authenticated(user, pass);
        } else if (method === 'LOGIN') { session.authStage = 'user'; reply('334 VXNlcm5hbWU6'); }
        else reply('504 5.5.4 Unsupported authentication');
      } else if (verb === 'MAIL') {
        if (!session.authenticated) return reply('530 5.7.0 Authentication required');
        session.from = value.match(/FROM:<([^>]*)>/i)?.[1]; session.to = []; reply('250 2.1.0 Sender accepted');
      } else if (verb === 'RCPT') {
        const recipient = value.match(/TO:<([^>]*)>/i)?.[1] || '';
        recipients.push(recipient);
        if (!/^[^\s<>@(),]+@[^\s<>@(),]+\.[^\s<>@(),]+$/u.test(recipient)) return reply('553 5.1.3 Invalid mailbox');
        session.to.push(recipient); reply('250 2.1.5 Recipient accepted');
      } else if (verb === 'DATA') {
        if (!session.to.length) return reply('554 5.5.1 No recipient');
        session.data = true; session.lines = []; reply('354 End with a dot');
      } else if (verb === 'QUIT') { reply('221 Bye'); socket.end(); }
      else if (verb === 'RSET') { session.to = []; reply('250 Reset'); }
      else reply('250 OK');
    }
    function data(chunk) {
      buffer += chunk.toString();
      assert.ok(buffer.length < 128 * 1024, 'Local SMTP fixture limits input size.');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const value = buffer.slice(0, end); buffer = buffer.slice(end + 2); line(value);
      }
    }
    socket.on('data', data);
  }
  function accept(socket) {
    bind(socket, { encrypted: implicitTLS, authenticated: false, to: [] });
    socket.write('220 localhost Local-only SMTP test fixture\r\n');
  }
  try {
    const server = createServer();
    await listen(server, 0, '127.0.0.1');
    const port = server.address().port;
    // Nodemailer's localhost DNS cache can select either loopback address.
    if (implicitTLS) await listen(createServer(), port, '::1');
    return { port, messages, authentications, recipients, cert,
      env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: credentials.user,
        SMTP_PASS: credentials.pass, SMTP_FROM: 'mcc@example.test', NODE_EXTRA_CA_CERTS: certPath },
      close,
    };
  } catch (error) { await close(); throw error; }
}

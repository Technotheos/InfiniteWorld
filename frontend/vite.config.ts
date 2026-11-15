import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Adds a Content-Security-Policy <meta> tag to the PRODUCTION build (the dev
 * server needs inline scripts for hot reload, so it is left alone).
 *
 * The policy is the main defence in depth against XSS: even if an injection bug
 * slipped in, the browser would refuse to run inline scripts, load scripts from
 * other sites, or send data to hosts that are not listed here.
 *
 * `frame-ancestors` cannot be set from a <meta> tag: send it as an HTTP header
 * from your web server (see SECURITY.md).
 */
function contentSecurityPolicy(apiUrl: string, wsUrl: string): Plugin {
  const origin = (u: string) => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  };
  const api = origin(apiUrl);
  const ws = origin(wsUrl.replace(/^ws/, 'http')).replace(/^http/, 'ws');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // inline styles come from Tailwind/animations
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${api}`.trim(), // avatars are served by the API
    `connect-src 'self' ${api} ${ws}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

  return {
    name: 'inject-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const apiUrl = env.VITE_API_URL || 'http://localhost:8080';
  const wsUrl = env.VITE_WS_URL || apiUrl.replace(/^http/, 'ws');
  return {
    plugins: [react(), contentSecurityPolicy(apiUrl, wsUrl)],
    server: {
      port: 5173,
      open: true,
    },
  };
});
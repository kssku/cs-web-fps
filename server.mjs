/* =========================================================================
   cs-web-fps 静态文件服务器 —— 零依赖，仅用 Node 原生 http/fs
   用途：本地起服务，避免 file:// 下 importmap / ES 模块的 CORS 限制
   用法：node server.mjs [port]   或   pnpm start
   ========================================================================= */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

/** 扩展名 -> MIME。ES 模块必须带正确 Content-Type，否则浏览器拒绝执行 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** 把 URL 路径安全地映射到 ROOT 内的绝对路径，越界返回 null */
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  if (rel.split(/[/\\]/).includes('..')) return null;
  const abs = join(ROOT, rel);
  if (abs !== ROOT.replace(/[/\\]$/, '') && !abs.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    return null;
  }
  return abs;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let target = resolveSafe(req.url || '/');
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(target);
    // 目录 -> 尝试其 index.html
    if (info.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    // 开发期禁缓存，改代码刷新即生效
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  try {
    res.end(await readFile(target));
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  cs-web-fps 已启动\n`);
  console.log(`  本地:   http://${HOST}:${PORT}/`);
  console.log(`  根目录: ${ROOT}`);
  console.log(`\n  Ctrl+C 停止\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用，换个端口：node server.mjs 5174\n`);
  } else {
    console.error('\n  服务器错误:', err.message, '\n');
  }
  process.exit(1);
});

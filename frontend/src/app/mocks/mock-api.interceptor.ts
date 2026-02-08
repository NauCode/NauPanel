import { HttpEvent, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { mockLogs, mockServers, mockStates, ServerState } from './mock-data';

const serverStates = new Map<string, ServerState>();
const serverLogs = new Map<string, string[]>();
const serverFiles = new Map<string, Array<{ path: string; type: 'file' | 'dir'; content?: string }>>();
let statesSeeded = false;
let logsSeeded = false;

const getServerState = (id: string): ServerState => {
  const existing = serverStates.get(id);
  if (existing) {
    return existing;
  }

  const state: ServerState = {
    status: 'offline',
    lastAction: null,
    lastActionAt: null
  };
  serverStates.set(id, state);
  return state;
};

const ok = (body: unknown, status = 200): Observable<HttpEvent<unknown>> =>
  of(new HttpResponse({ status, body })).pipe(delay(200));

const seedStates = () => {
  if (statesSeeded) {
    return;
  }
  Object.entries(mockStates).forEach(([id, state]) => {
    serverStates.set(id, { ...state });
  });
  statesSeeded = true;
};

const seedLogs = () => {
  if (logsSeeded) {
    return;
  }
  Object.entries(mockLogs).forEach(([id, logs]) => {
    serverLogs.set(id, [...logs]);
  });
  logsSeeded = true;
};

const seedFiles = () => {
  if (serverFiles.size) {
    return;
  }
  mockServers.forEach((server) => {
    serverFiles.set(server.id, [
      { path: 'config', type: 'dir' },
      { path: 'logs', type: 'dir' },
      { path: 'world', type: 'dir' },
      { path: 'config/server.properties', type: 'file', content: 'motd=A Nau server\nmax-players=20' },
      { path: 'config/eula.txt', type: 'file', content: 'eula=true' },
      { path: 'logs/latest.log', type: 'file', content: '[INFO] Server started\n[INFO] Done' }
    ]);
  });
};

const normalizePath = (value: string) => value.replace(/^\/+/, '').replace(/\/+$/, '');

const getParentPath = (value: string) => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
};

const getName = (value: string) => {
  const normalized = normalizePath(value);
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? '';
};

const appendLog = (id: string, line: string) => {
  const logs = serverLogs.get(id) ?? [];
  logs.push(line);
  if (logs.length > 200) {
    logs.splice(0, logs.length - 200);
  }
  serverLogs.set(id, logs);
};

export const mockApiInterceptor = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  if (!req.url.startsWith('/api/')) {
    return next(req);
  }

  seedStates();
  seedLogs();
  seedFiles();

  if (req.url === '/api/health' && req.method === 'GET') {
    return ok({ status: 'ok', timestamp: new Date().toISOString() });
  }

  if (req.url === '/api/servers' && req.method === 'GET') {
    return ok({ servers: mockServers });
  }

  const url = new URL(req.url, 'http://mock');
  const match = url.pathname.match(/^\/api\/servers\/([^/]+)(?:\/(status|start|stop|restart|logs|command|stats|files\/content|files\/rename|files\/upload|files\/download|files\/dir|files))?$/);
  if (match) {
    const id = match[1];
    const action = match[2];
    const server = mockServers.find((item) => item.id === id);

    if (!server) {
      return ok({ error: 'Server not found.' }, 404);
    }

    const state = getServerState(id);

    if (!action || action === 'status') {
      return ok({ server, state });
    }

    if (action === 'logs' && req.method === 'GET') {
      const limitParam = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isNaN(limitParam) ? 50 : Math.max(1, limitParam);
      const logs = (serverLogs.get(id) ?? []).slice(-limit);
      return ok({ logs });
    }

    if (action === 'command' && req.method === 'POST') {
      const body = req.body as { command?: string };
      const command = String(body?.command ?? '').trim();
      if (command) {
        appendLog(id, `[CMD] ${command}`);
        appendLog(id, `[INFO] Executed command: ${command}`);
      }
      return ok({ ok: true });
    }

    if (action === 'stats' && req.method === 'GET') {
      const host = {
        cpuPercent: 32,
        memUsedMB: 3456,
        memTotalMB: 8192,
        memPercent: 42
      };
      return ok({
        status: state.status,
        players: { online: 3, max: 20, names: ['Alex', 'Steve', 'Nau'] },
        tps: 19.8,
        host,
        process: {
          pid: 4312,
          cpuPercent: 18,
          memMB: 2048
        },
        world: {
          path: 'world',
          sizeBytes: 524288000
        },
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'files' && req.method === 'GET') {
      const pathParam = normalizePath(url.searchParams.get('path') ?? '');
      const files = serverFiles.get(id) ?? [];
      const entries = files
        .filter((entry) => getParentPath(entry.path) === pathParam)
        .map((entry) => ({
          name: getName(entry.path),
          path: normalizePath(entry.path),
          type: entry.type,
          size: entry.type === 'file' ? entry.content?.length ?? 0 : undefined
        }));
      return ok({ entries });
    }

    if (action === 'files/content' && req.method === 'GET') {
      const pathParam = normalizePath(url.searchParams.get('path') ?? '');
      const files = serverFiles.get(id) ?? [];
      const entry = files.find((item) => normalizePath(item.path) === pathParam && item.type === 'file');
      if (!entry) {
        return ok({ error: 'File not found.' }, 404);
      }
      return ok({ content: entry.content ?? '' });
    }

    if (action === 'files/content' && req.method === 'POST') {
      const body = req.body as { path?: string; content?: string };
      const pathParam = normalizePath(String(body?.path ?? ''));
      const content = String(body?.content ?? '');
      const files = serverFiles.get(id) ?? [];
      const existing = files.find((item) => normalizePath(item.path) === pathParam);
      if (existing) {
        existing.type = 'file';
        existing.content = content;
      } else {
        files.push({ path: pathParam, type: 'file', content });
      }
      serverFiles.set(id, files);
      return ok({ ok: true });
    }

    if (action === 'files/dir' && req.method === 'POST') {
      const body = req.body as { path?: string };
      const pathParam = normalizePath(String(body?.path ?? ''));
      const files = serverFiles.get(id) ?? [];
      if (!files.find((item) => normalizePath(item.path) === pathParam)) {
        files.push({ path: pathParam, type: 'dir' });
      }
      serverFiles.set(id, files);
      return ok({ ok: true });
    }

    if (action === 'files/rename' && req.method === 'POST') {
      const body = req.body as { from?: string; to?: string };
      const from = normalizePath(String(body?.from ?? ''));
      const to = normalizePath(String(body?.to ?? ''));
      const files = serverFiles.get(id) ?? [];
      files.forEach((item) => {
        if (normalizePath(item.path) === from || normalizePath(item.path).startsWith(`${from}/`)) {
          item.path = normalizePath(item.path).replace(from, to);
        }
      });
      serverFiles.set(id, files);
      return ok({ ok: true });
    }

    if (action === 'files' && req.method === 'DELETE') {
      const pathParam = normalizePath(url.searchParams.get('path') ?? '');
      const files = (serverFiles.get(id) ?? []).filter((item) => {
        const normalized = normalizePath(item.path);
        return normalized !== pathParam && !normalized.startsWith(`${pathParam}/`);
      });
      serverFiles.set(id, files);
      return ok({ ok: true });
    }

    if (action === 'files/upload' && req.method === 'POST') {
      const body = req.body as { path?: string; name?: string; contentBase64?: string };
      const basePath = normalizePath(String(body?.path ?? ''));
      const name = String(body?.name ?? 'upload.txt');
      const content = atob(String(body?.contentBase64 ?? ''));
      const pathParam = normalizePath(`${basePath}/${name}`);
      const files = serverFiles.get(id) ?? [];
      files.push({ path: pathParam, type: 'file', content });
      serverFiles.set(id, files);
      return ok({ ok: true });
    }

    if (action === 'files/download' && req.method === 'GET') {
      const pathParam = normalizePath(url.searchParams.get('path') ?? '');
      const files = serverFiles.get(id) ?? [];
      const entry = files.find((item) => normalizePath(item.path) === pathParam && item.type === 'file');
      if (!entry) {
        return ok({ error: 'File not found.' }, 404);
      }
      const blob = new Blob([entry.content ?? ''], { type: 'text/plain' });
      return ok(blob);
    }

    if (action === 'start') {
      state.status = 'online';
      state.lastAction = 'start';
      state.lastActionAt = new Date().toISOString();
      appendLog(id, '[INFO] Server started');
    }

    if (action === 'stop') {
      state.status = 'offline';
      state.lastAction = 'stop';
      state.lastActionAt = new Date().toISOString();
      appendLog(id, '[INFO] Server stopped');
    }

    if (action === 'restart') {
      state.status = 'online';
      state.lastAction = 'restart';
      state.lastActionAt = new Date().toISOString();
      appendLog(id, '[INFO] Server restarted');
    }

    return ok({ server, state });
  }

  return ok({ error: 'Mock endpoint not implemented.' }, 404);
};

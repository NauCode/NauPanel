import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Rcon } from "rcon-client";

dotenv.config();

const app: Express = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;
const configPath = process.env.SERVERS_CONFIG_PATH || "config/servers.yaml";

type ServerConfig = {
  id: string;
  name: string;
  path: string;
  port: number;
  description?: string;
  rcon?: {
    host?: string;
    port?: number;
    password?: string;
  };
};

type ServerStatus = "offline" | "online" | "restarting";

type ServerState = {
  status: ServerStatus;
  lastAction: "start" | "stop" | "restart" | null;
  lastActionAt: string | null;
};

type CommandBody = {
  command?: string;
};

type WsClient = WebSocket & { serverId?: string };

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const resolveConfigPath = (inputPath: string) =>
  path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);

const loadServersConfig = async (): Promise<ServerConfig[]> => {
  const resolvedPath = resolveConfigPath(configPath);
  const raw = await fs.readFile(resolvedPath, "utf-8");
  const parsed = yaml.load(raw) as { servers?: Array<Record<string, unknown>> };

  if (!parsed?.servers || !Array.isArray(parsed.servers)) {
    throw new Error("Invalid servers config: missing 'servers' array.");
  }

  return parsed.servers.map((server, index) => {
    const name = String(server.name ?? "").trim();
    const serverPath = String(server.path ?? "").trim();
    const portValue = Number(server.port);
    const description = typeof server.description === 'string'
      ? server.description.trim()
      : undefined;
    const rconConfig = typeof server.rcon === "object" && server.rcon
      ? (server.rcon as { host?: unknown; port?: unknown; password?: unknown })
      : undefined;
    const rcon = rconConfig
      ? {
          host: typeof rconConfig.host === "string" ? rconConfig.host : undefined,
          port: Number(rconConfig.port ?? 25575),
          password: typeof rconConfig.password === "string" ? rconConfig.password : undefined
        }
      : undefined;
    const explicitId = String(server.id ?? "").trim();
    const idSource = explicitId || name || `server-${index + 1}`;

    if (!name || !serverPath || Number.isNaN(portValue)) {
      throw new Error(`Invalid server entry at index ${index}.`);
    }

    return {
      id: explicitId || toSlug(idSource),
      name,
      path: serverPath,
      port: portValue,
      description,
      rcon
    };
  });
};

let servers: ServerConfig[] = [];
let serversLoaded = false;
const serverStates = new Map<string, ServerState>();
const serverLogs = new Map<string, string[]>();
const serverSubscribers = new Map<string, Set<WsClient>>();

loadServersConfig()
  .then((data) => {
    servers = data;
    serversLoaded = true;
    servers.forEach((server) => {
      if (!serverStates.has(server.id)) {
        serverStates.set(server.id, {
          status: "offline",
          lastAction: null,
          lastActionAt: null
        });
      }
    });
    console.log(`✅ Loaded ${servers.length} server(s) from config.`);
  })
  .catch((error) => {
    console.error("❌ Failed to load servers config:", error);
  });

const getServerById = (id: string) => servers.find((server) => server.id === id);

const normalizeRelativePath = (inputPath: string) =>
  inputPath.replace(/\\/g, "/").replace(/^\/+/, "");

const resolveServerPath = (server: ServerConfig, relPath: string) => {
  const root = path.resolve(server.path);
  const safeRel = normalizeRelativePath(relPath);
  const full = path.resolve(root, safeRel);
  const relative = path.relative(root, full);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path");
  }

  return { root, full, rel: safeRel };
};

const toPosixPath = (base: string, name: string) => {
  if (!base) {
    return name;
  }
  return `${base.replace(/\/+$/, "")}/${name}`;
};

const getQueryParam = (req: Request, key: string): string => {
  const value = req.query[key];
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
};

const getRouteParam = (req: Request, key: string): string => {
  const value = req.params[key];
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
};

const parsePlayerList = (line: string) => {
  const match = line.match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/i);
  if (!match) {
    return { online: 0, max: 0, names: [] as string[] };
  }
  const online = Number(match[1]);
  const max = Number(match[2]);
  const namesRaw = (match[3] ?? "").trim();
  const names = namesRaw ? namesRaw.split(/,\s*/).filter(Boolean) : [];
  return { online, max, names };
};

const parseTps = (line: string) => {
  const colonMatch = line.match(/:\s*([0-9]+\.?[0-9]*)/);
  const simpleMatch = line.match(/TPS\s*:?\s*([0-9]+\.?[0-9]*)/i);
  const match = colonMatch ?? simpleMatch;
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isNaN(value) ? null : value;
};

const cpuSamples = new Map<number, { procTime: number; totalTime: number }>();

const normalizeLinuxPath = (value: string) => value.replace(/\\/g, "/");

const findProcessByPath = async (serverPath: string) => {
  const normalizedTarget = normalizeLinuxPath(serverPath);
  try {
    const entries = await fs.readdir("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue;
      }
      const cmdlinePath = `/proc/${entry}/cmdline`;
      try {
        const cmdlineRaw = await fs.readFile(cmdlinePath, "utf-8");
        const cmdline = cmdlineRaw.replace(/\0/g, " ").trim();
        if (!cmdline) {
          continue;
        }
        if (cmdline.includes(normalizedTarget)) {
          return Number(entry);
        }
      } catch {
        // ignore permission/read errors
      }
    }
  } catch {
    return null;
  }
  return null;
};

const readProcTimes = async (pid: number) => {
  const statRaw = await fs.readFile(`/proc/${pid}/stat`, "utf-8");
  const end = statRaw.lastIndexOf(") ");
  if (end === -1) {
    return null;
  }
  const rest = statRaw.slice(end + 2).trim().split(/\s+/);
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (Number.isNaN(utime) || Number.isNaN(stime)) {
    return null;
  }
  return utime + stime;
};

const readTotalCpuTime = async () => {
  const statRaw = await fs.readFile("/proc/stat", "utf-8");
  const firstLine = statRaw.split("\n")[0] ?? "";
  const parts = firstLine.trim().split(/\s+/).slice(1);
  if (!parts.length) {
    return null;
  }
  const numbers = parts.slice(0, 8).map((value) => Number(value));
  if (numbers.some((value) => Number.isNaN(value))) {
    return null;
  }
  return numbers.reduce((sum, value) => sum + value, 0);
};

const readProcessMemoryMB = async (pid: number) => {
  const statusRaw = await fs.readFile(`/proc/${pid}/status`, "utf-8");
  const match = statusRaw.match(/VmRSS:\s+(\d+)\s+kB/i);
  if (!match) {
    return null;
  }
  const kb = Number(match[1]);
  if (Number.isNaN(kb)) {
    return null;
  }
  return Math.round(kb / 1024);
};

const getProcessStats = async (pid: number) => {
  try {
    const [procTime, totalTime, memMB] = await Promise.all([
      readProcTimes(pid),
      readTotalCpuTime(),
      readProcessMemoryMB(pid)
    ]);
    if (procTime === null || totalTime === null) {
      return null;
    }

    const previous = cpuSamples.get(pid);
    cpuSamples.set(pid, { procTime, totalTime });
    let cpuPercent = 0;
    if (previous) {
      const procDelta = procTime - previous.procTime;
      const totalDelta = totalTime - previous.totalTime;
      if (totalDelta > 0 && procDelta >= 0) {
        cpuPercent = Math.min(100, Math.round((procDelta / totalDelta) * 100 * os.cpus().length));
      }
    }

    return {
      pid,
      cpuPercent,
      memMB
    };
  } catch {
    return null;
  }
};

const getDirectorySize = async (dirPath: string): Promise<number> => {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          total += stat.size;
        } catch {
          // ignore unreadable files
        }
        continue;
      }
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath);
      }
    }
  } catch {
    return 0;
  }
  return total;
};

const parseServerProperties = (raw: string) => {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (key === 'level-name') {
      return rest.join('=').trim();
    }
  }
  return '';
};

const getWorldPath = async (serverPath: string) => {
  const propertiesPath = path.join(serverPath, 'server.properties');
  let worldName = 'world';
  try {
    const raw = await fs.readFile(propertiesPath, 'utf-8');
    const parsed = parseServerProperties(raw);
    if (parsed) {
      worldName = parsed;
    }
  } catch {
    // fallback to default world folder
  }

  if (path.isAbsolute(worldName)) {
    return worldName;
  }
  return path.join(serverPath, worldName);
};

const getHostStats = () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuCount = os.cpus().length || 1;
  const load = os.loadavg()[0] ?? 0;
  const cpuPercent = Math.min(100, Math.round((load / cpuCount) * 100));
  const memUsedMB = Math.round(usedMem / 1024 / 1024);
  const memTotalMB = Math.round(totalMem / 1024 / 1024);
  const memPercent = memTotalMB > 0 ? Math.round((memUsedMB / memTotalMB) * 100) : 0;
  return {
    cpuPercent,
    memUsedMB,
    memTotalMB,
    memPercent
  };
};

const updateLiveStatus = async (server: ServerConfig, state: ServerState) => {
  if (!server.rcon?.password) {
    return state;
  }

  const host = server.rcon.host || "127.0.0.1";
  const port = server.rcon.port && !Number.isNaN(server.rcon.port) ? server.rcon.port : 25575;
  let rcon: Rcon | null = null;
  try {
    rcon = await Rcon.connect({
      host,
      port,
      password: server.rcon.password,
      timeout: 1500
    });
    state.status = "online";
  } catch {
    state.status = "offline";
  } finally {
    if (rcon) {
      try {
        await rcon.end();
      } catch {
        // ignore close errors
      }
    }
  }

  return state;
};

const getServerState = (id: string): ServerState => {
  const existing = serverStates.get(id);
  if (existing) {
    return existing;
  }

  const state: ServerState = {
    status: "offline",
    lastAction: null,
    lastActionAt: null
  };
  serverStates.set(id, state);
  return state;
};

const appendLog = (id: string, line: string) => {
  const logs = serverLogs.get(id) ?? [];
  logs.push(line);
  if (logs.length > 200) {
    logs.splice(0, logs.length - 200);
  }
  serverLogs.set(id, logs);
  broadcastLog(id, line);
};

const broadcastLog = (id: string, line: string) => {
  const subscribers = serverSubscribers.get(id);
  if (!subscribers || !subscribers.size) {
    return;
  }

  const payload = JSON.stringify({ type: "log", line });
  subscribers.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
};

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Routes
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/servers", (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  return res.json({ servers });
});

app.get("/api/servers/:id/status", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const state = getServerState(server.id);
  await updateLiveStatus(server, state);
  return res.json({ server, state });
});

app.post("/api/servers/:id/start", (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const state = getServerState(server.id);
  state.status = "online";
  state.lastAction = "start";
  state.lastActionAt = new Date().toISOString();
  appendLog(server.id, "[INFO] Server started");
  return res.json({ server, state });
});

app.post("/api/servers/:id/stop", (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const state = getServerState(server.id);
  state.status = "offline";
  state.lastAction = "stop";
  state.lastActionAt = new Date().toISOString();
  appendLog(server.id, "[INFO] Server stopped");
  return res.json({ server, state });
});

app.post("/api/servers/:id/restart", (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const state = getServerState(server.id);
  state.status = "online";
  state.lastAction = "restart";
  state.lastActionAt = new Date().toISOString();
  appendLog(server.id, "[INFO] Server restarted");
  return res.json({ server, state });
});

app.get("/api/servers/:id/logs", (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const limitParam = Number(req.query.limit ?? 50);
  const limit = Number.isNaN(limitParam) ? 50 : Math.max(1, limitParam);
  const logs = (serverLogs.get(server.id) ?? []).slice(-limit);
  return res.json({ logs });
});

app.post("/api/servers/:id/command", (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const body = req.body as CommandBody;
  const command = String(body?.command ?? "").trim();
  if (command) {
    appendLog(server.id, `[CMD] ${command}`);
    appendLog(server.id, `[INFO] Executed command: ${command}`);
  }

  return res.json({ ok: true });
});

app.get("/api/servers/:id/stats", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  if (!server.rcon?.password) {
    return res.status(400).json({ error: "RCON not configured." });
  }

  const host = server.rcon.host || "127.0.0.1";
  const port = server.rcon.port && !Number.isNaN(server.rcon.port) ? server.rcon.port : 25575;

  let rcon: Rcon | null = null;
  try {
    rcon = await Rcon.connect({
      host,
      port,
      password: server.rcon.password,
      timeout: 3000
    });

    const listResult = await rcon.send("list");
    const players = parsePlayerList(listResult);

    let tps: number | null = null;
    try {
      const tpsResult = await rcon.send("tps");
      tps = parseTps(tpsResult);
    } catch {
      tps = null;
    }

    const hostStats = getHostStats();
    const pid = await findProcessByPath(server.path);
    const processStats = pid ? await getProcessStats(pid) : null;
    const worldPath = await getWorldPath(server.path);
    const worldSizeBytes = await getDirectorySize(worldPath);
    const state = getServerState(server.id);
    state.status = "online";

    return res.json({
      status: state.status,
      players,
      tps,
      host: hostStats,
      process: processStats,
      world: {
        path: worldPath,
        sizeBytes: worldSizeBytes
      },
      timestamp: new Date().toISOString()
    });
  } catch {
    const state = getServerState(server.id);
    state.status = "offline";
    return res.status(500).json({ error: "Unable to fetch server stats." });
  } finally {
    if (rcon) {
      try {
        await rcon.end();
      } catch {
        // ignore close errors
      }
    }
  }
});

app.get("/api/servers/:id/files", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const relPath = getQueryParam(req, "path");
  let resolved;
  try {
    resolved = resolveServerPath(server, relPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    const stat = await fs.stat(resolved.full);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Not a directory." });
    }

    const entries = await fs.readdir(resolved.full, { withFileTypes: true });
    const payload = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = toPosixPath(resolved.rel, entry.name);
        const fullEntryPath = path.resolve(resolved.full, entry.name);
        if (entry.isFile()) {
          const fileStat = await fs.stat(fullEntryPath);
          return {
            name: entry.name,
            path: entryPath,
            type: "file",
            size: fileStat.size
          };
        }
        return {
          name: entry.name,
          path: entryPath,
          type: "dir"
        };
      })
    );

    return res.json({ path: resolved.rel, entries: payload });
  } catch {
    return res.status(500).json({ error: "Unable to list files." });
  }
});

app.get("/api/servers/:id/files/content", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const relPath = getQueryParam(req, "path");
  let resolved;
  try {
    resolved = resolveServerPath(server, relPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    const stat = await fs.stat(resolved.full);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Not a file." });
    }
    const content = await fs.readFile(resolved.full, "utf-8");
    return res.json({ path: resolved.rel, content });
  } catch {
    return res.status(500).json({ error: "Unable to read file." });
  }
});

app.post("/api/servers/:id/files/content", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const relPath = String(req.query.path ?? "");
  const content = String((req.body as { content?: string })?.content ?? "");
  let resolved;
  try {
    resolved = resolveServerPath(server, relPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    const dirPath = path.dirname(resolved.full);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(resolved.full, content, "utf-8");
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Unable to save file." });
  }
});

app.post("/api/servers/:id/files/dir", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const relPath = String(req.query.path ?? "");
  let resolved;
  try {
    resolved = resolveServerPath(server, relPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    await fs.mkdir(resolved.full, { recursive: true });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Unable to create folder." });
  }
});

app.post("/api/servers/:id/files/rename", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const body = req.body as { from?: string; to?: string };
  const fromPath = String(body?.from ?? "");
  const toPath = String(body?.to ?? "");
  let fromResolved;
  let toResolved;
  try {
    fromResolved = resolveServerPath(server, fromPath);
    toResolved = resolveServerPath(server, toPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    await fs.rename(fromResolved.full, toResolved.full);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Unable to rename entry." });
  }
});

app.delete("/api/servers/:id/files", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const relPath = String(req.query.path ?? "");
  let resolved;
  try {
    resolved = resolveServerPath(server, relPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    await fs.rm(resolved.full, { recursive: true, force: true });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Unable to delete entry." });
  }
});

app.post("/api/servers/:id/files/upload", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const body = req.body as { path?: string; name?: string; contentBase64?: string };
  const basePath = String(body?.path ?? "");
  const name = String(body?.name ?? "");
  const contentBase64 = String(body?.contentBase64 ?? "");
  if (!name || !contentBase64) {
    return res.status(400).json({ error: "Missing upload content." });
  }

  let resolved;
  try {
    resolved = resolveServerPath(server, toPosixPath(basePath, name));
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    const dirPath = path.dirname(resolved.full);
    await fs.mkdir(dirPath, { recursive: true });
    const buffer = Buffer.from(contentBase64, "base64");
    await fs.writeFile(resolved.full, buffer);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Unable to upload file." });
  }
});

app.get("/api/servers/:id/files/download", async (req: Request, res: Response) => {
  if (!serversLoaded) {
    return res.status(500).json({ error: "No servers configured." });
  }

  const server = getServerById(getRouteParam(req, "id"));
  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const relPath = String(req.query.path ?? "");
  let resolved;
  try {
    resolved = resolveServerPath(server, relPath);
  } catch {
    return res.status(400).json({ error: "Invalid path." });
  }

  try {
    const stat = await fs.stat(resolved.full);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Not a file." });
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(resolved.full)}"`
    );
    const buffer = await fs.readFile(resolved.full);
    return res.send(buffer);
  } catch {
    return res.status(500).json({ error: "Unable to download file." });
  }
});

const wss = new WebSocketServer({ server, path: "/ws/console" });

wss.on("connection", (ws: WsClient) => {
  ws.on("message", (raw) => {
    let data: { type?: string; serverId?: string; limit?: number; command?: string } | null = null;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!data?.type) {
      return;
    }

    if (data.type === "subscribe") {
      const serverId = String(data.serverId ?? "").trim();
      if (!serverId) {
        return;
      }

      ws.serverId = serverId;
      if (!serverSubscribers.has(serverId)) {
        serverSubscribers.set(serverId, new Set());
      }
      serverSubscribers.get(serverId)!.add(ws);

      const limitParam = Number(data.limit ?? 50);
      const limit = Number.isNaN(limitParam) ? 50 : Math.max(1, limitParam);
      const logs = (serverLogs.get(serverId) ?? []).slice(-limit);
      ws.send(JSON.stringify({ type: "logs", logs }));
    }

    if (data.type === "command") {
      const serverId = ws.serverId;
      if (!serverId) {
        return;
      }
      const command = String(data.command ?? "").trim();
      if (command) {
        appendLog(serverId, `[CMD] ${command}`);
        appendLog(serverId, `[INFO] Executed command: ${command}`);
      }
    }
  });

  ws.on("close", () => {
    const serverId = ws.serverId;
    if (!serverId) {
      return;
    }
    serverSubscribers.get(serverId)?.delete(ws);
  });
});

server.listen(port, () => {
  console.log(`✅ Backend running on http://localhost:${port}`);
});

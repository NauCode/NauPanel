export type ServerState = {
  status: 'offline' | 'online' | 'restarting';
  lastAction: 'start' | 'stop' | 'restart' | null;
  lastActionAt: string | null;
};

export type MockServer = {
  id: string;
  name: string;
  path: string;
  port: number;
  description?: string;
};

export const mockServers: MockServer[] = [
  {
    id: 'nau-survival',
    name: 'Nau Survival',
    path: 'D:/Minecraft/servers/nau-survival',
    port: 25565,
    description: 'Vanilla survival world focused on long-term progression.'
  },
  {
    id: 'nau-creative',
    name: 'Nau Creative',
    path: 'D:/Minecraft/servers/nau-creative',
    port: 25566,
    description: 'Creative sandbox for builds, schematics, and experiments.'
  },
  {
    id: 'nau-skyblock',
    name: 'Nau Skyblock',
    path: 'D:/Minecraft/servers/nau-skyblock',
    port: 25567,
    description: 'Skyblock challenge with economy and island progression.'
  },
  {
    id: 'nau-events',
    name: 'Nau Events',
    path: 'D:/Minecraft/servers/nau-events',
    port: 25568,
    description: 'Event server for mini-games and seasonal activities.'
  }
];

export const mockStates: Record<string, ServerState> = {
  'nau-survival': {
    status: 'online',
    lastAction: 'start',
    lastActionAt: '2026-02-08T07:40:00.000Z'
  },
  'nau-creative': {
    status: 'offline',
    lastAction: 'stop',
    lastActionAt: '2026-02-08T07:10:00.000Z'
  },
  'nau-skyblock': {
    status: 'restarting',
    lastAction: 'restart',
    lastActionAt: '2026-02-08T07:55:00.000Z'
  },
  'nau-events': {
    status: 'offline',
    lastAction: null,
    lastActionAt: null
  }
};

export const mockLogs: Record<string, string[]> = {
  'nau-survival': [
    '[INFO] Starting minecraft server version 1.20.4',
    '[INFO] Loading properties',
    '[INFO] Default game type: SURVIVAL',
    '[INFO] Done (4.21s)! For help, type "help"'
  ],
  'nau-creative': [
    '[INFO] Starting minecraft server version 1.20.4',
    '[INFO] Default game type: CREATIVE',
    '[INFO] Preparing spawn area: 78%',
    '[INFO] Done (3.87s)! For help, type "help"'
  ],
  'nau-skyblock': [
    '[INFO] Starting minecraft server version 1.20.4',
    '[INFO] Loading skyblock islands',
    '[WARN] Island queue backlog detected',
    '[INFO] Done (5.02s)! For help, type "help"'
  ],
  'nau-events': [
    '[INFO] Starting minecraft server version 1.20.4',
    '[INFO] Loading mini-games',
    '[INFO] Arena 2 ready',
    '[INFO] Done (4.66s)! For help, type "help"'
  ]
};

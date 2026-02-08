import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

type WsMessage =
  | { type: 'subscribe'; serverId: string; limit?: number }
  | { type: 'command'; command: string }
  | { type: 'logs'; logs: string[] }
  | { type: 'log'; line: string };

@Injectable({
  providedIn: 'root'
})
export class ConsoleSocketService {
  private socket: WebSocket | null = null;
  private pollingId: number | null = null;
  private serverId = '';
  private limit = 50;
  private readonly maxDisplay = 5000;
  private logsSubject = new BehaviorSubject<string[]>([]);

  constructor(private http: HttpClient) {}

  get logs$(): Observable<string[]> {
    return this.logsSubject.asObservable();
  }

  connect(serverId: string, limit = 50): void {
    this.serverId = serverId;
    this.limit = limit;
    this.logsSubject.next([]);

    if (!serverId) {
      this.disconnect();
      return;
    }

    if (environment.useMocks) {
      this.startPolling();
      return;
    }

    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      this.openSocket();
    }

    this.send({ type: 'subscribe', serverId, limit });
  }

  setLimit(limit: number): void {
    this.limit = limit;
    if (!this.serverId) {
      return;
    }

    if (environment.useMocks) {
      this.fetchLogs();
      return;
    }

    this.send({ type: 'subscribe', serverId: this.serverId, limit });
  }

  sendCommand(command: string): void {
    const trimmed = command.trim();
    if (!trimmed || !this.serverId) {
      return;
    }

    if (environment.useMocks) {
      this.http
        .post(this.buildApiUrl(`/servers/${this.serverId}/command`), { command: trimmed })
        .subscribe({
          next: () => this.fetchLogs(),
          error: () => undefined
        });
      return;
    }

    this.send({ type: 'command', command: trimmed });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.pollingId !== null) {
      window.clearInterval(this.pollingId);
      this.pollingId = null;
    }
  }

  private openSocket(): void {
    const url = this.buildWsUrl();
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => this.onMessage(event);
    this.socket.onopen = () => {
      if (this.serverId) {
        this.send({ type: 'subscribe', serverId: this.serverId, limit: this.limit });
      }
    };
  }

  private onMessage(event: MessageEvent): void {
    let message: WsMessage | null = null;
    try {
      message = JSON.parse(event.data) as WsMessage;
    } catch {
      return;
    }

    if (!message) {
      return;
    }

    if (message.type === 'logs') {
      this.logsSubject.next(message.logs.slice(-this.maxDisplay));
      return;
    }

    if (message.type === 'log') {
      const nextLogs = [...this.logsSubject.value, message.line].slice(-this.maxDisplay);
      this.logsSubject.next(nextLogs);
    }
  }

  private send(message: WsMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private startPolling(): void {
    this.fetchLogs();
    if (this.pollingId !== null) {
      window.clearInterval(this.pollingId);
    }
    this.pollingId = window.setInterval(() => this.fetchLogs(), 2000);
  }

  private fetchLogs(): void {
    if (!this.serverId) {
      return;
    }

    this.http
      .get<{ logs: string[] }>(
        this.buildApiUrl(`/servers/${this.serverId}/logs?limit=${this.limit}`)
      )
      .subscribe({
        next: (response) => {
          this.logsSubject.next(response.logs.slice(-this.maxDisplay));
        },
        error: () => this.logsSubject.next([])
      });
  }

  private buildApiUrl(path: string): string {
    const base = environment.apiBaseUrl || '/api';
    if (base.endsWith('/') && path.startsWith('/')) {
      return `${base.slice(0, -1)}${path}`;
    }
    if (!base.endsWith('/') && !path.startsWith('/')) {
      return `${base}/${path}`;
    }
    return `${base}${path}`;
  }

  private buildWsUrl(): string {
    const wsBase = environment.wsBaseUrl || '/ws/console';
    if (wsBase.startsWith('ws://') || wsBase.startsWith('wss://')) {
      return wsBase;
    }

    const apiBase = environment.apiBaseUrl || '';
    if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
      const apiUrl = new URL(apiBase);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsPath = wsBase.startsWith('/') ? wsBase : `/${wsBase}`;
      return `${protocol}//${apiUrl.host}${wsPath}`;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsPath = wsBase.startsWith('/') ? wsBase : `/${wsBase}`;
    return `${protocol}://${window.location.host}${wsPath}`;
  }
}

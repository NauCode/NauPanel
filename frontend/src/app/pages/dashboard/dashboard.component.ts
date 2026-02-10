import { DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { of, Subject, Subscription, timer } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { AppStateService } from '../../services/app-state.service';
import { ConsoleSocketService } from '../../services/console-socket.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe, DecimalPipe, NgFor, NgIf],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  logs: string[] = [];
  stats: ServerStats | null = null;
  statsError = '';
  private destroy$ = new Subject<void>();
  private statsSub: Subscription | null = null;

  constructor(
    private appState: AppStateService,
    private consoleSocket: ConsoleSocketService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    if (!this.appState.servers.length && !this.appState.loading) {
      this.appState.loadServers();
    }

    this.appState.selectedServerId$
      .pipe(takeUntil(this.destroy$))
      .subscribe((id) => {
        this.statsSub?.unsubscribe();
        this.stats = null;
        if (id) {
          this.consoleSocket.connect(id, 50);
          this.statsSub = timer(0, 5000)
            .pipe(
              switchMap(() =>
                this.http
                  .get<ServerStats>(this.buildApiUrl(`/servers/${id}/stats`))
                  .pipe(
                    catchError(() => {
                      this.statsError = 'Unable to load server stats.';
                      return of(this.stats);
                    })
                  )
              )
            )
            .subscribe({
              next: (stats) => {
                this.statsError = '';
                this.stats = stats;
              }
            });
        } else {
          this.logs = [];
        }
      });

    this.consoleSocket.logs$
      .pipe(takeUntil(this.destroy$))
      .subscribe((lines) => {
        this.logs = lines.slice(-50);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.consoleSocket.disconnect();
    this.statsSub?.unsubscribe();
  }

  get selectedServer() {
    return this.appState.selectedServer;
  }

  get selectedServerId(): string {
    return this.appState.selectedServerId;
  }

  get playerPercent(): number {
    const online = this.stats?.players.online ?? 0;
    const max = this.stats?.players.max ?? 0;
    if (!max) {
      return 0;
    }
    return Math.min(100, Math.round((online / max) * 100));
  }

  get tpsPercent(): number {
    const tps = this.stats?.tps ?? 0;
    if (!tps) {
      return 0;
    }
    return Math.min(100, Math.round((tps / 20) * 100));
  }

  get cpuPercent(): number {
    return this.stats?.process?.cpuPercent ?? this.stats?.host.cpuPercent ?? 0;
  }

  get memPercent(): number {
    const used = this.stats?.process?.memMB ?? this.stats?.host.memUsedMB ?? 0;
    const total = this.stats?.host.memTotalMB ?? 0;
    if (!total) {
      return 0;
    }
    return Math.min(100, Math.round((used / total) * 100));
  }

  get memUsedMB(): number {
    return this.stats?.process?.memMB ?? this.stats?.host.memUsedMB ?? 0;
  }

  get memTotalMB(): number {
    return this.stats?.host.memTotalMB ?? 0;
  }

  formatBytes(value: number | null | undefined): string {
    if (!value) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
}

type ServerStats = {
  status: 'offline' | 'online' | 'restarting';
  players: {
    online: number;
    max: number;
    names: string[];
  };
  tps: number | null;
  host: {
    cpuPercent: number;
    memUsedMB: number;
    memTotalMB: number;
    memPercent: number;
  };
  process?: {
    pid: number;
    cpuPercent: number;
    memMB: number | null;
  } | null;
  world: {
    path: string;
    sizeBytes: number;
  };
  timestamp: string;
};

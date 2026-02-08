import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, forkJoin, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

export type ServerConfig = {
  id: string;
  name: string;
  path: string;
  port: number;
  description?: string;
};

export type ServerState = {
  status: 'offline' | 'online' | 'restarting';
  lastAction: 'start' | 'stop' | 'restart' | null;
  lastActionAt: string | null;
};

const STORAGE_KEY = 'naupanel.selectedServerId';

@Injectable({
  providedIn: 'root'
})
export class AppStateService {
  private serversSubject = new BehaviorSubject<ServerConfig[]>([]);
  private selectedServerIdSubject = new BehaviorSubject<string>('');
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new BehaviorSubject<string>('');
  private statusSubject = new BehaviorSubject<Record<string, ServerState>>({});
  private loadToken = 0;

  constructor(private http: HttpClient) {
    const storedId = localStorage.getItem(STORAGE_KEY) ?? '';
    this.selectedServerIdSubject.next(storedId);
  }

  get servers$(): Observable<ServerConfig[]> {
    return this.serversSubject.asObservable();
  }

  get selectedServerId$(): Observable<string> {
    return this.selectedServerIdSubject.asObservable();
  }

  get loading$(): Observable<boolean> {
    return this.loadingSubject.asObservable();
  }

  get error$(): Observable<string> {
    return this.errorSubject.asObservable();
  }

  get statuses$(): Observable<Record<string, ServerState>> {
    return this.statusSubject.asObservable();
  }

  get servers(): ServerConfig[] {
    return this.serversSubject.value;
  }

  get selectedServerId(): string {
    return this.selectedServerIdSubject.value;
  }

  get loading(): boolean {
    return this.loadingSubject.value;
  }

  get error(): string {
    return this.errorSubject.value;
  }

  get statuses(): Record<string, ServerState> {
    return this.statusSubject.value;
  }

  get selectedServer(): ServerConfig | undefined {
    return this.servers.find((server) => server.id === this.selectedServerId);
  }

  loadServers(): void {
    const token = ++this.loadToken;
    this.loadingSubject.next(true);
    this.errorSubject.next('');
    const fallbackTimer = setTimeout(() => {
      if (this.loadToken === token) {
        this.loadingSubject.next(false);
        this.errorSubject.next('Request timed out. Please try refresh again.');
      }
    }, 5000);

    this.http
      .get<{ servers: ServerConfig[] }>('/api/servers')
      .pipe(timeout(3000))
      .subscribe({
        next: (response) => {
          this.serversSubject.next(response.servers);
          clearTimeout(fallbackTimer);
          if (this.loadToken === token) {
            this.loadingSubject.next(false);
          }
          this.refreshStatuses(response.servers);
        },
        error: () => {
          this.serversSubject.next([]);
          clearTimeout(fallbackTimer);
          if (this.loadToken === token) {
            this.loadingSubject.next(false);
            this.errorSubject.next('Unable to load servers. Check mock configuration.');
          }
        }
      });
  }

  refreshStatuses(servers: ServerConfig[] = this.servers): void {
    if (!servers.length) {
      this.statusSubject.next({});
      return;
    }

    const fallbackState: ServerState = {
      status: 'offline',
      lastAction: null,
      lastActionAt: null
    };

    const requests = servers.map((server) =>
      this.http
        .get<{ server: ServerConfig; state: ServerState }>(`/api/servers/${server.id}/status`)
        .pipe(
          catchError(() =>
            of({
              server,
              state: { ...fallbackState }
            })
          )
        )
    );

    forkJoin(requests).subscribe((results) => {
      const nextStates: Record<string, ServerState> = {};
      results.forEach((result) => {
        nextStates[result.server.id] = result.state;
      });
      this.statusSubject.next(nextStates);
    });
  }

  selectServer(id: string): void {
    this.selectedServerIdSubject.next(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

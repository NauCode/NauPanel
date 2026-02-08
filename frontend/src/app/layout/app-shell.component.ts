import { NgIf } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppStateService, ServerConfig, ServerState } from '../services/app-state.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [NgIf, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css'
})
export class AppShellComponent implements OnInit, OnDestroy {
  private statusTimerId: number | null = null;
  private carouselTimerId: number | null = null;
  private serversSub: Subscription | null = null;
  servers: ServerConfig[] = [];
  statusIndex = 0;
  get selectedServerName(): string {
    return this.appState.selectedServer?.name ?? '';
  }

  constructor(
    public appState: AppStateService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (!this.appState.servers.length && !this.appState.loading) {
      this.appState.loadServers();
    } else {
      this.appState.refreshStatuses();
    }

    this.serversSub = this.appState.servers$.subscribe((servers) => {
      this.servers = servers;
      if (servers.length) {
        this.statusIndex = this.statusIndex % servers.length;
      } else {
        this.statusIndex = 0;
      }
    });

    this.statusTimerId = window.setInterval(() => {
      this.appState.refreshStatuses();
    }, 5000);

    this.carouselTimerId = window.setInterval(() => {
      if (this.servers.length > 1) {
        this.zone.run(() => {
          this.statusIndex = (this.statusIndex + 1) % this.servers.length;
          this.cdr.markForCheck();
        });
      }
    }, 3000);
  }

  ngOnDestroy(): void {
    if (this.statusTimerId !== null) {
      window.clearInterval(this.statusTimerId);
    }
    if (this.carouselTimerId !== null) {
      window.clearInterval(this.carouselTimerId);
    }
    this.serversSub?.unsubscribe();
  }

  get currentStatusServer(): ServerConfig | undefined {
    return this.servers[this.statusIndex];
  }

  get statusTotal(): number {
    return this.servers.length;
  }

  statusLabel(state?: ServerState): string {
    return state?.status ?? 'offline';
  }
}

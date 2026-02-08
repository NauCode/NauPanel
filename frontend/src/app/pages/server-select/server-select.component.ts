import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { AppStateService, ServerConfig } from '../../services/app-state.service';

@Component({
  selector: 'app-server-select',
  standalone: true,
  imports: [NgFor, NgIf],
  templateUrl: './server-select.component.html',
  styleUrl: './server-select.component.css'
})
export class ServerSelectComponent implements OnInit {
  servers: ServerConfig[] = [];
  selectedId = '';
  error = '';

  constructor(private appState: AppStateService, private router: Router) {}

  ngOnInit(): void {
    this.appState.loadServers();
    this.selectedId = this.appState.selectedServerId;
    this.appState.servers$.subscribe((servers) => {
      this.servers = servers;
    });
    this.appState.selectedServerId$.subscribe((id) => {
      this.selectedId = id;
    });
    this.appState.error$.subscribe((error) => {
      this.error = error;
    });
  }

  refreshServers(): void {
    this.appState.loadServers();
  }

  openServer(id: string): void {
    this.selectedId = id;
    this.appState.selectServer(id);
    this.router.navigateByUrl('/app', { replaceUrl: true });
  }
}

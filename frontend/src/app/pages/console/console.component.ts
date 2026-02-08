import { NgFor, NgIf } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AppStateService } from '../../services/app-state.service';
import { ConsoleSocketService } from '../../services/console-socket.service';

@Component({
  selector: 'app-console',
  standalone: true,
  imports: [FormsModule, NgFor, NgIf],
  templateUrl: './console.component.html',
  styleUrl: './console.component.css'
})
export class ConsoleComponent implements OnInit, OnDestroy {
  logs: string[] = [];
  command = '';
  sending = false;
  lineLimit = 200;
  readonly lineLimitOptions = [50, 100, 200, 500, 1000, 2000, 5000];
  readonly maxDisplayLines = 5000;
  private destroy$ = new Subject<void>();
  private currentServerId = '';
  @ViewChild('consoleLines') consoleLinesRef?: ElementRef<HTMLDivElement>;

  constructor(
    public appState: AppStateService,
    private consoleSocket: ConsoleSocketService
  ) {}

  ngOnInit(): void {
    this.appState.selectedServerId$
      .pipe(takeUntil(this.destroy$))
      .subscribe((id) => {
        this.currentServerId = id;
        if (id) {
          this.consoleSocket.connect(id, this.lineLimit);
        } else {
          this.logs = [];
        }
      });

    this.consoleSocket.logs$
      .pipe(takeUntil(this.destroy$))
      .subscribe((lines) => {
        this.logs = lines.slice(-this.maxDisplayLines);
        this.scrollToBottom();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.consoleSocket.disconnect();
  }

  sendCommand(): void {
    if (!this.currentServerId || !this.command.trim() || this.sending) {
      return;
    }

    this.sending = true;
    this.consoleSocket.sendCommand(this.command);
    this.command = '';
    this.sending = false;
  }

  onLimitChange(): void {
    this.consoleSocket.setLimit(this.lineLimit);
  }

  clearLogs(): void {
    this.logs = [];
  }

  private scrollToBottom(): void {
    const element = this.consoleLinesRef?.nativeElement;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }
}

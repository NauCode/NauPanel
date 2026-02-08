import { NgFor, NgIf } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { AppStateService } from '../../services/app-state.service';
import { FileEntry, FileService } from '../../services/file.service';
import loader from '@monaco-editor/loader';

@Component({
  selector: 'app-files',
  standalone: true,
  imports: [FormsModule, MatIconModule, NgFor, NgIf],
  templateUrl: './files.component.html',
  styleUrl: './files.component.css'
})
export class FilesComponent implements OnInit, OnDestroy {
  entries: FileEntry[] = [];
  currentPath = '';
  selectedEntry: FileEntry | null = null;
  content = '';
  loading = false;
  error = '';
  searchTerm = '';
  dialogMode: 'create-file' | 'create-folder' | 'rename' | 'delete' | null = null;
  dialogTitle = '';
  dialogMessage = '';
  dialogPlaceholder = '';
  dialogValue = '';
  private serverId = '';
  private editor: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;
  private model: import('monaco-editor').editor.ITextModel | null = null;
  private monaco: typeof import('monaco-editor') | null = null;
  private serverSub: Subscription | null = null;

  @ViewChild('editorHost', { static: false }) editorHost?: ElementRef<HTMLDivElement>;
  @ViewChild('uploadInput', { static: false }) uploadInput?: ElementRef<HTMLInputElement>;

  constructor(private appState: AppStateService, private files: FileService) {}

  ngOnInit(): void {
    this.serverSub = this.appState.selectedServerId$.subscribe((id) => {
      this.serverId = id;
      this.selectedEntry = null;
      this.content = '';
      if (id) {
        this.loadEntries('');
      } else {
        this.entries = [];
      }
    });
  }

  ngOnDestroy(): void {
    this.editor?.dispose();
    this.model?.dispose();
    this.serverSub?.unsubscribe();
  }

  openEntry(entry: FileEntry): void {
    this.selectedEntry = entry;
    if (entry.type === 'dir') {
      this.loadEntries(entry.path);
      return;
    }
    this.loadFile(entry.path);
  }

  get breadcrumbs(): Array<{ name: string; path: string }> {
    const parts = this.currentPath ? this.currentPath.split('/') : [];
    const crumbs: Array<{ name: string; path: string }> = [{ name: 'root', path: '' }];
    let acc = '';
    parts.forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ name: part, path: acc });
    });
    return crumbs;
  }

  get filteredEntries(): FileEntry[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.entries;
    }
    return this.entries.filter((entry) => entry.name.toLowerCase().includes(term));
  }

  navigateTo(path: string): void {
    this.loadEntries(path);
  }

  navigateUp(): void {
    if (!this.currentPath) {
      return;
    }
    const parts = this.currentPath.split('/');
    parts.pop();
    this.loadEntries(parts.join('/'));
  }

  refresh(): void {
    this.loadEntries(this.currentPath);
  }

  save(): void {
    if (!this.serverId || !this.selectedEntry || this.selectedEntry.type !== 'file') {
      return;
    }
    const content = this.model?.getValue() ?? this.content;
    this.files.save(this.serverId, this.selectedEntry.path, content).subscribe({
      next: () => {
        this.content = content;
      },
      error: () => {
        this.error = 'Failed to save file.';
      }
    });
  }

  createFile(): void {
    this.openDialog('create-file');
  }

  createFolder(): void {
    this.openDialog('create-folder');
  }

  rename(): void {
    this.openDialog('rename');
  }

  remove(): void {
    this.openDialog('delete');
  }

  get dialogNeedsInput(): boolean {
    return this.dialogMode === 'create-file' || this.dialogMode === 'create-folder' || this.dialogMode === 'rename';
  }

  openDialog(mode: 'create-file' | 'create-folder' | 'rename' | 'delete'): void {
    if (!this.serverId) {
      return;
    }

    if ((mode === 'rename' || mode === 'delete') && !this.selectedEntry) {
      return;
    }

    this.dialogMode = mode;
    this.dialogValue = '';

    switch (mode) {
      case 'create-file':
        this.dialogTitle = 'Create file';
        this.dialogMessage = 'Choose a file name.';
        this.dialogPlaceholder = 'File name';
        break;
      case 'create-folder':
        this.dialogTitle = 'Create folder';
        this.dialogMessage = 'Choose a folder name.';
        this.dialogPlaceholder = 'Folder name';
        break;
      case 'rename':
        this.dialogTitle = 'Rename entry';
        this.dialogMessage = 'Enter the new name.';
        this.dialogPlaceholder = 'New name';
        this.dialogValue = this.selectedEntry?.name ?? '';
        break;
      case 'delete':
        this.dialogTitle = 'Delete entry';
        this.dialogMessage = `Delete ${this.selectedEntry?.name}? This cannot be undone.`;
        this.dialogPlaceholder = '';
        break;
    }
  }

  closeDialog(): void {
    this.dialogMode = null;
    this.dialogValue = '';
    this.dialogTitle = '';
    this.dialogMessage = '';
    this.dialogPlaceholder = '';
  }

  confirmDialog(): void {
    if (!this.serverId || !this.dialogMode) {
      return;
    }

    if (this.dialogMode === 'create-file') {
      const name = this.dialogValue.trim();
      if (!name) {
        return;
      }
      const path = this.joinPath(this.currentPath, name);
      this.files.save(this.serverId, path, '').subscribe({
        next: () => {
          this.loadEntries(this.currentPath);
          this.closeDialog();
        },
        error: () => (this.error = 'Failed to create file.')
      });
      return;
    }

    if (this.dialogMode === 'create-folder') {
      const name = this.dialogValue.trim();
      if (!name) {
        return;
      }
      const path = this.joinPath(this.currentPath, name);
      this.files.createFolder(this.serverId, path).subscribe({
        next: () => {
          this.loadEntries(this.currentPath);
          this.closeDialog();
        },
        error: () => (this.error = 'Failed to create folder.')
      });
      return;
    }

    if (this.dialogMode === 'rename') {
      if (!this.selectedEntry) {
        return;
      }
      const nextName = this.dialogValue.trim();
      if (!nextName) {
        return;
      }
      const nextPath = this.joinPath(this.currentPath, nextName);
      this.files.rename(this.serverId, this.selectedEntry.path, nextPath).subscribe({
        next: () => {
          this.loadEntries(this.currentPath);
          this.closeDialog();
        },
        error: () => (this.error = 'Failed to rename entry.')
      });
      return;
    }

    if (this.dialogMode === 'delete') {
      if (!this.selectedEntry) {
        return;
      }
      this.files.remove(this.serverId, this.selectedEntry.path).subscribe({
        next: () => {
          this.selectedEntry = null;
          this.loadEntries(this.currentPath);
          this.closeDialog();
        },
        error: () => (this.error = 'Failed to delete entry.')
      });
    }
  }

  triggerUpload(): void {
    this.uploadInput?.nativeElement.click();
  }

  handleUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.serverId) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? '').split(',')[1] ?? '';
      this.files
        .upload(this.serverId, this.currentPath, file.name, base64)
        .subscribe({
          next: () => this.loadEntries(this.currentPath),
          error: () => (this.error = 'Failed to upload file.')
        });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  download(): void {
    if (!this.serverId || !this.selectedEntry || this.selectedEntry.type !== 'file') {
      return;
    }
    this.files.download(this.serverId, this.selectedEntry.path).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.selectedEntry?.name ?? 'file';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => (this.error = 'Failed to download file.')
    });
  }

  private loadEntries(path: string): void {
    if (!this.serverId) {
      return;
    }
    this.loading = true;
    this.error = '';
    this.currentPath = path;
    this.searchTerm = '';
    this.files.list(this.serverId, path).subscribe({
      next: (response) => {
        this.entries = response.entries;
        this.loading = false;
      },
      error: () => {
        this.error = 'Unable to load files.';
        this.loading = false;
      }
    });
  }

  private loadFile(path: string): void {
    if (!this.serverId) {
      return;
    }
    this.files.read(this.serverId, path).subscribe({
      next: (response) => {
        this.content = response.content;
        const language = this.getLanguage(path);
        this.initEditor(language, this.content);
        if (this.model) {
          this.model.setValue(this.content);
          if (this.monaco) {
            this.monaco.editor.setModelLanguage(this.model, language);
          }
        }
      },
      error: () => (this.error = 'Unable to read file.')
    });
  }

  private initEditor(language: string, value: string): void {
    if (!this.editorHost) {
      return;
    }
    if (this.editor && this.model) {
      return;
    }
    loader.config({
      paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' }
    });
    loader.init().then((monaco) => {
      this.monaco = monaco;
      this.model = monaco.editor.createModel(value, language);
      this.editor = monaco.editor.create(this.editorHost!.nativeElement, {
        model: this.model,
        theme: 'vs-dark',
        minimap: { enabled: false },
        wordWrap: 'on'
      });
    });
  }

  private getLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mapping: Record<string, string> = {
      json: 'json',
      yml: 'yaml',
      yaml: 'yaml',
      properties: 'properties',
      txt: 'plaintext',
      log: 'plaintext',
      mcmeta: 'json',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      xml: 'xml',
      html: 'html',
      js: 'javascript',
      ts: 'typescript',
      css: 'css',
      md: 'markdown'
    };
    return mapping[ext] ?? 'plaintext';
  }

  private joinPath(base: string, name: string): string {
    const trimmed = name.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!base) {
      return trimmed;
    }
    return `${base.replace(/\/+$/, '')}/${trimmed}`;
  }
}

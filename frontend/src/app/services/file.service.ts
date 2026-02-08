import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
};

@Injectable({
  providedIn: 'root'
})
export class FileService {
  constructor(private http: HttpClient) {}

  list(serverId: string, path: string): Observable<{ entries: FileEntry[] }> {
    return this.http.get<{ entries: FileEntry[] }>(this.buildApiUrl(`/servers/${serverId}/files`), {
      params: { path }
    });
  }

  read(serverId: string, path: string): Observable<{ content: string }> {
    return this.http.get<{ content: string }>(
      this.buildApiUrl(`/servers/${serverId}/files/content`),
      {
      params: { path }
      }
    );
  }

  save(serverId: string, path: string, content: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(this.buildApiUrl(`/servers/${serverId}/files/content`), {
      path,
      content
    });
  }

  createFolder(serverId: string, path: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(this.buildApiUrl(`/servers/${serverId}/files/dir`), {
      path
    });
  }

  rename(serverId: string, from: string, to: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(this.buildApiUrl(`/servers/${serverId}/files/rename`), {
      from,
      to
    });
  }

  remove(serverId: string, path: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(this.buildApiUrl(`/servers/${serverId}/files`), {
      params: { path }
    });
  }

  upload(serverId: string, path: string, name: string, contentBase64: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(this.buildApiUrl(`/servers/${serverId}/files/upload`), {
      path,
      name,
      contentBase64
    });
  }

  download(serverId: string, path: string): Observable<Blob> {
    return this.http.get(this.buildApiUrl(`/servers/${serverId}/files/download`), {
      params: { path },
      responseType: 'blob'
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
}

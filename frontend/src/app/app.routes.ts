import { Routes, CanActivateChildFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { BackupsComponent } from './pages/backups/backups.component';
import { ConsoleComponent } from './pages/console/console.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { FilesComponent } from './pages/files/files.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { ServerSelectComponent } from './pages/server-select/server-select.component';
import { AppShellComponent } from './layout/app-shell.component';
import { AppStateService } from './services/app-state.service';

const requireServerSelection: CanActivateChildFn = () => {
	const appState = inject(AppStateService);
	const router = inject(Router);
	return appState.selectedServerId
		? true
		: router.createUrlTree(['/select']);
};


export const routes: Routes = [
	{ path: '', redirectTo: 'select', pathMatch: 'full' },
	{ path: 'select', component: ServerSelectComponent },
	{
		path: 'app',
		component: AppShellComponent,
		canActivateChild: [requireServerSelection],
		children: [
			{ path: '', component: DashboardComponent },
			{ path: 'console', component: ConsoleComponent },
			{ path: 'files', component: FilesComponent },
			{ path: 'backups', component: BackupsComponent },
			{ path: 'settings', component: SettingsComponent }
		]
	},
	{ path: '**', redirectTo: 'select' }
];

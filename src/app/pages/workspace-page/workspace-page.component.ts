import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { PermissionKey } from '../../core/models/auth.models';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-workspace-page',
  templateUrl: './workspace-page.component.html',
  styleUrl: './workspace-page.component.css',
})
export class WorkspacePageComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthService);
  protected readonly title = this.route.snapshot.data['pageTitle'] as string;
  protected readonly description = this.route.snapshot.data['description'] as string;
  private readonly writePermissions = (this.route.snapshot.data['writePermissions'] ??
    []) as PermissionKey[];
  protected readonly canWrite = computed(() =>
    this.writePermissions.some((permission) => this.auth.hasPermission(permission)),
  );
}

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { finalize, forkJoin, map, switchMap } from 'rxjs';

import { availableMenuItems, availableSettingsMenuItems } from '../../../core/config/menu.config';
import { PermissionKey, PERMISSIONS } from '../../../core/models/auth.models';
import { MenuAction, MenuCatalogItem, SettingsRole } from '../../../core/models/settings.models';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { settingsErrorMessage } from '../settings-errors';

const STANDARD_ACTIONS: MenuAction[] = ['view', 'create', 'update', 'delete'];
const OWNER_REQUIRED_PREFIXES = [
  'settings.roles.',
  'settings.users.',
  'settings.menu_permissions.',
];

@Component({
  selector: 'app-menu-permissions',
  imports: [NgTemplateOutlet],
  templateUrl: './menu-permissions.component.html',
  styleUrls: ['../settings.shared.css', './menu-permissions.component.css'],
})
export class MenuPermissionsComponent {
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;
  protected readonly standardActions = STANDARD_ACTIONS;

  protected readonly roles = signal<SettingsRole[]>([]);
  protected readonly catalog = signal<MenuCatalogItem[]>([]);
  protected readonly selectedRoleId = signal('');
  protected readonly selectedPermissions = signal<ReadonlySet<PermissionKey>>(new Set());
  private readonly savedPermissions = signal<ReadonlySet<PermissionKey>>(new Set());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');

  protected readonly selectedRole = computed(
    () => this.roles().find((role) => role.id === this.selectedRoleId()) ?? null,
  );
  protected readonly dirty = computed(
    () =>
      this.permissionSignature(this.selectedPermissions()) !==
      this.permissionSignature(this.savedPermissions()),
  );
  protected readonly mainMenus = computed(() =>
    this.catalog().filter((item) => !item.key.startsWith('settings.')),
  );
  protected readonly settingsMenus = computed(() =>
    this.catalog().filter((item) => item.key.startsWith('settings.')),
  );
  protected readonly editorLocked = computed(
    () =>
      !this.auth.hasPermission(PERMISSIONS.settingsMenuPermissionsUpdate) ||
      (!!this.selectedRole()?.is_system && this.auth.role() !== 'owner'),
  );

  constructor() {
    this.loadInitialData();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  protected roleChanged(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const nextRoleId = select.value;
    if (this.dirty() && !globalThis.confirm('Discard unsaved permission changes?')) {
      select.value = this.selectedRoleId();
      return;
    }
    this.loadRolePermissions(nextRoleId);
  }

  protected hasAction(item: MenuCatalogItem, action: MenuAction): boolean {
    return item.actions.includes(action);
  }

  protected additionalActions(item: MenuCatalogItem): MenuAction[] {
    return item.actions.filter((action) => !STANDARD_ACTIONS.includes(action));
  }

  protected permissionKey(item: MenuCatalogItem, action: MenuAction): PermissionKey {
    return `${item.key}.${action}` as PermissionKey;
  }

  protected isChecked(item: MenuCatalogItem, action: MenuAction): boolean {
    return this.selectedPermissions().has(this.permissionKey(item, action));
  }

  protected isLocked(item: MenuCatalogItem, action: MenuAction): boolean {
    const key = this.permissionKey(item, action);
    return (
      this.editorLocked() ||
      (this.selectedRole()?.key === 'owner' &&
        OWNER_REQUIRED_PREFIXES.some((prefix) => key.startsWith(prefix)))
    );
  }

  protected toggle(item: MenuCatalogItem, action: MenuAction, checked: boolean): void {
    if (this.isLocked(item, action)) return;
    const next = new Set(this.selectedPermissions());
    const key = this.permissionKey(item, action);
    if (checked) {
      next.add(key);
      if (action !== 'view') next.add(this.permissionKey(item, 'view'));
    } else {
      next.delete(key);
      if (action === 'view') {
        for (const menuAction of item.actions) next.delete(this.permissionKey(item, menuAction));
      }
    }
    this.selectedPermissions.set(next);
    this.successMessage.set('');
  }

  protected cancel(): void {
    this.selectedPermissions.set(new Set(this.savedPermissions()));
    this.successMessage.set('');
  }

  protected save(): void {
    const roleId = this.selectedRoleId();
    if (!roleId || !this.dirty() || this.editorLocked()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    this.settings
      .updateRolePermissions(roleId, {
        permission_keys: [...this.selectedPermissions()].sort(),
      })
      .pipe(
        switchMap((response) => this.auth.refreshCurrentSession().pipe(map(() => response))),
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data, message }) => {
          const accepted = new Set(data.permission_keys);
          this.selectedPermissions.set(accepted);
          this.savedPermissions.set(new Set(accepted));
          this.successMessage.set(message);
          this.leaveRouteIfAccessWasRevoked();
        },
        error: (error) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to update role permissions.')),
      });
  }

  protected actionLabel(action: MenuAction): string {
    return action.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
  }

  private loadInitialData(): void {
    if (!this.auth.hasPermission(PERMISSIONS.settingsRolesView)) return;
    this.loading.set(true);
    forkJoin({
      roles: this.settings.listRoles(1, 100),
      catalog: this.settings.getMenuCatalog(),
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ roles, catalog }) => {
          this.roles.set(roles.data.items);
          this.catalog.set(catalog.data);
          const firstRole = roles.data.items[0];
          if (firstRole) this.loadRolePermissions(firstRole.id);
        },
        error: (error) =>
          this.errorMessage.set(
            settingsErrorMessage(error, 'Unable to load the menu permission catalog.'),
          ),
      });
  }

  private loadRolePermissions(roleId: string): void {
    if (!roleId) return;
    this.loading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.settings
      .getRolePermissions(roleId)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ data }) => {
          this.selectedRoleId.set(roleId);
          const loaded = new Set(data.permission_keys);
          this.selectedPermissions.set(loaded);
          this.savedPermissions.set(new Set(loaded));
        },
        error: (error) =>
          this.errorMessage.set(settingsErrorMessage(error, 'Unable to load role permissions.')),
      });
  }

  private leaveRouteIfAccessWasRevoked(): void {
    if (this.auth.hasPermission(PERMISSIONS.settingsMenuPermissionsView)) return;
    const settingsDestination = availableSettingsMenuItems(this.auth.permissions())[0]?.path;
    const workspaceDestination = availableMenuItems(this.auth.role(), this.auth.permissions()).find(
      (item) => item.path !== '/settings',
    )?.path;
    void this.router.navigateByUrl(settingsDestination ?? workspaceDestination ?? '/access-denied');
  }

  private permissionSignature(permissions: ReadonlySet<PermissionKey>): string {
    return [...permissions].sort().join('|');
  }
}

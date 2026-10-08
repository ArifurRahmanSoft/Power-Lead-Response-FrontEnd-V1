import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { availableSettingsMenuItems } from '../../../core/config/menu.config';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-settings-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './settings-shell.component.html',
  styleUrl: './settings-shell.component.css',
})
export class SettingsShellComponent {
  private readonly auth = inject(AuthService);
  protected readonly items = computed(() => availableSettingsMenuItems(this.auth.permissions()));
}

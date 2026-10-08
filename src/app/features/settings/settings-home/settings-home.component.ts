import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { availableSettingsMenuItems } from '../../../core/config/menu.config';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-settings-home',
  imports: [RouterLink],
  templateUrl: './settings-home.component.html',
  styleUrl: './settings-home.component.css',
})
export class SettingsHomeComponent {
  private readonly auth = inject(AuthService);
  protected readonly items = computed(() => availableSettingsMenuItems(this.auth.permissions()));
}

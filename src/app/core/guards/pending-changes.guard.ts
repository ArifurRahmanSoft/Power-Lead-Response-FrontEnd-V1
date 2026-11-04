import { CanDeactivateFn } from '@angular/router';

export interface PendingChangesAware {
  hasUnsavedChanges(): boolean;
}

export const pendingChangesGuard: CanDeactivateFn<PendingChangesAware> = (component) => {
  if (!component.hasUnsavedChanges() || typeof window === 'undefined') return true;
  return window.confirm('You have unsaved changes. Leave without saving?');
};

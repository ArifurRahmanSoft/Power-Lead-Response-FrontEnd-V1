import { pendingChangesGuard } from './pending-changes.guard';

describe('pendingChangesGuard', () => {
  it('allows clean editors to leave without prompting', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const result = (pendingChangesGuard as Function)(
      { hasUnsavedChanges: () => false },
      null,
      null,
      null,
    );
    expect(result).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('requires confirmation before discarding unsaved template changes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const result = (pendingChangesGuard as Function)(
      { hasUnsavedChanges: () => true },
      null,
      null,
      null,
    );
    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved template changes. Leave without saving?',
    );
    confirm.mockRestore();
  });
});

import { routes } from '../../app.routes';
import { PERMISSIONS } from '../../core/models/auth.models';

describe('task routes', () => {
  const children = routes.find((route) => route.path === '')?.children || [];

  it('provides My Tasks, Today, and Overdue views behind lead-view permission', () => {
    const expected = [
      ['tasks/my', 'mine'],
      ['tasks/today', 'today'],
      ['tasks/overdue', 'overdue'],
    ];
    for (const [path, view] of expected) {
      const route = children.find((candidate) => candidate.path === path);
      expect(route?.data?.['requiredPermissions']).toEqual([PERMISSIONS.leadsView]);
      expect(route?.data?.['taskView']).toBe(view);
    }
  });
});

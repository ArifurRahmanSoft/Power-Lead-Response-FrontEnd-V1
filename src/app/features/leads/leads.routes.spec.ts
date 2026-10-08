import { PERMISSIONS } from '../../core/models/auth.models';
import { routes } from '../../app.routes';

describe('lead routes', () => {
  const workspace = routes.find((route) => route.path === '');
  const children = workspace?.children || [];

  it('declares static new and import routes before the dynamic lead route', () => {
    const paths = children.map((route) => route.path);
    expect(paths.indexOf('leads/new')).toBeLessThan(paths.indexOf('leads/:id'));
    expect(paths.indexOf('leads/import')).toBeLessThan(paths.indexOf('leads/:id'));
    expect(paths.indexOf('leads/:id/edit')).toBeLessThan(paths.indexOf('leads/:id'));
  });

  it('uses Lead menu access for entry screens and action permissions for protected operations', () => {
    const permissionFor = (path: string): unknown =>
      children.find((route) => route.path === path)?.data?.['requiredPermissions'];
    expect(permissionFor('leads')).toEqual([PERMISSIONS.leadsView]);
    expect(permissionFor('leads/new')).toEqual([PERMISSIONS.leadsView]);
    expect(permissionFor('leads/import')).toEqual([PERMISSIONS.leadsImport]);
    expect(permissionFor('leads/:id/edit')).toEqual([PERMISSIONS.leadsUpdate]);
    expect(permissionFor('leads/:id')).toEqual([PERMISSIONS.leadsView]);
  });
});

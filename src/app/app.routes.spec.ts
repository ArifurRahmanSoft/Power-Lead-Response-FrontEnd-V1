import { PERMISSIONS } from './core/models/auth.models';
import { routes } from './app.routes';

describe('customer routes', () => {
  const customerRoutes = routes.find((route) => route.path === '')?.children ?? [];

  it('guards customer create and edit with finalized permissions and unsaved-change protection', () => {
    const create = customerRoutes.find((route) => route.path === 'customers/new');
    const edit = customerRoutes.find((route) => route.path === 'customers/:id/edit');

    expect(create?.data?.['requiredPermissions']).toEqual([PERMISSIONS.customersCreate]);
    expect(create?.canActivate).toHaveLength(1);
    expect(create?.canDeactivate).toHaveLength(1);
    expect(edit?.data?.['requiredPermissions']).toEqual([
      PERMISSIONS.customersView,
      PERMISSIONS.customersUpdate,
    ]);
    expect(edit?.canActivate).toHaveLength(1);
    expect(edit?.canDeactivate).toHaveLength(1);
  });
});

import { routes } from '../../app.routes';
import { PERMISSIONS } from '../../core/models/auth.models';

describe('mail routes', () => {
  const workspace = routes.find((route) => route.path === '');
  const children = workspace?.children || [];

  it('guards Sender Accounts with the backend mail view permission', () => {
    const route = children.find((item) => item.path === 'mail/sender-accounts');
    expect(route?.data?.['requiredPermissions']).toEqual([PERMISSIONS.mailView]);
    expect(route?.canActivate?.length).toBe(1);
  });

  it('redirects the Mail parent route to Sender Accounts', () => {
    const route = children.find((item) => item.path === 'mail');
    expect(route?.redirectTo).toBe('mail/sender-accounts');
  });

  it('guards template screens with backend template permissions', () => {
    const list = children.find((item) => item.path === 'mail/templates');
    const create = children.find((item) => item.path === 'mail/templates/new');
    const edit = children.find((item) => item.path === 'mail/templates/:id/edit');
    expect(list?.data?.['requiredPermissions']).toEqual([PERMISSIONS.mailTemplatesView]);
    expect(create?.data?.['requiredPermissions']).toEqual([PERMISSIONS.mailTemplatesManage]);
    expect(edit?.data?.['requiredPermissions']).toEqual([PERMISSIONS.mailTemplatesManage]);
    expect(list?.canDeactivate?.length).toBe(1);
    expect(create?.canDeactivate?.length).toBe(1);
  });
});

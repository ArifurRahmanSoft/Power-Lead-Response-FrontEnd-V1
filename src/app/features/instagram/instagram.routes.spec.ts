import { routes } from '../../app.routes';
import { PERMISSIONS } from '../../core/models/auth.models';

describe('Instagram routes', () => {
  const workspace = routes.find((route) => route.path === '');
  const children = workspace?.children || [];

  it('guards the inbox with messages.view and keeps it under Messages', () => {
    const route = children.find((item) => item.path === 'messages/instagram');
    expect(route?.data?.['requiredPermissions']).toEqual([PERMISSIONS.messagesView]);
    expect(route?.canActivate?.length).toBe(1);
    expect(children.some((item) => item.path === 'instagram')).toBe(false);
  });
});

import { routes } from '../../app.routes';
import { PERMISSIONS } from '../../core/models/auth.models';

describe('WhatsApp routes', () => {
  const workspace = routes.find((route) => route.path === '');
  const children = workspace?.children || [];

  it('guards the inbox with the exact backend view permission', () => {
    const route = children.find((item) => item.path === 'messages/whatsapp');
    expect(route?.data?.['requiredPermissions']).toEqual([PERMISSIONS.messagesView]);
    expect(route?.canActivate?.length).toBe(1);
  });

  it('keeps Messages as an extensible parent route', () => {
    const route = children.find((item) => item.path === 'messages');
    expect(route?.redirectTo).toBe('messages/whatsapp');
  });
});

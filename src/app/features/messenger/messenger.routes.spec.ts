import { routes } from '../../app.routes';
import { PERMISSIONS } from '../../core/models/auth.models';

describe('Messenger routes', () => {
  const workspace = routes.find((route) => route.path === '');
  const children = workspace?.children || [];

  it('guards the inbox with the backend messages view permission', () => {
    const route = children.find((item) => item.path === 'messages/messenger');
    expect(route?.data?.['requiredPermissions']).toEqual([PERMISSIONS.messagesView]);
    expect(route?.canActivate?.length).toBe(1);
  });

  it('keeps Messenger under the existing Messages route', () => {
    const messages = children.find((item) => item.path === 'messages');
    expect(messages?.redirectTo).toBe('messages/whatsapp');
    expect(children.some((item) => item.path === 'messenger')).toBe(false);
  });
});

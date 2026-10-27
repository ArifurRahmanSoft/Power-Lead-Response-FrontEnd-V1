import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'messages/**',
    renderMode: RenderMode.Client,
  },
  {
    path: 'mail/templates/:id/edit',
    renderMode: RenderMode.Client,
  },
  {
    path: 'leads/:id/edit',
    renderMode: RenderMode.Client,
  },
  {
    path: 'leads/:id',
    renderMode: RenderMode.Client,
  },
  {
    path: 'customers/:id',
    renderMode: RenderMode.Client,
  },
  {
    path: 'customers',
    renderMode: RenderMode.Client,
  },
  {
    path: 'tasks/**',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];

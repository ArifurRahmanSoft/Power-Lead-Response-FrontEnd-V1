import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { Lead } from '../../models/lead.models';
import { LeadsService } from '../../services/leads.service';
import { LeadFormPageComponent } from './lead-form-page.component';

const savedLead = { id: 'lead-id' } as Lead;

describe('LeadFormPageComponent navigation', () => {
  function createComponent(
    params: Record<string, string> = {},
    queryParams: Record<string, string> = {},
  ) {
    TestBed.configureTestingModule({
      imports: [LeadFormPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(params),
              queryParamMap: convertToParamMap(queryParams),
            },
          },
        },
        { provide: AuthService, useValue: { hasPermission: () => false } },
        { provide: SettingsService, useValue: {} },
        { provide: LeadsService, useValue: { get: () => NEVER } },
      ],
    });
    return TestBed.createComponent(LeadFormPageComponent).componentInstance as unknown as {
      finish(lead: Lead): void;
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('returns a newly created lead to page 1 while preserving list filters', () => {
    const component = createComponent({}, { returnUrl: '/leads?page=4&company=Acme&search=Jane' });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    component.finish(savedLead);

    expect(navigateByUrl).toHaveBeenCalledOnce();
    expect(router.serializeUrl(navigateByUrl.mock.calls[0][0] as UrlTree)).toBe(
      '/leads?page=1&company=Acme&search=Jane',
    );
  });

  it('keeps the existing edit-success destination', () => {
    const component = createComponent({ id: savedLead.id });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.finish(savedLead);

    expect(navigate).toHaveBeenCalledWith(['/leads', savedLead.id], {
      queryParams: { saved: '1' },
    });
  });
});

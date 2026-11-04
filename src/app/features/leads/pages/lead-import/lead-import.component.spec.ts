import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LeadsService } from '../../services/leads.service';
import { LeadImportComponent } from './lead-import.component';

describe('LeadImportComponent contract guidance', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LeadImportComponent],
      providers: [provideRouter([]), { provide: LeadsService, useValue: {} }],
    });
  });

  it('offers the current backend mapping fields and updated workbook instructions', () => {
    const fixture = TestBed.createComponent(LeadImportComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      canonicalFields: readonly string[];
      addMapping(): void;
    };

    expect(component.canonicalFields).toContain('whatsapp_number');
    expect(component.canonicalFields).toContain('service_requested');
    expect(component.canonicalFields).toContain('priority');
    expect(component.canonicalFields).not.toContain('consent_evidence');
    expect(fixture.nativeElement.textContent).toContain('WhatsApp Number');
    expect(fixture.nativeElement.textContent).toContain('formatted as Text');
    expect(fixture.nativeElement.textContent).toContain('beginning with +');
    expect(fixture.nativeElement.textContent).toContain('older backend-compatible workbooks');

    component.addMapping();
    fixture.detectChanges();
    const options = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.mapping-row option',
      ) as NodeListOf<HTMLOptionElement>,
      (option) => option.textContent?.trim(),
    );
    expect(options).toContain('WhatsApp Number');
    expect(options).toContain('Service requested');
    expect(options).not.toContain('Consent evidence');
  });
});

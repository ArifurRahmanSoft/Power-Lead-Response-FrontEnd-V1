import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import {
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { PERMISSIONS } from '../../../core/models/auth.models';
import { AuthService } from '../../../core/services/auth.service';
import { mailTemplateErrorDetails } from '../mail-template-errors';
import {
  MESSAGE_TEMPLATE_LIMITS,
  MessageTemplate,
  MessageTemplatePlaceholder,
  MessageTemplatePreview,
} from '../models/message-template.models';
import { MessageTemplatesService } from '../services/message-templates.service';

type EditorMode = 'create' | 'view' | 'edit';

function requiredText(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim() ? null : { required: true };
}

function unicodeMaxLength(limit: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    Array.from(String(control.value || '')).length <= limit ? null : { maxlength: { limit } };
}

@Component({
  selector: 'app-message-template-manager',
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './message-template-manager.component.html',
  styleUrl: './message-template-manager.component.css',
})
export class MessageTemplateManagerComponent {
  @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('bodyInput') private bodyInput?: ElementRef<HTMLTextAreaElement>;

  private readonly templates = inject(MessageTemplatesService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly permissions = PERMISSIONS;
  protected readonly limits = MESSAGE_TEMPLATE_LIMITS;

  protected readonly items = signal<MessageTemplate[]>([]);
  protected readonly placeholders = signal<MessageTemplatePlaceholder[]>([]);
  protected readonly placeholdersError = signal('');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly previewing = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly backendFields = signal<Readonly<Record<string, string>>>({});
  protected readonly backendUnknownVariables = signal<readonly string[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pageSize = 20;
  protected readonly editorMode = signal<EditorMode | null>(null);
  protected readonly selected = signal<MessageTemplate | null>(null);
  protected readonly preview = signal<MessageTemplatePreview | null>(null);
  private readonly formRevision = signal(0);
  private readonly refresh = new Subject<void>();

  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );
  protected readonly bodyCharacterCount = computed(() => {
    this.formRevision();
    return Array.from(this.editorForm.controls.body.value).length;
  });
  protected readonly nameCharacterCount = computed(() => {
    this.formRevision();
    return Array.from(this.editorForm.controls.name.value).length;
  });
  protected readonly unknownVariables = computed(() => {
    this.formRevision();
    const body = this.editorForm.controls.body.value;
    const allowed = new Set(this.placeholders().map((placeholder) => placeholder.key));
    const unknown = new Set<string>();
    for (const match of body.matchAll(/{{(.*?)}}/gs)) {
      const key = match[1].trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !allowed.has(key))
        unknown.add(key || 'malformed');
    }
    const withoutTokens = body.replace(/{{(.*?)}}/gs, '');
    if (withoutTokens.includes('{{') || withoutTokens.includes('}}')) unknown.add('malformed');
    return [...new Set([...unknown, ...this.backendUnknownVariables()])].sort();
  });

  protected readonly filters = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    includeArchived: new FormControl(false, { nonNullable: true }),
  });
  protected readonly editorForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [requiredText, unicodeMaxLength(MESSAGE_TEMPLATE_LIMITS.name)],
    }),
    body: new FormControl('', {
      nonNullable: true,
      validators: [requiredText, unicodeMaxLength(MESSAGE_TEMPLATE_LIMITS.body)],
    }),
  });
  protected readonly variableSelection = new FormControl('', { nonNullable: true });

  constructor() {
    this.refresh
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading.set(true);
          this.errorMessage.set('');
          const value = this.filters.getRawValue();
          return this.templates
            .list(this.page(), this.pageSize, {
              search: value.search,
              includeArchived: value.includeArchived,
            })
            .pipe(
              map(({ data }) => ({ data, error: '' })),
              catchError((error) =>
                of({
                  data: null,
                  error: mailTemplateErrorDetails(error, 'Unable to load message templates.')
                    .message,
                }),
              ),
              finalize(() => this.loading.set(false)),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ data, error }) => {
        if (data) {
          this.items.set(data.items);
          this.page.set(data.page);
          this.total.set(data.total);
        } else this.errorMessage.set(error);
      });

    this.templates
      .placeholders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => this.placeholders.set(data),
        error: (error) =>
          this.placeholdersError.set(
            mailTemplateErrorDetails(error, 'Unable to load the variable allowlist.').message,
          ),
      });

    this.filters.controls.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.filters.controls.includeArchived.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyFilters());
    this.editorForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formRevision.update((revision) => revision + 1);
      this.backendFields.set({});
      this.backendUnknownVariables.set([]);
      this.preview.set(null);
    });
  }

  public hasUnsavedChanges(): boolean {
    return this.editorMode() !== 'view' && this.editorForm.dirty;
  }

  public openCreate(): void {
    if (!this.auth.hasPermission(PERMISSIONS.mailTemplatesManage)) return;
    this.openEditor('create', null);
  }

  protected openView(template: MessageTemplate): void {
    this.openEditor('view', template);
  }

  protected openEdit(template: MessageTemplate): void {
    if (template.archived || !this.auth.hasPermission(PERMISSIONS.mailTemplatesManage)) return;
    this.openEditor('edit', template);
  }

  protected closeEditor(): void {
    if (
      this.hasUnsavedChanges() &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved message template changes?')
    )
      return;
    this.editorMode.set(null);
    this.selected.set(null);
    this.preview.set(null);
  }

  protected insertVariable(): void {
    const key = this.variableSelection.value;
    const textarea = this.bodyInput?.nativeElement;
    if (!key || !textarea || this.editorMode() === 'view') return;
    const token = `{{${key}}}`;
    const value = this.editorForm.controls.body.value;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    this.editorForm.controls.body.setValue(`${value.slice(0, start)}${token}${value.slice(end)}`);
    this.editorForm.controls.body.markAsDirty();
    this.variableSelection.setValue('', { emitEvent: false });
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  protected save(): void {
    if (this.editorMode() === 'view' || this.saving()) return;
    this.editorForm.markAllAsTouched();
    if (this.editorForm.invalid || this.unknownVariables().length) return;
    const value = this.editorForm.getRawValue();
    const request = { name: value.name, body: value.body };
    const current = this.selected();
    this.saving.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    const operation = current
      ? this.templates.update(current.id, request)
      : this.templates.create(request);
    operation.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: ({ message, data }) => {
        this.notice.set(message || `“${data.name}” was saved.`);
        this.editorForm.markAsPristine();
        this.editorMode.set(null);
        this.selected.set(null);
        this.refresh.next();
      },
      error: (error) => this.applyError(error, 'Unable to save the message template.'),
    });
  }

  protected loadPreview(): void {
    const template = this.selected();
    if (!template || this.editorForm.dirty || this.previewing()) return;
    this.previewing.set(true);
    this.preview.set(null);
    this.templates
      .preview(template.id)
      .pipe(finalize(() => this.previewing.set(false)))
      .subscribe({
        next: ({ data }) => this.preview.set(data),
        error: (error) => this.applyError(error, 'Unable to preview the message template.'),
      });
  }

  protected archive(template: MessageTemplate): void {
    if (
      template.archived ||
      !this.auth.hasPermission(PERMISSIONS.mailTemplatesManage) ||
      !window.confirm(`Archive “${template.name}”?`)
    )
      return;
    this.busyId.set(template.id);
    this.errorMessage.set('');
    this.templates
      .archive(template.id)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe({
        next: ({ message }) => {
          this.notice.set(message);
          this.refresh.next();
        },
        error: (error) => this.applyError(error, 'Unable to archive the message template.'),
      });
  }

  protected clearFilters(): void {
    this.filters.reset({ search: '', includeArchived: false }, { emitEvent: false });
    this.applyFilters();
  }

  protected goToPage(page: number): void {
    if (page < 1 || page > this.pageCount() || page === this.page()) return;
    this.page.set(page);
    this.refresh.next();
  }

  protected bodySnippet(body: string): string {
    const compact = body.replace(/\s+/g, ' ').trim();
    return compact.length > 100 ? `${compact.slice(0, 100)}…` : compact;
  }

  protected fieldError(field: 'name' | 'body'): string {
    const backend = this.backendFields()[field];
    if (backend) return backend.replace(/^Value error, /, '');
    const control = this.editorForm.controls[field];
    if (!control.touched) return '';
    if (control.hasError('required'))
      return field === 'name' ? 'Template Name is required.' : 'Message Body is required.';
    if (control.hasError('maxlength'))
      return field === 'name'
        ? `Template Name must be at most ${this.limits.name} characters.`
        : `Message Body must be at most ${this.limits.body.toLocaleString()} characters.`;
    return '';
  }

  private applyFilters(): void {
    this.page.set(1);
    this.refresh.next();
  }

  private openEditor(mode: EditorMode, template: MessageTemplate | null): void {
    this.editorMode.set(mode);
    this.selected.set(template);
    this.preview.set(null);
    this.errorMessage.set('');
    this.backendFields.set({});
    this.backendUnknownVariables.set([]);
    this.editorForm.enable({ emitEvent: false });
    this.editorForm.setValue(
      { name: template?.name || '', body: template?.body || '' },
      { emitEvent: false },
    );
    this.editorForm.markAsPristine();
    this.editorForm.markAsUntouched();
    if (mode === 'view') this.editorForm.disable({ emitEvent: false });
    this.formRevision.update((revision) => revision + 1);
    setTimeout(() => this.nameInput?.nativeElement.focus());
  }

  private applyError(error: unknown, fallback: string): void {
    const details = mailTemplateErrorDetails(error, fallback);
    this.errorMessage.set(details.message);
    this.backendFields.set(details.fields);
    this.backendUnknownVariables.set(details.unknownPlaceholders);
  }
}

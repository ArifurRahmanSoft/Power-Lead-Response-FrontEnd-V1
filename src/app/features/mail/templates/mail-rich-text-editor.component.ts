import { Component, Input, OnDestroy, forwardRef } from '@angular/core';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { Editor, NgxEditorComponent, NgxEditorMenuComponent, Toolbar } from 'ngx-editor';
import { marks, nodes } from 'ngx-editor/schema';
import { NodeSpec, Schema } from 'prosemirror-model';

const assetImage: NodeSpec = {
  inline: true,
  group: 'inline',
  draggable: true,
  attrs: {
    src: { default: null },
    assetId: { default: null },
    alt: { default: '' },
    title: { default: null },
    width: { default: null },
  },
  parseDOM: [
    {
      tag: 'img',
      getAttrs: (dom) => ({
        src: dom.getAttribute('src'),
        assetId: dom.getAttribute('data-asset-id'),
        alt: dom.getAttribute('alt') || '',
        title: dom.getAttribute('title'),
        width: dom.getAttribute('width'),
      }),
    },
  ],
  toDOM: (node) => [
    'img',
    {
      src: node.attrs['src'],
      'data-asset-id': node.attrs['assetId'],
      alt: node.attrs['alt'],
      title: node.attrs['title'],
      width: node.attrs['width'],
    },
  ],
};

const mailTemplateSchema = new Schema({
  nodes: { ...nodes, image: assetImage },
  marks,
});

@Component({
  selector: 'app-mail-rich-text-editor',
  imports: [FormsModule, NgxEditorComponent, NgxEditorMenuComponent],
  templateUrl: './mail-rich-text-editor.component.html',
  styleUrl: './mail-rich-text-editor.component.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MailRichTextEditorComponent),
      multi: true,
    },
  ],
})
export class MailRichTextEditorComponent implements ControlValueAccessor, OnDestroy {
  @Input({ required: true }) label = '';
  @Input() editorId = '';
  @Input() placeholder = '';

  protected readonly editor = new Editor({
    schema: mailTemplateSchema,
    features: { resizeImage: true },
  });
  protected readonly toolbar: Toolbar = [
    ['bold', 'italic', 'underline', 'text_color'],
    ['ordered_list', 'bullet_list'],
    ['align_left', 'align_center', 'align_right', 'align_justify'],
    [{ link: { showOpenInNewTab: false } }],
    ['undo', 'redo'],
  ];
  protected html = '';
  protected disabled = false;
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.html = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  protected changed(value: string): void {
    this.html = value;
    this.onChange(value);
  }

  protected touched(): void {
    this.onTouched();
  }

  insertVariable(key: string): void {
    this.editor.commands.insertText(`{{${key}}}`).focus().exec();
  }

  insertAsset(assetId: string, source: string, alt: string, width: string | null): void {
    const safeAlt = escapeAttribute(alt);
    const widthAttribute = width ? ` width="${escapeAttribute(width)}"` : '';
    this.editor.commands
      .insertHTML(
        `<img src="${escapeAttribute(source)}" data-asset-id="${escapeAttribute(assetId)}" alt="${safeAlt}"${widthAttribute}>`,
      )
      .focus()
      .exec();
  }

  focus(): void {
    this.editor.commands.focus().exec();
  }

  ngOnDestroy(): void {
    this.editor.destroy();
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

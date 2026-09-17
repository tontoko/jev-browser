// Bundled once for evaluation in a frame. It contains no model-generated code.
import { computeAccessibleName, getRole, isInaccessible } from 'dom-accessibility-api';

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
function inert(el: Element): boolean {
  if (el.closest('[inert]')) return true;
  const root = el.getRootNode();
  return root instanceof ShadowRoot && inert(root.host);
}
const visible = (el: Element) => !inert(el) && !isInaccessible(el) && el.getClientRects().length > 0;
const editableHost = (el: Element) => el instanceof HTMLElement && el.isContentEditable && !(el.parentElement instanceof HTMLElement && el.parentElement.isContentEditable);
function context(el: Element): string {
  const definition = el.closest('dd');
  const term = definition?.previousElementSibling;
  if (term?.tagName === 'DT') return normalize(`${(term as HTMLElement).innerText} ${(definition as HTMLElement).innerText}`).slice(0, 500);
  const group = el.closest('tr,[role="row"],li,[role="listitem"]')
    ?? el.closest('fieldset,form,article,section,[role="dialog"]') ?? el.parentElement;
  return normalize((group as HTMLElement | null)?.innerText).slice(0, 500);
}
function isFillable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || editableHost(el)) return true;
  return el instanceof HTMLInputElement && !['button','checkbox','color','file','hidden','image','radio','range','reset','submit'].includes(el.type);
}
/** Preserve native and ARIA tri-state values instead of inventing a boolean. */
export function checkedState(el: Element): boolean | 'mixed' | undefined {
  if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type))
    return el.type === 'checkbox' && el.indeterminate ? 'mixed' : el.checked;
  const value = el.getAttribute('aria-checked');
  return value === 'mixed' ? 'mixed' : value === 'true' ? true : value === 'false' ? false : undefined;
}
export function describe(el: Element) {
  const input = el as HTMLInputElement;
  const role = getRole(el) ?? (editableHost(el) ? 'textbox' : '');
  const options = el instanceof HTMLSelectElement ? Array.from(el.options).map((o, index) => ({
    index,
    label: normalize(o.label), value: o.value, selected: o.selected,
    disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled),
  })) : undefined;
  const info = {
    role,
    name: normalize(computeAccessibleName(el)),
    context: context(el),
    tag: el.tagName.toLowerCase(),
    inputType: el instanceof HTMLInputElement ? input.type : '',
    disabled: el.matches(':disabled,[aria-disabled="true"]'),
    readOnly: el.matches('[readonly],[aria-readonly="true"]'),
    fillable: isFillable(el),
    ...(['checkbox', 'radio', 'switch'].includes(role) ? { checked: checkedState(el) } : {}),
    ...(isFillable(el)
      ? { filled: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.length > 0 : normalize(el.textContent).length > 0 } : {}),
    ...(options ? { options, multiple: (el as HTMLSelectElement).multiple } : {}),
  };
  // Exclude mutable input values and unrelated layout; include row identity and actual destinations.
  const signature = JSON.stringify([info.role, info.name, info.context, info.tag, info.inputType,
    el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href'), el.getAttribute('formaction'), (el as HTMLButtonElement).form?.action,
    info.multiple, info.options?.map(o => [o.label, o.value, o.disabled, ...(info.multiple ? [o.selected] : [])]), info.disabled, info.readOnly, info.fillable]);
  return { info, signature, connected: el.isConnected, visible: visible(el) };
}
const actionableRoles = new Set(['button','link','textbox','searchbox','checkbox','radio','switch','combobox','listbox','menuitem','menuitemcheckbox','menuitemradio','tab','option']);
export function observe(options: { maxElements: number; maxTexts: number }, scopedRoots?: Element[]) {
  const nodes: Element[] = [];
  const elements: ReturnType<typeof describe>[] = [];
  const texts: { text: string; context: string; role: string; value?: boolean }[] = [];
  let truncatedElements = false, truncatedTexts = false, scanned = 0;
  const roots: (Element | Document | ShadowRoot)[] = scopedRoots ? [...scopedRoots] : [document];
  const visited = new Set<Element>();
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]!;
    const candidates = root instanceof Element ? [root, ...root.querySelectorAll('*')] : Array.from(root.querySelectorAll('*'));
    for (const el of candidates) {
      if (visited.has(el)) continue;
      visited.add(el);
      if (++scanned > 6000) { truncatedElements = true; truncatedTexts = true; break; }
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','HEAD','META','TITLE','LINK'].includes(el.tagName) || !visible(el)) continue;
      const role = getRole(el) ?? '';
      const editable = el instanceof HTMLElement && el.isContentEditable;
      if (actionableRoles.has(role) || isFillable(el)) {
        if (nodes.length >= options.maxElements) truncatedElements = true;
        else { nodes.push(el); elements.push(describe(el)); }
      }
      // Text candidates are visible semantic leaves, not whole-body blobs or form values.
      if (!['INPUT','TEXTAREA','SELECT','OPTION'].includes(el.tagName) && !editable) {
        const hasOwnText = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && normalize(n.textContent));
        const semanticText = ['heading','cell','rowheader','columnheader','definition','term','status','alert'].includes(role) || ['P','DD','DT','TD','TH','OUTPUT'].includes(el.tagName);
        const text = normalize((el as HTMLElement).innerText ?? el.textContent);
        if ((hasOwnText || semanticText) && text && text.length <= 700 && !el.querySelector('input,textarea,select,[contenteditable="true"]')) {
          if (texts.length >= options.maxTexts) truncatedTexts = true;
          else texts.push({ text, context: context(el), role });
        }
      }
      if (['checkbox','radio','switch'].includes(role)) {
        const d = describe(el);
        if (texts.length >= options.maxTexts) truncatedTexts = true;
        else texts.push({ text: d.info.name, context: d.info.context, role, ...(typeof d.info.checked === 'boolean' ? { value: d.info.checked } : {}) });
      }
    }
    if (scanned > 6000) break;
  }
  return { nodes, elements, texts, truncatedElements, truncatedTexts };
}

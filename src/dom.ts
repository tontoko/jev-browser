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
    fieldName: el.getAttribute('name') ?? '',
    popup: el.getAttribute('aria-haspopup') ?? undefined,
    controls: (el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean),
    expanded: el.getAttribute('aria-expanded') === 'true',
    ...(role === 'option' ? {listboxId:el.closest('[role="listbox"]')?.id} : {}),
    ...('form' in el && (el as HTMLInputElement).form ? {
      formId: `form${Array.from(document.forms).indexOf((el as HTMLInputElement).form!)}`,
      formName: computeAccessibleName((el as HTMLInputElement).form!),
    } : {}),
    required: el.matches('[required],[aria-required="true"]'),
    disabled: el.matches(':disabled,[aria-disabled="true"]'),
    readOnly: el.matches('[readonly],[aria-readonly="true"]'),
    fillable: isFillable(el),
    ...(['checkbox', 'radio', 'switch'].includes(role) ? { checked: checkedState(el) } : {}),
    ...(isFillable(el)
      ? { filled: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.length > 0 : normalize(el.textContent).length > 0 } : {}),
    ...(options ? { options, multiple: (el as HTMLSelectElement).multiple } : {}),
  };
  // Exclude mutable input values and unrelated layout; include row identity and actual destinations.
  const signature = JSON.stringify([info.role, info.name, info.context, info.tag, info.inputType, info.fieldName, info.formName, info.controls, info.listboxId,
    el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href'), el.getAttribute('formaction'), (el as HTMLButtonElement).form?.action,
    info.multiple, info.options?.map(o => [o.label, o.value, o.disabled, ...(info.multiple ? [o.selected] : [])]), info.disabled, info.readOnly, info.fillable]);
  return { info, signature, connected: el.isConnected, visible: visible(el) };
}
/** Fixed read-only browser predicate used for local progress waits, never model-authored. */
export function progressChanged(previous?: string): string | boolean {
  const roots: (Document | ShadowRoot)[] = [document], parts: unknown[] = [location.href];
  let scanned = 0;
  for (const root of roots) for (const el of root.querySelectorAll('*')) {
    if (++scanned > 6000) break;
    if (el.shadowRoot) roots.push(el.shadowRoot);
    if (!el.getClientRects().length) continue;
    if (el.matches('input,textarea,select,button,a,[role="button"],[role="combobox"],[role="option"],[role="checkbox"],[role="switch"],[contenteditable="true"]'))
      parts.push([el.tagName,el.getAttribute('name'),el.getAttribute('aria-label'),el.matches(':disabled'),el.getAttribute('aria-checked'),el instanceof HTMLSelectElement ? Array.from(el.options,o=>[o.value,o.label,o.disabled]) : (el as HTMLElement).innerText]);
    else if (el.matches('h1,h2,h3,[role="status"],[role="alert"],[aria-busy],article,tbody tr,[role="row"]'))
      parts.push([el.tagName,el.getAttribute('role'),el.getAttribute('aria-busy'),(el as HTMLElement).innerText?.slice(0,1000)]);
  }
  const key=JSON.stringify(parts);return previous===undefined?key:key!==previous;
}
const actionableRoles = new Set(['button','link','textbox','searchbox','checkbox','radio','switch','combobox','listbox','menuitem','menuitemcheckbox','menuitemradio','tab','option']);
export function observe(options: { maxElements: number; maxTexts: number }, scopedRoots?: Element[], explicitRecords?: Element[]) {
  const nodes: Element[] = [];
  const elements: ReturnType<typeof describe>[] = [];
  const texts: { text: string; context: string; role: string; value?: boolean; attribute?: string }[] = [];
  const textNodes: Element[] = [];
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
          else { textNodes.push(el); texts.push({ text, context: context(el), role }); }
        }
      }
      if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) {
        if (texts.length >= options.maxTexts) truncatedTexts = true;
        else { textNodes.push(el); texts.push({ text: el.href, context: `${computeAccessibleName(el)} ${context(el)}`, role: 'link', attribute: 'href' }); }
      }
      if (['checkbox','radio','switch'].includes(role)) {
        const d = describe(el);
        if (texts.length >= options.maxTexts) truncatedTexts = true;
        else { textNodes.push(el); texts.push({ text: d.info.name, context: d.info.context, role, ...(typeof d.info.checked === 'boolean' ? { value: d.info.checked } : {}) }); }
      }
    }
    if (scanned > 6000) break;
  }
  const recordNodes = (explicitRecords ?? [...visited].filter(el => el.matches('tbody tr,[role="row"],li,[role="listitem"],article'))).filter(el => visited.has(el) && visible(el));
  const records = recordNodes.map((el, index) => {
    const parent = recordNodes.findIndex(other => other !== el && other.contains(el) && !recordNodes.some(between => between !== other && between !== el && other.contains(between) && between.contains(el)));
    return { index, parent: parent < 0 ? undefined : parent, readOnly: !el.matches('form,input,textarea,select,[contenteditable="true"]') && !el.querySelector('input,textarea,select,[contenteditable="true"]'), context: normalize((el as HTMLElement).innerText).slice(0, 1000), texts: textNodes.flatMap((node, i) => el === node || el.contains(node) ? [i] : []) };
  });
  return { nodes, elements, texts, records, recordInventoryComplete:scanned<=6000, truncatedElements, truncatedTexts, changeKey: String(progressChanged()), busy: !!document.querySelector('[aria-busy="true"]') };
}

/** No global text search: options must belong to the popup declared by this control. */
export function matchingComboboxOptions(element: Element, wanted: string): Element[] {
  if (!element.isConnected) return [];
  const root = element.getRootNode() as Document | ShadowRoot;
  const ids = (element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean);
  const matches = new Set<Element>();
  for (const id of ids) {
    const popup = root.getElementById(id);
    if (!popup || popup.getAttribute('role') !== 'listbox' || !visible(popup)) continue;
    for (const option of popup.querySelectorAll('[role="option"]'))
      if (option.closest('[role="listbox"]') === popup && visible(option) && !option.matches(':disabled,[aria-disabled="true"]') && normalize(computeAccessibleName(option)) === normalize(wanted)) matches.add(option);
  }
  return [...matches];
}

/** A bounded index of real semantic regions, not a guessed selector or a truncated action list. */
export function regionNodes(): Element[] {
  const roots:(Document|ShadowRoot)[]=[document],regions:Element[]=[];
  for(const root of roots){
    for(const node of root.querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
    for(const node of root.querySelectorAll('form,main,nav,section,article,dialog,[role="form"],[role="main"],[role="region"],[role="dialog"],[role="navigation"]'))
      if(visible(node))regions.push(node);
  }
  return regions;
}
export function regionDescription(element:Element){
  const d=describe(element);
  return {...d,info:{...d.info,role:d.info.role||element.tagName.toLowerCase(),name:d.info.name||normalize(element.querySelector('h1,h2,h3,legend')?.textContent)}};
}

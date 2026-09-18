import {BrowserError} from './errors.js';
import {readControl,matchesControl,type InputBinding} from './bindings.js';
import type {Captured,ElementRef} from './observation.js';
import type {GroundedAction,ActResult,OperationContext} from './types.js';

export interface ChoiceHost {
  perform(action:GroundedAction,observed:Captured,value?:string):Promise<ActResult>;
  captureChoice(ref:ElementRef,value:string):Promise<Captured>;
  operation():OperationContext;
}
/** A single bound widget, not a site script: open/filter -> owned option -> verified selection. */
export async function applyCombobox(input:InputBinding,ref:ElementRef,observed:Captured,host:ChoiceHost):Promise<ElementRef> {
  if(typeof input.value!=='string'||!input.value.trim())throw new BrowserError('UNSUPPORTED_INPUT','Combobox selection requires a nonempty option label.');
  const editable=ref.info.fillable&&!ref.info.readOnly;
  const opened=await host.perform({kind:editable?'fill':'click',target:ref.info,valueKey:input.path},observed,editable?input.value:undefined);
  if(opened.status==='dialog')throw new BrowserError('DIALOG_PENDING','A dialog interrupted the combobox interaction; inspect the partial result.');
  const choices=await host.captureChoice(ref,input.value);
  const control=[...choices.refs.values()].find(candidate=>candidate.info.role==='combobox'&&candidate.info.name===ref.info.name);
  if(!control||!await control.handle.evaluate((node,original)=>node===original,ref.handle))throw new BrowserError('STALE_TARGET','The bound combobox changed identity while opening its popup.');
  const options=choices.data.elements.filter(element=>element.role==='option'&&!element.disabled);
  if(options.length!==1)throw new BrowserError('AMBIGUOUS_SELECTION','A unique owned option is required.');
  const result=await host.perform({kind:'click',target:options[0]!,valueKey:input.path,ownerId:control.info.id},choices);
  if(result.status==='dialog')throw new BrowserError('DIALOG_PENDING','A dialog interrupted option selection; inspect the partial result.');
  if(!matchesControl(await readControl(control),input.value)){
    const operation=host.operation();
    try{
      const wait=await control.frame.waitForFunction(({element,wanted})=>{
        const value=element.getAttribute('aria-valuetext')??(element instanceof HTMLInputElement?element.value:(element as HTMLElement).innerText);
        return element.isConnected&&element.getAttribute('aria-expanded')!=='true'&&value===wanted;
      },{element:control.handle,wanted:input.value},{timeout:operation.timeoutMs,signal:operation.signal,polling:50});
      await wait.dispose();
    }catch{operation.signal.throwIfAborted();throw new BrowserError('VALUE_MISMATCH','The combobox did not expose the selected value after the option click.');}
  }
  return control;
}

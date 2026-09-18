import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flattenInputs,inputAction} from '../dist/bindings.js';
for(const [name,values]of [['Date',new Date()],['Map',new Map([['name','A']])],['custom instance',new(class {name='A';})()]])test('bindings: reject a non-JSON root '+name,()=>{
 assert.throws(()=>flattenInputs(values),{code:'UNSUPPORTED_INPUT'});
});
test('bindings: preserve null, false, zero, empty text, absent and scalar arrays distinctly',()=>{
 const source={n:null,flag:false,count:0,text:'',absent:undefined,choices:['A','B'],empty:[]};
 assert.deepEqual(flattenInputs(source).map(({path,value})=>({path,value})),[{path:'/n',value:null},{path:'/flag',value:false},{path:'/count',value:0},{path:'/text',value:''},{path:'/choices',value:['A','B']},{path:'/empty',value:[]}]);
});
test('bindings: JSON Pointer escapes preserve distinct caller keys',()=>{
 assert.deepEqual(flattenInputs({'a.b':'literal',a:{b:'nested'},'a/b':'slash','a~b':'tilde'}).map(input=>input.path),['/a.b','/a/b','/a~1b','/a~0b']);
});
test('bindings: non-finite and unsafe integer inputs cannot be rounded silently',()=>{
 for(const value of [NaN,Infinity,-Infinity,9007199254740992])assert.throws(()=>flattenInputs({value}),{code:'UNSUPPORTED_INPUT'});
});
test('bindings: cycles and arrays of records are rejected before planning',()=>{
 const values={};values.self=values;assert.throws(()=>flattenInputs(values),{code:'UNSUPPORTED_INPUT'});
 assert.throws(()=>flattenInputs({records:[{name:'A'}]}),{code:'UNSUPPORTED_INPUT'});
});

test('bindings: multiselect semantic identity follows DOM order, not caller array order',()=>{
 const input={path:'/choices',label:'choices',value:['C','A'],applied:false,readback:false};
 const target={id:'target',frame:0,role:'combobox',name:'Choices',context:'',tag:'select',inputType:'',disabled:false,readOnly:false,fillable:false,multiple:true,options:[
  {index:0,label:'A',value:'A',selected:false,disabled:false},
  {index:1,label:'B',value:'B',selected:false,disabled:false},
  {index:2,label:'C',value:'C',selected:false,disabled:false},
 ]};
 const action=inputAction(input,target);
 assert.deepEqual(action.action.optionIndices,[0,2]);
 assert.deepEqual(action.expected,[JSON.stringify([0,'A','A']),JSON.stringify([2,'C','C'])]);
});

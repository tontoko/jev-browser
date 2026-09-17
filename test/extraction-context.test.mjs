import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {extractStructured} from '../dist/structured.js';
const snapshot={id:'s',url:'https://example.invalid/',title:'Addresses',elements:[],texts:[{id:'a',frame:0,text:'Alice',context:'Billing name Alice',role:'definition'},{id:'b',frame:0,text:'Bob',context:'Shipping name Bob',role:'definition'}],records:[],truncatedTexts:false,truncatedElements:false,truncated:false,scroll:{y:0,maxY:0,height:720}};
test('structured extraction: identical leaf names retain their full parent path',async()=>{
 const provider={async decide(request){return {answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{const wanted=q.instructions.includes('shipping.name')?'Bob':'Alice';return [id,{choice:Object.entries(q.criteria).find(([,c])=>c?.value===wanted)[0],confidence:1}];}))};}};
 const result=await extractStructured(snapshot,'Read the two address names',z.object({billing:z.object({name:z.string()}),shipping:z.object({name:z.string()})}),()=>provider,new AbortController().signal,250);
 assert.deepEqual(result.data,{billing:{name:'Alice'},shipping:{name:'Bob'}});
});
test('structured extraction: parent schema descriptions reach the leaf question',async()=>{
 const instructions=[];const provider={async decide(request){return{answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{instructions.push(q.instructions);return[id,{choice:Object.entries(q.criteria).find(([,c])=>c?.value==='Alice')[0],confidence:1}];}))};}};
 await extractStructured(snapshot,'Read the name',z.object({a:z.object({name:z.string()}).describe('Billing recipient')}).describe('Address book'),()=>provider,new AbortController().signal,250);
 assert.match(instructions[0],/Billing recipient/);assert.match(instructions[0],/Address book/);assert.match(instructions[0],/a.name/);
});

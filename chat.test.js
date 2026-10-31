'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestion, answerQuestion } = require('./chat');
const { InvoiceStore } = require('./data');
test('four supported question types and read-only rejection', () => {
 assert.equal(parseQuestion('What should I follow up on first?').intent,'priority');
 assert.equal(parseQuestion('Which invoices are outstanding?').intent,'outstanding');
 assert.equal(parseQuestion('What’s the status of invoice INV-1063?').invoiceId,'INV-1063');
 assert.equal(parseQuestion('Show the follow-up history for Northgate').vendor,'Northgate');
 assert.equal(parseQuestion('Show the follow-up history for INV-1042').intent,'history');
 assert.equal(parseQuestion('Mark INV-1063 as paid').intent,'unsupported');
 assert.equal(parseQuestion('Status of INV-1042 and INV-1063').intent,'clarify');
});
test('no demo facts when database unavailable', async () => {
 const result=await answerQuestion(new InvoiceStore({}),'Which invoices are outstanding?');
 assert.equal(result.source,'unavailable');assert.ok(!result.answer.includes('INV-1042'));
});
test('ranking is based on actual supplied amounts and overdue days', async () => {
 const row=(id,amount,days)=>({id,amount,daysOverdue:days,status:'Overdue',vendor:{id:'v1',name:'Vendor'},reminders:[]});
 const result=await answerQuestion({queryChat:async()=>[row('INV-A',100,20),row('INV-B',500,10)]},'What should I follow up on first?');
 assert.ok(result.answer.indexOf('INV-B')<result.answer.indexOf('INV-A'));
 assert.match(result.answer,/amount × days overdue/);
});
test('ambiguous vendor asks for clarification', async () => {
 const result=await answerQuestion({queryChat:async()=>[{vendor:{id:'a',name:'North A'}},{vendor:{id:'b',name:'North B'}}]},'Show history for North');
 assert.match(result.answer,/more than one vendor/);
});
test('unknown invoice never invents details', async () => {
 const result=await answerQuestion({queryChat:async()=>[]},'Status of INV-9999');assert.match(result.answer,/No matching record/);
});

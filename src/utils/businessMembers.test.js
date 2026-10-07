const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('./businessAccess');
function setup() {
  let business={_id:'b',__v:0,phoneNumber:'9000000001',members:[{_id:'member-a',phoneNumber:'9000000002',name:'Surveyor',role:'Surveyor',permissions:policy.fullPermissions()}]};
  let writes=0, collision=false, conflict=false;
  const User={exists:async()=>collision,findOneAndUpdate:async(filter,update)=>{writes++;if(conflict)return null;assert.equal(filter.__v,business.__v);business={...business,...update.$set,__v:business.__v+1};return business;}};
  const context={exports:{},require:name=>name==='mongoose'?{Types:{ObjectId:class{toString(){return 'new-member';}}}}:name==='../models/User'?User:policy};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/businessMembersController.js'),'utf8'),context);
  return {get business(){return business;},get writes(){return writes;},collision:()=>collision=true,conflict:()=>conflict=true,async call(method,body={},id){const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};await context.exports.save({business,method,body,params:{memberId:id}},res);return res;}};
}
const member={name:'Surveyor',phoneNumber:'9000000003',role:'Surveyor',permissions:{survey:{enabled:true}}};
test('adding a member preserves existing members and defaults unspecified grants to disabled',async()=>{
  const s=setup(), existing=s.business.members[0];
  assert.equal((await s.call('POST',member)).statusCode,200);
  assert.equal(s.business.members[0]._id,existing._id);
  assert.deepEqual(s.business.members[0].permissions,policy.fullPermissions());
  assert.equal(s.business.members[1].permissions.quotation.enabled,false);
  assert.equal(s.business.phoneNumber,'9000000001');
});
test('duplicate owner, member and cross-business numbers cannot be saved',async()=>{
  const s=setup();
  for(const phoneNumber of ['9000000001','9000000002']) assert.equal((await s.call('POST',{...member,phoneNumber})).statusCode,409);
  s.collision();assert.equal((await s.call('POST',member)).statusCode,409);assert.equal(s.writes,0);
});
test('removal revokes member login',async()=>{
  const s=setup(), existing=s.business.members[0];
  assert.equal((await s.call('DELETE',{},existing._id)).statusCode,200);
  assert.equal(s.business.members.length,0);
  assert.equal(policy.resolveAccess(s.business,{phoneNumber:existing.phoneNumber}),null);
});
test('invalid input, missing members and simultaneous owner edits are rejected',async()=>{
  const s=setup();
  assert.equal((await s.call('POST',{...member,name:''})).statusCode,400);
  assert.equal((await s.call('DELETE',{},'unknown')).statusCode,404);
  assert.equal(s.writes,0);s.conflict();assert.equal((await s.call('POST',member)).statusCode,409);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fullPermissions, cleanPermissions, resolveAccess, permits, publicBusiness, quotationScope } = require('./businessAccess');
const business = () => ({ _id: 'business-a', name: 'Business', phoneNumber: '9000000001', members: [{_id:'member-a',phoneNumber:'9000000002',name:'Surveyor',role:'Surveyor',permissions:fullPermissions()}], isActive: true });
test('explicit members have independent identities and assigned module permissions', () => {
  const b = business(), member = resolveAccess(b, {phoneNumber:'9000000002'});
  assert.equal(member.isOwner, false);
  assert.notEqual(member.actorId, b._id);
  assert.deepEqual(member.permissions, fullPermissions());
  assert.deepEqual(resolveAccess(b, {phoneNumber:'9000000002'}), member);
  assert.deepEqual(quotationScope(member,'SURVEY_APP'),{user:b._id});
});
test('only primary login is owner, and forged or mismatched member claims are denied', () => {
  const b=business();
  assert.equal(resolveAccess(b,{phoneNumber:b.phoneNumber}).isOwner,true);
  assert.equal(resolveAccess(b,{phoneNumber:b.phoneNumber,memberId:'unknown'}),null);
  assert.equal(resolveAccess(b,{phoneNumber:'9000000009',isOwner:true}),null);
  assert.equal(resolveAccess({...b,isActive:false},{phoneNumber:b.phoneNumber}),null);
});
test('removed and disabled members lose access even with previously valid tokens', () => {
  const b=business();
  const identity={phoneNumber:'9000000002',memberId:b.members[0]._id};
  b.members[0].isActive=false; assert.equal(resolveAccess(b,identity),null);
  b.members=[]; assert.equal(resolveAccess(b,identity),null);
  assert.equal(resolveAccess(b,{phoneNumber:identity.phoneNumber}),null);
});
test('permissions are read live, default closed, and role labels do not confer grants', () => {
  const b=business();
  b.members[0].role='Owner'; b.members[0].permissions={survey:{enabled:true}};
  const access=resolveAccess(b,{phoneNumber:'9000000002',permissions:fullPermissions()});
  assert.equal(permits(access,'SURVEY_APP'),true);
  for(const module of ['QUOTATION_ERP','orderPlacement','orderHistory','inventory']) assert.equal(permits(access,module),false);
  assert.equal(cleanPermissions({orderPlacement:'true'}).orderPlacement,false);
});
test('survey and quotation visibility are independent and always business scoped', () => {
  const b=business();
  b.members[0].permissions={survey:{enabled:true,allQuotations:false},quotation:{enabled:true,allQuotations:true}};
  const access=resolveAccess(b,{phoneNumber:'9000000002'});
  assert.deepEqual(quotationScope(access,'SURVEY_APP'),{user:b._id,createdByActor:access.actorId});
  assert.deepEqual(quotationScope(access,'QUOTATION_ERP'),{user:b._id});
  assert.deepEqual(quotationScope(resolveAccess(b,{phoneNumber:b.phoneNumber}),'QUOTATION_ERP'),{user:b._id});
});
test('member responses exclude partner agreement, wallet and member directory data', () => {
  const b={...business(),paUrl:'private',partnerAgreement:{},virtualAccount:{},whitelistedRemitters:[],adminPermissions:['*']};
  const member=publicBusiness(b,resolveAccess(b,{phoneNumber:'9000000002'}));
  for(const key of ['paUrl','partnerAgreement','virtualAccount','whitelistedRemitters','adminPermissions','members']) assert.equal(key in member,false);
  assert.equal(publicBusiness(b,resolveAccess(b,{phoneNumber:b.phoneNumber})).paUrl,'private');
  assert.equal(b.paUrl,'private');
});
test('independently deployed services use identical access policies', () => {
  const other=path.resolve(__dirname,'../../../backend-quotation/src/utils/businessAccess.js');
  assert.equal(fs.readFileSync(path.join(__dirname,'businessAccess.js'),'utf8'),fs.readFileSync(other,'utf8'));
});

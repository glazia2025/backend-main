const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server');
const express=require('express');
const User=require('../src/models/User');
const isUser=require('../src/middleware/userMiddleware');
const members=require('../src/controllers/businessMembersController');
const {signJwt}=require('../src/utils/jwt');
const Otp=require('../src/models/Otp');
const {fullPermissions,resolveAccess}=require('../src/utils/businessAccess');
let mongo,server,base,business,ownerToken,memberToken;
before(async()=>{
  mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  await mongoose.connect(mongo.getUri('business_members_tests'));await User.init();
  const app=express();app.use(express.json());
  app.post('/verify',require('../src/controllers/authcontroller').verifyOTP);
  app.get('/members',isUser,isUser.ownerOnly,members.list);
  app.post('/members',isUser,isUser.ownerOnly,members.save);
  app.put('/members/:memberId',isUser,isUser.ownerOnly,members.save);
  app.delete('/members/:memberId',isUser,isUser.ownerOnly,members.save);
  app.get('/inventory',isUser,isUser.requireModule('inventory'),(_req,res)=>res.json({ok:true}));
  app.get('/account',isUser,isUser.requireModule('orderPlacement'),require('../src/controllers/paymentController').account);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});
beforeEach(async()=>{
  await User.deleteMany({});
  await Otp.deleteMany({});
  business=await User.create({name:'Business',email:'owner@test.invalid',phoneNumber:'9000000001',members:[{name:'Surveyor',phoneNumber:'9000000002',role:'Surveyor',permissions:fullPermissions()}],paUrl:'agreement-a'});
  ownerToken=signJwt({role:'user',userId:String(business._id),phoneNumber:business.phoneNumber});
  memberToken=signJwt({role:'user',userId:String(business._id),phoneNumber:'9000000002'});
});
async function api(route,method='GET',body,token=ownerToken){const response=await fetch(`${base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
test('OTP login finds only the owner or an explicitly created member',async()=>{
  for (const phone of ['9000000001','9000000002','9000000008']) await Otp.create({phone,otp:'123456'});
  const owner=await api('/verify','POST',{phoneNumber:'9000000001',otp:'123456',accessModule:'MAIN_SITE'});
  assert.equal(owner.status,200);assert.equal(owner.body.existingUser.access.isOwner,true);
  const member=await api('/verify','POST',{phoneNumber:'9000000002',otp:'123456',accessModule:'SURVEY_APP'});
  assert.equal(member.status,200);assert.equal(member.body.existingUser.access.isOwner,false);
  assert.equal(member.body.existingUser.access.actorId,String(business.members[0]._id));
  // Even if an obsolete field remains before cleanup, it never grants login.
  await User.collection.updateOne({_id:business._id},{$set:{phoneNumbers:['9000000008']}});
  const unknown=await api('/verify','POST',{phoneNumber:'9000000008',otp:'123456',accessModule:'MAIN_SITE'});
  assert.equal(unknown.body.userExists,false);assert.equal(unknown.body.token,undefined);
});
test('real member CRUD checks assigned access and revokes tokens immediately',async()=>{
  assert.equal((await api('/members','GET',undefined,memberToken)).status,403);
  assert.equal((await api('/inventory','GET',undefined,memberToken)).status,200);
  const memberRecord=(await api('/members')).body.members[0];
  assert.equal((await api(`/members/${memberRecord._id}`,'PUT',{...memberRecord,permissions:{survey:{enabled:true}}})).status,200);
  assert.equal((await api('/inventory','GET',undefined,memberToken)).status,403);
  assert.equal((await api(`/members/${memberRecord._id}`,'DELETE')).status,200);
  assert.equal(resolveAccess(await User.findById(business._id).lean(),{phoneNumber:'9000000002'}),null);
});
test('phone uniqueness prevents membership spanning businesses',async()=>{
  await User.create({name:'Other',email:'other@test.invalid',phoneNumber:'9000000003',paUrl:'agreement-b'});
  assert.equal((await api('/members','POST',{name:'Duplicate',phoneNumber:'9000000003',role:'Surveyor'})).status,409);
  const added=await api('/members','POST',{name:'New',phoneNumber:'9000000004',role:'Surveyor'});
  assert.equal(added.status,200);assert.equal(added.body.members[1].permissions.inventory,false);
});
test('wallet credit is owner-only while permitted members retain bank instructions',async()=>{
  const payments=require('../src/services/paymentService');
  const original=payments.ensureAccount;
  payments.ensureAccount=async()=>({virtualAccountNo:'TEST-VA',ifscCode:'TEST00001',creditPaise:12000});
  try {
    assert.equal((await api('/account')).body.account.creditPaise,12000);
    const member=await api('/account','GET',undefined,memberToken);
    assert.equal(member.status,200);assert.equal(member.body.account.virtualAccountNo,'TEST-VA');
    assert.equal('creditPaise' in member.body.account,false);
    const memberRecord=(await api('/members')).body.members[0];
    await api(`/members/${memberRecord._id}`,'PUT',{...memberRecord,permissions:{inventory:true}});
    assert.equal((await api('/account','GET',undefined,memberToken)).status,403);
  } finally {payments.ensureAccount=original;}
});
test('obsolete fields and unique index are removed without creating members',async()=>{
  const {removeUnusedLoginFields}=require('../src/utils/removeUnusedLoginFields');
  await User.collection.updateOne({_id:business._id},{$set:{phoneNumbers:['9000000001','9000000008'],membersMigratedAt:new Date()}});
  await User.collection.createIndex({phoneNumbers:1},{unique:true});
  const before=await removeUnusedLoginFields(User.collection);
  assert.equal(before.documents,1);assert.equal(before.mode,'dry-run');
  assert.ok((await User.collection.findOne({_id:business._id})).phoneNumbers);
  await removeUnusedLoginFields(User.collection,{apply:true});
  const after=await User.collection.findOne({_id:business._id});
  assert.equal('phoneNumbers' in after,false);assert.equal('membersMigratedAt' in after,false);
  assert.equal(after.members.length,1);assert.equal(resolveAccess(after,{phoneNumber:'9000000008'}),null);
  assert.equal((await User.collection.indexes()).some(index=>index.key.phoneNumbers),false);
  assert.equal((await removeUnusedLoginFields(User.collection,{apply:true})).documents,0);
  await User.create({name:'Another',email:'another@test.invalid',phoneNumber:'9000000005',paUrl:'agreement-c'});
  await User.create({name:'Third',email:'third@test.invalid',phoneNumber:'9000000006',paUrl:'agreement-d'});
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const policy=require('./businessAccess');
function setup(owner=false) {
  const business={_id:'b',phoneNumber:'9000000001',members:[{_id:'m',phoneNumber:'9000000002',permissions:{inventory:true}}]};
  const claims={role:'user',userId:'b',phoneNumber:owner?'9000000001':'9000000002',memberId:owner?null:'m'};
  const context={module:{exports:{}},require:name=>{
    if(name.includes('authCookies'))return {extractAuthToken:()=> 'token'};
    if(name.endsWith('/jwt'))return {verifyJwt:()=>claims};
    if(name.endsWith('/User'))return {findById:()=>({lean:async()=>business})};
    if(name==='dotenv')return {config(){}};
    return policy;
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../middleware/userMiddleware.js'),'utf8'),context);
  const middleware=context.module.exports;
  return {business,async call(guard,path='/members'){const req={path};const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};let next=false;await middleware(req,res,()=>guard(req,res,()=>next=true));return {next,res};},middleware};
}
test('member-management API is owner-only irrespective of role labels',async()=>{
  const member=setup(),owner=setup(true);
  assert.equal((await member.call(member.middleware.ownerOnly)).res.statusCode,403);
  assert.equal((await owner.call(owner.middleware.ownerOnly)).next,true);
});
test('module APIs allow only live grants and reject removed identities',async()=>{
  const s=setup();assert.equal((await s.call(s.middleware.requireModule('inventory'))).next,true);
  assert.equal((await s.call(s.middleware.requireModule('orderPlacement'))).res.statusCode,403);
  s.business.members=[];assert.equal((await s.call(s.middleware.requireModule('inventory'))).res.statusCode,403);
});
test('owner can administer members while main-site module is disabled',async()=>{
  const s=setup(true);s.business.disabledModules=['MAIN_SITE'];
  assert.equal((await s.call(s.middleware.ownerOnly,'/members/m')).next,true);
  assert.equal((await s.call(s.middleware.requireModule('inventory'),'/inventory')).res.statusCode,403);
});

"use strict";
const assert=require("node:assert/strict");
const label=process.argv[2];
assert.ok(label==="original"||label==="patched");
const {createAuth}=label==="original"?require("../../AUTH_COOKIE_EVIDENCE/original-auth.cjs"):require("../../src/control/auth.js");
const token="synthetic-operator-".repeat(3);
const req=cookie=>({headers:{cookie,host:"synthetic.invalid"},socket:{remoteAddress:"203.0.113.8"}});
function fixture(){
  const auth=createAuth({publicAccessEnabled:true,trustProxy:false,controlPlaneToken:token,haiConnectorToken:"synthetic-hai-".repeat(4),sessionTtlMs:1000},()=>100);
  const session=auth.login(req(""),token);assert.equal(session.ok,true);return {auth,session};
}
const cases=[];
const unknown=["analytics=%ZZ; gcc_session=SESSION","gcc_session=SESSION; analytics=%E0%A4%A","constructor=%ZZ; gcc_session=SESSION","__proto__=%ZZ; gcc_session=SESSION"];
for(const [i,pattern] of unknown.entries())for(const action of ["authenticate","logout"]){
  cases.push([`malformed_unrelated_${i}_${action}`,()=>{
    const {auth,session}=fixture();const header=pattern.replace("SESSION",session.id);
    assert.doesNotThrow(()=>{
      if(action==="authenticate")assert.equal(auth.authenticate(req(header)).mode,"session");
      else {auth.logout(req(header));assert.equal(auth.authenticate(req(`gcc_session=${session.id}`)).authenticated,false);}
    },"malformed unrelated cookie must not throw during session handling");
  }]);
}
for(const malformed of ["%ZZ","%E0%A4%A"])for(const action of ["authenticate","logout"]){
  cases.push([`malformed_session_${malformed}_${action}`,()=>{
    const {auth,session}=fixture();
    assert.doesNotThrow(()=>{
      if(action==="authenticate")assert.equal(auth.authenticate(req(`gcc_session=${malformed}`)).authenticated,false);
      else {auth.logout(req(`gcc_session=${malformed}`));assert.equal(auth.authenticate(req(`gcc_session=${session.id}`)).mode,"session");}
    },"malformed session cookie must fail closed without throwing");
  }]);
}
cases.push(["valid_session",()=>{const {auth,session}=fixture();assert.equal(auth.authenticate(req(`gcc_session=${session.id}`)).mode,"session");}]);
cases.push(["percent_encoded_session",()=>{const {auth,session}=fixture();const encoded=[...session.id].map(c=>"%"+c.charCodeAt(0).toString(16)).join("");assert.equal(auth.authenticate(req(`gcc_session=${encoded}`)).mode,"session");}]);
cases.push(["valid_duplicate_last_wins",()=>{const {auth,session}=fixture();assert.equal(auth.authenticate(req(`gcc_session=wrong; gcc_session=${session.id}`)).mode,"session");assert.equal(auth.authenticate(req(`gcc_session=${session.id}; gcc_session=wrong`)).authenticated,false);}]);
cases.push(["unknown_cookie_no_session",()=>{const {auth}=fixture();assert.equal(auth.authenticate(req("analytics=valid; constructor=valid; __proto__=valid")).authenticated,false);}]);
cases.push(["valid_logout",()=>{const {auth,session}=fixture();auth.logout(req(`gcc_session=${session.id}`));assert.equal(auth.authenticate(req(`gcc_session=${session.id}`)).authenticated,false);}]);
cases.push(["whitespace_and_empty_items",()=>{const {auth,session}=fixture();assert.equal(auth.authenticate(req(` ; ignored ; gcc_session = ${session.id} ; `)).mode,"session");}]);
const rows=[];
for(const [name,run] of cases){try{run();rows.push({name,status:"passed"});}catch(error){rows.push({name,status:"failed",type:error.name,message:error.message});}}
const result={node:process.version,cases:rows.length,passed:rows.filter(r=>r.status==="passed").length,failed:rows.filter(r=>r.status==="failed").length,skipped:0,results:rows};
console.log(JSON.stringify(result));process.exitCode=result.failed?1:0;

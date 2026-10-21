const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
const code=ts.transpileModule(fs.readFileSync('app/verify-access.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
(async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test',alg:'RS256',use:'sig'};
 const mod={exports:{}};let fetches=0;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,crypto,Uint8Array,TextEncoder,TextDecoder,atob,Date,JSON,Array,Set,AbortSignal,fetch:async()=>{fetches++;return {ok:true,json:async()=>({keys:[jwk]})}}});
 const verify=mod.exports.verifyAccessToken,team='https://test.cloudflareaccess.com',aud='test-audience',now=Math.floor(Date.now()/1000);
 const base={iss:team,aud:[aud],iat:now-5,exp:now+300,sub:'authorized-user',email:'3clo1979@gmail.com'};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 async function jwt(claims=base,head={alg:'RS256',kid:'test'}){const data=enc(head)+'.'+enc(claims);const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data));return data+'.'+Buffer.from(sig).toString('base64url')}
 const good=await jwt();assert.equal((await verify(good,team,aud)).email,base.email);
 for(const [label,token,t,a] of [
 ['anonymous',null,team,aud],['unset config',good,'',aud],['wrong issuer',await jwt({...base,iss:'https://evil.cloudflareaccess.com'}),team,aud],['wrong audience',await jwt({...base,aud:['other']}),team,aud],['expired',await jwt({...base,exp:now-1}),team,aud],['future',await jwt({...base,nbf:now+600}),team,aud],['unauthorized email',await jwt({...base,email:'attacker@example.com'}),team,aud],['unsigned',await jwt(base,{alg:'none',kid:'test'}),team,aud],['tampered signature',good.slice(0,good.lastIndexOf('.')+1)+'AAAA',team,aud],['host injection',good,'https://evil.test',aud],['malformed','garbage',team,aud]])assert.equal(await verify(token,t,a),null,label);
 assert.equal(fetches,1,'valid key cache reused; rejected claims never fetch attacker URLs');
 console.log('Access checks passed: signed allowlisted JWT accepted; anonymous, spoofed, expired, wrong issuer/audience and missing config denied.');
})().catch(e=>{console.error(e);process.exit(1)});

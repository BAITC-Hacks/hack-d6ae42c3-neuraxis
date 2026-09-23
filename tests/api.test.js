import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Accounts, ownership, drafts and runs persist through server restart', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qala-api-'));
  const database = path.join(temp, 'test.sqlite');
  const port = 19371;
  let child;
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), DATABASE_PATH: database, OPENAI_API_KEY: '', COOKIE_SECURE: 'false' }, stdio: ['ignore','pipe','pipe'] });
    let logs=''; child.stderr.on('data', b=>logs+=b);
    await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>reject(new Error('Startup timeout: '+logs)),10000);
      child.stdout.on('data',b=>{if(String(b).includes('API ready')){clearTimeout(timeout);resolve();}});
      child.once('error',e=>{clearTimeout(timeout);reject(e);});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exit ${code}: ${logs}`));});
    });
  }
  async function stop() { if(child && child.exitCode === null) { const exited=once(child,'exit');child.kill();await exited; } }
  const client=()=>{
    let cookie='';
    return async (route,body,method='POST')=>{
      const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
      return {status:r.status,data:await r.json(),cookie:set};
    };
  };
  try {
    await start();
    const first=client(),second=client(),guest=client();
    assert.equal((await guest('/api/auth/me')).data.profile,null);
    assert.equal((await guest('/api/account/draft')).status,401);
    const registered=await first('/api/auth/register',{login:'alice',password:'hackathon-pass',nickname:'Алия'});
    assert.equal(registered.status,201);assert.match(registered.cookie,/HttpOnly/);assert.match(registered.cookie,/SameSite=Strict/i);
    const profileId=registered.data.profile.id;
    assert.equal((await second('/api/auth/register',{login:'alice',password:'different-pass',nickname:'Другой'})).status,409);
    await second('/api/auth/register',{login:'bob',password:'another-pass',nickname:'Боб'});
    assert.equal((await second(`/api/profile/${profileId}/runs`)).status,403);
    assert.equal((await guest(`/api/profile/${profileId}`)).status,401);
    assert.equal((await second(`/api/profile/${profileId}`,{nickname:'Подмена'},'PUT')).status,403);
    assert.equal((await first(`/api/profile/${profileId}`,{nickname:'Алия',team:'Neuraxis'},'PUT')).status,200);
    const selectedIds=['bus-priority','schoolyards','inclusive-school','street-light','service-desk'];
    assert.equal((await guest('/api/score',{selectedIds:['mobility-hub','river-park']})).status,400);
    assert.equal((await guest('/api/analyze',{selectedIds:[]})).status,400);
    assert.equal((await guest('/api/score',{selectedIds:['bus-priority','mobility-hub']})).status,400);
    const score=await guest('/api/score',{selectedIds});assert.equal(score.data.cost,850000000);
    const report=await guest('/api/analyze',{selectedIds});assert.equal(report.data.source,'local');
    assert.ok(report.data.risks.join(' ').includes('₸'));
    assert.equal((await first('/api/account/draft',{selectedIds:selectedIds.slice(0,2)},'PUT')).status,200);
    assert.equal((await first('/api/account/draft',{selectedIds:['mobility-hub','river-park']},'PUT')).status,400);
    assert.equal((await second('/api/account/draft')).data,null);
    assert.equal((await second('/api/runs',{profileId,selectedIds,report:report.data})).status,403);
    assert.equal((await first('/api/runs',{profileId,selectedIds,report:report.data})).status,201);
    assert.equal((await first('/api/runs',{profileId,selectedIds:[]})).status,400);
    const s=(await guest('/api/scenario')).data;assert.equal(s.currency,'KZT');assert.ok(s.initiatives.every(i=>i.source.url.startsWith('https://www.gov.kz/')));
    await stop();await start();
    assert.equal((await first('/api/auth/me')).data.profile.team,'Neuraxis');
    assert.deepEqual((await first('/api/account/draft')).data.selectedIds,selectedIds.slice(0,2));
    const runs=(await first(`/api/profile/${profileId}/runs`)).data;assert.equal(runs.length,1);assert.equal(runs[0].spent,850000000);
    await first('/api/auth/logout',{});assert.equal((await first(`/api/profile/${profileId}/runs`)).status,401);
    assert.equal((await first('/api/auth/login',{login:'alice',password:'wrong'})).status,401);
    assert.equal((await first('/api/auth/login',{login:'ALICE',password:'hackathon-pass'})).status,200);
    assert.equal((await first(`/api/profile/${profileId}/runs`)).data.length,1);
    const html=await fetch(`http://127.0.0.1:${port}`);assert.equal(html.status,200);
  } finally {
    await stop();
    for(const name of ['test.sqlite','test.sqlite-wal','test.sqlite-shm']){const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}
    fs.rmdirSync(temp);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';

test('Accounts, ownership, drafts and runs persist through server restart', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qala-api-'));
  const database = path.join(temp, 'test.sqlite');
  const legacyDb = new DatabaseSync(database);
  legacyDb.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, nickname TEXT NOT NULL, team TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE accounts (profile_id TEXT PRIMARY KEY REFERENCES profiles(id), login TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);`);
  legacyDb.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000001', 'Прежний пользователь', '', new Date().toISOString(), new Date().toISOString());
  legacyDb.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000001', 'legacy', 'test-salt', scryptSync('СтарыйПароль123', 'test-salt', 64).toString('hex'));
  legacyDb.close();
  const port = 19371;
  let child;
  async function start() {
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: new URL('..', import.meta.url),
      env: {
        PORT: String(port), DATABASE_PATH: database, OPENAI_API_KEY: '', COOKIE_SECURE: 'false', DEMO_DATA: 'false',
        DOTENV_CONFIG_PATH: path.join(temp, 'missing-test.env'),
      },
      stdio: ['ignore','pipe','pipe'], windowsHide: true,
    });
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
    const legacy = client();
    const oldLogin = await legacy('/api/auth/login', { login: 'legacy', password: 'СтарыйПароль123' });
    assert.equal(oldLogin.status, 200); assert.equal(oldLogin.data.profile.email, null); assert.equal(oldLogin.data.profile.avatar,'city');
    assert.equal((await guest('/api/auth/me')).data.profile,null);
    for (const email of ['безсобаки.kz','a@','@example.kz','a@@example.kz','a@domain','a b@example.kz']) assert.equal((await guest('/api/auth/register',{email,nickname:'Имя',password:'Секрет12345'})).status,400);
    assert.equal((await guest('/api/account/draft')).status,401);
    const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
    const registered=await first('/api/auth/register',{email:'алия@example.kz',password:'СекретныйПароль123',nickname:'Алия',avatar:'mountains',avatarData:photo});
    assert.equal(registered.status,201);assert.match(registered.cookie,/HttpOnly/);assert.match(registered.cookie,/SameSite=Strict/i);
    const profileId=registered.data.profile.id;
    assert.equal(registered.data.profile.role,'citizen');
    const checkPhoto = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/avatars/${profileId}`);
      assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/png');
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'),photo.split(',')[1]);
    };
    await checkPhoto();
    assert.ok(registered.data.profile.avatarUrl.startsWith(`/api/avatars/${profileId}`));
    assert.equal((await guest('/api/auth/register',{email:'KASYMBEK.ZHENYS@AKIM.KZ',nickname:'Аким',password:'Пароль12345',role:'akim'})).status,403);
    assert.equal((await guest('/api/auth/register',{email:'role@example.kz',nickname:'Имя',password:'Пароль12345',role:'admin'})).status,400);
    assert.equal((await guest('/api/auth/register',{email:'image@example.kz',nickname:'Имя',password:'Пароль12345',avatarData:'data:image/png;base64,SGVsbG8='})).status,400);
    const akim=client(),otherAkim=client(),third=client();
    const leader=await akim('/api/auth/register',{email:'simulator@example.kz',nickname:'Аким',password:'Пароль12345',role:'akim'});
    assert.equal(leader.status,201);assert.equal(leader.data.profile.role,'akim');
    const akimId=leader.data.profile.id;
    const otherLeader=await otherAkim('/api/auth/register',{email:'second-akim@example.kz',nickname:'Другой аким',password:'Пароль12345',role:'akim'});
    assert.equal(otherLeader.status,201);
    assert.equal((await third('/api/auth/register',{email:'third@example.kz',nickname:'Азамат',password:'Пароль12345'})).status,201);
    assert.equal(registered.data.profile.avatar,'mountains');
    assert.equal((await first('/api/auth/me')).data.profile.avatar,'mountains');
    assert.equal((await guest('/api/auth/register',{email:'bad-avatar@example.kz',nickname:'Имя',password:'Пароль12345',avatar:'unknown'})).status,400);
    assert.equal((await second('/api/auth/register',{email:'алия@example.kz',password:'different-pass',nickname:'Другой'})).status,409);
    await second('/api/auth/register',{email:'boris@example.kz',password:'another-pass',nickname:'Боб'});
    assert.equal((await second(`/api/profile/${profileId}/runs`)).status,403);
    assert.equal((await guest(`/api/profile/${profileId}`)).status,401);
    assert.equal((await second(`/api/profile/${profileId}`,{nickname:'Подмена'},'PUT')).status,403);
    assert.equal((await first(`/api/profile/${profileId}`,{nickname:'Алия',team:'Neuraxis',avatar:'waves'},'PUT')).status,200);
    assert.equal((await first(`/api/profile/${profileId}`,{nickname:'Алия',team:'Neuraxis',role:'akim'},'PUT')).data.role,'citizen');
    for(const avatarData of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/jpeg;base64,SGVsbG8=', 'x'.repeat(1_400_001)]) {
      assert.equal((await first(`/api/profile/${profileId}`,{nickname:'Алия',avatarData},'PUT')).status,400);
    }
    await checkPhoto();
    const proposal={title:'Убрать мусор во дворе',description:'Предлагаю очистить двор и установить новые контейнеры для мусора.',location:'Астана, улица Кунаева, 10',category:'cleanup'};
    assert.equal((await guest('/api/proposals',proposal)).status,401);
    assert.equal((await akim('/api/proposals',proposal)).status,403);
    assert.equal((await first('/api/proposals',{...proposal,description:'Мало'})).status,400);
    for (const images of [null, 'not-an-array', [null], [photo, 'data:image/png;base64,SGVsbG8='], Array(5).fill(photo)]) {
      assert.equal((await first('/api/proposals',{...proposal,images})).status,400);
    }
    assert.equal((await guest('/api/proposals')).data.total,0);
    const created=await first('/api/proposals',{...proposal,images:Array(4).fill(photo)});
    assert.equal(created.status,201);assert.equal(created.data.author.id,profileId);
    const proposalId=created.data.id;
    assert.equal(created.data.images.length,4);
    const imageUrls=created.data.images.map(image=>image.url);
    const checkProposalPhotos = async () => {
      const details=(await guest(`/api/proposals/${proposalId}`)).data;
      assert.deepEqual(details.images.map(image=>image.url),imageUrls);
      for (const url of imageUrls) {
        const response=await fetch(`http://127.0.0.1:${port}${url}`);
        assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
        assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'),photo.split(',')[1]);
      }
    };
    await checkProposalPhotos();
    assert.equal((await guest('/api/proposal-images/missing')).status,404);
    assert.equal(created.data.author.email,undefined);
    assert.ok(created.data.author.avatarUrl);
    assert.equal((await guest('/api/proposals')).data.items.length,1);
    assert.equal((await guest('/api/proposals?category=transport')).data.total,0);
    assert.equal((await guest('/api/proposals?q='+encodeURIComponent('Кунаева'))).data.total,1);
    assert.equal((await guest(`/api/proposals/${proposalId}/rating`,{value:5},'PUT')).status,401);
    assert.equal((await akim(`/api/proposals/${proposalId}/rating`,{value:5},'PUT')).status,403);
    assert.equal((await first(`/api/proposals/${proposalId}/rating`,{value:5},'PUT')).status,403);
    for(const value of [0,6,1.5,'5',null]) assert.equal((await second(`/api/proposals/${proposalId}/rating`,{value},'PUT')).status,400);
    assert.equal((await second('/api/proposals/missing/rating',{value:5},'PUT')).status,404);
    assert.equal((await second(`/api/proposals/${proposalId}/rating`,{value:5},'PUT')).data.averageRating,5);
    const updatedRating=await second(`/api/proposals/${proposalId}/rating`,{value:3},'PUT');
    assert.equal(updatedRating.data.ratingCount,1);assert.equal(updatedRating.data.myRating,3);
    const aggregate=await third(`/api/proposals/${proposalId}/rating`,{value:4},'PUT');
    assert.equal(aggregate.data.ratingCount,2);assert.equal(aggregate.data.averageRating,3.5);
    const average45=await second(`/api/proposals/${proposalId}/rating`,{value:5},'PUT');
    assert.equal(average45.data.averageRating,4.5);assert.equal(average45.data.ratingCount,2);
    const feed=(await guest('/api/proposals')).data.items[0];
    assert.equal(feed.averageRating,4.5);assert.equal(feed.images.length,4);
    assert.equal((await guest(`/api/proposals/${proposalId}`)).data.myRating,null);
    assert.equal((await guest(`/api/proposals/${proposalId}/comments`,{body:'Поддерживаю'})).status,401);
    assert.equal((await akim(`/api/proposals/${proposalId}/comments`,{body:'Поддерживаю'})).status,403);
    assert.equal((await second(`/api/proposals/${proposalId}/comments`,{body:' '})).status,400);
    const review='Поддерживаю! После дождя мусор разносит по всему двору.';
    assert.equal((await second(`/api/proposals/${proposalId}/comments`,{body:review})).status,201);
    assert.equal((await guest(`/api/proposals/${proposalId}`)).data.commentCount,1);
    const selectedIds=['bus-priority','schoolyards','inclusive-school','street-light','service-desk'];
    const calculatorRequests = id => [
      ['/api/score', {selectedIds}],
      ['/api/analyze', {selectedIds}],
      ['/api/runs', {profileId:id,selectedIds}],
      ['/api/account/draft'],
      ['/api/account/draft', {selectedIds:selectedIds.slice(0,2)}, 'PUT'],
      [`/api/profile/${id}/runs`],
    ];
    for (const [request, id, expectedStatus] of [[guest, akimId, 401], [first, profileId, 403]]) {
      for (const [route, body, method] of calculatorRequests(id)) {
        assert.equal((await request(route,body,method)).status,expectedStatus,route);
        const forgedRoute=body===undefined ? `${route}?role=akim` : route;
        const forgedBody=body===undefined ? undefined : {...body,role:'akim'};
        assert.equal((await request(forgedRoute,forgedBody,method)).status,expectedStatus,`${route} ignores a forged role`);
      }
    }
    assert.equal((await akim('/api/score',{selectedIds:['mobility-hub','river-park']})).status,400);
    assert.equal((await akim('/api/analyze',{selectedIds:[]})).status,400);
    assert.equal((await akim('/api/score',{selectedIds:['bus-priority','mobility-hub']})).status,400);
    const score=await akim('/api/score',{selectedIds});assert.equal(score.status,200);assert.equal(score.data.cost,850000000);
    const report=await akim('/api/analyze',{selectedIds});assert.equal(report.status,200);assert.equal(report.data.source,'local');
    assert.ok(report.data.risks.join(' ').includes('₸'));
    assert.equal((await akim('/api/account/draft',{selectedIds:selectedIds.slice(0,2)},'PUT')).status,200);
    assert.equal((await akim('/api/account/draft',{selectedIds:['mobility-hub','river-park']},'PUT')).status,400);
    assert.equal((await otherAkim('/api/account/draft')).data,null);
    assert.equal((await otherAkim('/api/account/draft',{profileId:akimId,selectedIds},'PUT')).status,403);
    assert.equal((await otherAkim('/api/runs',{profileId:akimId,selectedIds,report:report.data})).status,403);
    assert.equal((await otherAkim(`/api/profile/${akimId}/runs`)).status,403);
    const savedRun=await akim('/api/runs',{profileId:akimId,selectedIds,report:report.data});
    assert.equal(savedRun.status,201);
    assert.equal((await akim('/api/runs',{profileId:akimId,selectedIds:[]})).status,400);
    const s=(await guest('/api/scenario')).data;assert.equal(s.currency,'KZT');assert.ok(s.initiatives.every(i=>i.source.url.startsWith('https://www.gov.kz/')));
    await stop();await start();
    await checkPhoto();
    await checkProposalPhotos();
    assert.equal((await akim('/api/auth/me')).data.profile.role,'akim');
    const persisted=(await second(`/api/proposals/${proposalId}`)).data;
    assert.equal(persisted.title,proposal.title);assert.equal(persisted.ratingCount,2);assert.equal(persisted.averageRating,4.5);assert.equal(persisted.myRating,5);
    const reviews=(await guest(`/api/proposals/${proposalId}/comments`)).data;
    assert.equal(reviews.total,1);assert.equal(reviews.items[0].body,review);assert.equal(reviews.items[0].author.email,undefined);
    assert.equal((await guest('/api/proposals?sort=top')).data.items[0].id,proposalId);
    assert.equal((await guest('/api/auth/register',{email:'kasymbek.zhenys@akim.kz',nickname:'Аким',password:'Пароль12345',role:'citizen'})).status,403);
    assert.equal((await first('/api/auth/me')).data.profile.team,'Neuraxis');
    assert.equal((await first('/api/auth/me')).data.profile.avatar,'waves');
    const withoutPhotos=await first('/api/proposals',proposal);
    assert.equal(withoutPhotos.status,201);assert.deepEqual(withoutPhotos.data.images,[]);
    assert.equal((await first(`/api/profile/${profileId}`,{nickname:'Алия',avatarData:null},'PUT')).data.avatarUrl,null);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/avatars/${profileId}`)).status,404);
    assert.equal((await first(`/api/profile/${profileId}`)).data.avatar,'waves');
    assert.equal((await first(`/api/profile/${profileId}`,{nickname:'Алия',avatar:'invalid'},'PUT')).status,400);
    assert.deepEqual((await akim('/api/account/draft')).data.selectedIds,selectedIds.slice(0,2));
    const runs=(await akim(`/api/profile/${akimId}/runs`)).data;
    assert.equal(runs.length,1);assert.equal(runs[0].spent,850000000);
    assert.equal(runs[0].id,savedRun.data.id);assert.deepEqual(runs[0].selectedIds,selectedIds);assert.deepEqual(runs[0].report,savedRun.data.report);
    assert.equal((await first('/api/account/draft')).status,403);
    assert.equal((await first(`/api/profile/${profileId}/runs`)).status,403);
    await first('/api/auth/logout',{});assert.equal((await first(`/api/profile/${profileId}/runs`)).status,401);
    assert.equal((await first('/api/auth/login',{email:'алия@example.kz',password:'wrong'})).status,401);
    assert.equal((await first('/api/auth/login',{email:'АЛИЯ@example.kz',password:'СекретныйПароль123'})).status,200);
    assert.equal((await first(`/api/profile/${profileId}/runs`)).status,403);
    assert.equal((await first('/api/auth/me')).data.profile.avatar,'waves');
    await akim('/api/auth/logout',{});assert.equal((await akim(`/api/profile/${akimId}/runs`)).status,401);
    assert.equal((await akim('/api/auth/login',{email:'simulator@example.kz',password:'Пароль12345'})).status,200);
    assert.equal((await akim(`/api/profile/${akimId}/runs`)).data.length,1);
    const html=await fetch(`http://127.0.0.1:${port}`);assert.equal(html.status,200);
  } finally {
    await stop();
    for(const name of ['test.sqlite','test.sqlite-wal','test.sqlite-shm']){const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}
    fs.rmdirSync(temp);
  }
});

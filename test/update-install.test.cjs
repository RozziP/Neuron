const test = require('node:test');
const assert = require('node:assert/strict');
const { performUpdateInstall } = require('../app/update-install.cjs');
const { launchUpdateHelper } = require('../app/update-install.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

test('update handoff restores mappings before launch and quit; failures keep the app open', async () => {
  for(const failing of [null,'prepare','restore','launch']) {
    const calls=[];
    const steps=Object.fromEntries(['prepare','restore','launch','quit','recover'].map(name=>[name,async()=>{
      calls.push(name);if(name===failing)throw new Error(name+' failed');
    }]));
    const result=performUpdateInstall(steps);
    if(failing)await assert.rejects(result,new RegExp(failing+' failed'));else await result;
    assert.deepEqual(calls,failing==='prepare'?['prepare']:failing==='restore'?['prepare','restore','recover']:
      failing==='launch'?['prepare','restore','launch','recover']:['prepare','restore','launch','quit']);
  }
});

test('Windows helper waits for the exact parent and verifies bytes before starting a silent restart', {skip:process.platform!=='win32'}, async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'neuron update test-'));
  const marker=path.join(root,'installer-arguments.txt'), resultPath=path.join(root,'result.json');
  const source=path.join(root,'FakeInstaller.cs');
  await fs.writeFile(source,`using System; using System.IO; using System.Reflection;
[assembly: AssemblyInformationalVersion("99.0.0")]
class FakeInstaller { static void Main(string[] args) { File.WriteAllText(Environment.GetEnvironmentVariable("NEURON_UPDATE_TEST_MARKER"), Environment.CommandLine); } }`);
  const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const helperPath=path.join(root,'NeuronUpdater.exe');
  execFileSync(compiler,['/nologo','/target:winexe','/r:System.Web.Extensions.dll',`/out:${helperPath}`,path.resolve(__dirname,'../native/NeuronUpdater.cs')],{windowsHide:true});
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  t.after(async()=>{parent.kill();await fs.rm(root,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{parent.once('spawn',resolve);parent.once('error',reject);});
  const makeRequest=async directory=>{
    await fs.mkdir(directory);
    const file=path.join(directory,'Neuron-Setup-99.0.0-x64.exe');
    execFileSync(compiler,['/nologo','/target:exe',`/out:${file}`,source],{windowsHide:true});
    return {file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex'),version:'99.0.0',
      parentId:parent.pid,appPath:process.execPath,resultPath};
  };
  const options={helperPath,spawnProcess:(command,args,opts)=>{
    return spawn(command,args,{...opts,env:{...process.env,NEURON_UPDATE_TEST_MARKER:marker}});
  }};
  const corrupt=await makeRequest(path.join(root,'corrupt'));
  await assert.rejects(launchUpdateHelper({...corrupt,sha256:'0'.repeat(64)},options),/checksum verification failed/);
  assert.equal(await fs.stat(marker).then(()=>true,()=>false),false);
  assert.equal(parent.exitCode,null);
  const wrongVersion=await makeRequest(path.join(root,'wrong-version'));
  await assert.rejects(launchUpdateHelper({...wrongVersion,version:'98.0.0'},options),/version verification failed/);
  assert.equal(parent.exitCode,null);
  const request=await makeRequest(path.join(root,'valid'));
  const owner=spawn(process.execPath,['-e',`
    const {launchUpdateHelper}=require(process.argv[1]);
    process.on('message',async request=>{try {
      await launchUpdateHelper({...request,parentId:process.pid,appPath:process.execPath},{helperPath:process.argv[2]});
      process.send('ready');
    }catch(error){process.send({error:error.message});}});
  `,path.resolve(__dirname,'../app/update-install.cjs'),helperPath],
    {windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,NEURON_UPDATE_TEST_MARKER:marker}});
  t.after(()=>owner.kill());
  const ready=new Promise((resolve,reject)=>{owner.once('message',msg=>msg==='ready'?resolve():reject(new Error(JSON.stringify(msg))));owner.once('error',reject);});
  owner.send(request);await ready;
  assert.equal(await fs.stat(marker).then(()=>true,()=>false),false,'Installer must not start while parent is alive');
  owner.kill();
  let result;
  for(let i=0;i<100;i++) {
    try {result=JSON.parse((await fs.readFile(resultPath,'utf8')).replace(/^\uFEFF/,''));break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(result?.ok,true,JSON.stringify(result));
  assert.ok((await fs.readFile(marker,'utf8')).endsWith(`/S --updated --force-run /D=${path.dirname(process.execPath)}`));
});

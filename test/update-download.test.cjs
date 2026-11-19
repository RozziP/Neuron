const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { installerAsset, downloadInstaller } = require('../app/update-download.cjs');
const bytes = Buffer.from('installer bytes');
const asset = { name:'Neuron-Setup-0.2.0-x64.exe',state:'uploaded',size:bytes.length,
  browser_download_url:'https://github.com/RozziP/Neuron/releases/download/v0.2.0/Neuron-Setup-0.2.0-x64.exe',
  digest:'sha256:'+createHash('sha256').update(bytes).digest('hex') };
const release = { tag_name:'v0.2.0', assets:[asset] };

test('installer metadata rejects wrong destinations, filenames, sizes, duplicate assets and absent hashes', () => {
  assert.ok(installerAsset(release,'0.2.0'));
  for (const change of [{browser_download_url:'https://evil.example/a.exe'},{name:'other.exe'},
    {size:0},{size:600*1024*1024},{digest:null},{state:'new'}]) {
    assert.equal(installerAsset({...release,assets:[{...asset,...change}]},'0.2.0'),null);
  }
  assert.equal(installerAsset({...release,assets:[asset,asset]},'0.2.0'),null);
});

test('download follows GitHub asset redirects, streams progress and commits only verified bytes', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'neuron-download-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const seen=[], progress=[];
  const result=await downloadInstaller(installerAsset(release,'0.2.0'),root,p=>progress.push(p),{
    fetchDownload:async(url,options)=>{
      seen.push(url);assert.equal(options.redirect,'manual');
      return seen.length===1 ? new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/test'}})
        : new Response(bytes,{headers:{'content-length':String(bytes.length)}});
    }
  });
  assert.equal(seen.length,2);assert.deepEqual(await fs.readFile(result.file),bytes);assert.equal(progress.at(-1),100);
  assert.equal(result.sha256,asset.digest.slice(7));
});

test('interrupted, oversized, truncated, tampered and redirected downloads never leave an executable', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'neuron-download-errors-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const badStreams=[
    ()=>new Response(Buffer.from('tampered bytes!')),
    ()=>new Response(bytes.subarray(0,4)),
    ()=>new Response(Buffer.concat([bytes,bytes])),
    ()=>new Response(bytes,{headers:{'content-length':'1'}}),
    ()=>new Response(null,{status:302,headers:{location:'http://github.com/insecure'}}),
    ()=>new Response(null,{status:302,headers:{location:'https://evil.example/installer.exe'}}),
    ()=>new Response(new ReadableStream({start(controller){controller.error(new Error('connection lost'));}}))
  ];
  for(const response of badStreams) {
    await assert.rejects(downloadInstaller(installerAsset(release,'0.2.0'),root,()=>{},{fetchDownload:async()=>response()}));
    assert.deepEqual(await fs.readdir(root),[]);
  }
});

test('stalled connection and body abort promptly and clean partial files', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'neuron-download-stall-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for (const bodyStarted of [false,true]) {
    const progress=[];
    await assert.rejects(downloadInstaller(installerAsset(release,'0.2.0'),root,(p,detail)=>progress.push(detail),{
      stallTimeoutMs:20,
      fetchDownload:async(_url,{signal})=> {
        if (!bodyStarted) return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
        return new Response(new ReadableStream({start(controller) {
          controller.enqueue(bytes.subarray(0,4));
          signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
        }}));
      }
    }), {name:'TimeoutError'});
    assert.equal(progress[0].received,0);
    if(bodyStarted)assert.equal(progress.at(-1).received,4);
    assert.deepEqual(await fs.readdir(root),[]);
  }
});

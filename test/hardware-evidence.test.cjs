const test = require('node:test');
const assert = require('node:assert/strict');
const { HardwareEvidence } = require('../app/hardware-evidence.cjs');
const { collectReports, normalizeReport, reportFingerprint } = require('../app/hardware-report.cjs');
const records = [[0,1,6],[1,65284,2],[2,1,2]].map(([iface,usagePage,usage]) => ({vendorId:13652,productId:62813,
  product:'2.4G Wireless Receiver',manufacturer:'Compx',release:768,interface:iface,usagePage,usage,path:`PRIVATE-${iface}`}));
const base = () => collectReports(records,{appVersion:'0.1.2',platform:'win32'})[0];
const caps = {inputReportBytes:8,outputReportBytes:0,featureReportBytes:8,linkCollections:1,
  inputButtonCaps:1,inputValueCaps:2,outputButtonCaps:0,outputValueCaps:0,featureButtonCaps:0,featureValueCaps:1};
const candidate = {source:'installed-driver-config',name:'Redragon M990-WL Gaming Mouse',version:'1.0.2.0',vendorId:13652,productId:62813,configuredModelId:48};

test('v2 keeps multiple collection labels and revisions, and canonicalizes enumeration order', async () => {
  const other = {...records[2],product:'Other variant',release:769};
  const a = collectReports([...records,other],{})[0], b = collectReports([other,...records].reverse(),{})[0];
  assert.equal(a.version,2);
  assert.ok(a.interfaces.some(i=>i.product==='Other variant' && i.release===769));
  assert.equal(await reportFingerprint(a),await reportFingerprint(b));
  assert.equal(await reportFingerprint(a),await reportFingerprint({...a,appVersion:'99',osVersion:'new'}));
  assert.notEqual(await reportFingerprint(a),await reportFingerprint(base()));
});

test('identification accepts only matching evidence and strips private/unknown nested fields', () => {
  const result = normalizeReport({...base(),serialNumber:'PRIVATE',identification:{status:'confirmed',serial:'PRIVATE',
    windowsStatus:'complete',softwareStatus:'complete',windows:[{description:'Mouse',instanceId:'PRIVATE',containerId:'PRIVATE',path:'PRIVATE'}],
    software:[{...candidate,path:'PRIVATE',config:'PRIVATE'}, {...candidate,productId:7}, {...candidate,source:'unverified'}]},
    interfaces:base().interfaces.map(i=>({...i,capabilities:{...caps,rawDescriptor:'PRIVATE'},path:'PRIVATE'}))});
  assert.equal(result.identification.status,'unconfirmed');
  assert.deepEqual(result.identification.software,[candidate]);
  assert.deepEqual(result.interfaces[0].capabilities,caps);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(normalizeReport({...result,version:1}).identification,undefined);
  assert.equal(normalizeReport({...result,version:1}).interfaces[0].capabilities,undefined);
  const bad=structuredClone(result);bad.interfaces[0].capabilities.featureReportBytes=-1;
  assert.equal(normalizeReport(bad).interfaces[0].capabilities,null);
});

test('collector reads only descriptors and matching OS evidence, caches locally and retries failures', async () => {
  let runs=0,reads=0,now=0,fail=false;
  const collector=new HardwareEvidence({call:async (method,args)=>{
    assert.equal(method,'hidCapabilities');assert.match(args.path,/^PRIVATE-/);reads++;
    if(fail)throw new Error('private failure');return caps;
  }},{platform:'win32',now:()=>now,run:async (exe,args,options)=>{
    runs++;assert.equal(exe,'powershell.exe');assert.equal(options.windowsHide,true);
    assert.deepEqual(args.slice(-4),['-VendorId','13652','-ProductId','62813']);
    if(fail)throw new Error('PRIVATE failure');
    return {stdout:JSON.stringify({windowsStatus:'complete',softwareStatus:'complete',windows:[],software:[candidate]})};
  }});
  const result=await collector.enrich(base(),records);
  assert.deepEqual(result.identification.software,[candidate]);assert.equal(reads,3);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  await collector.enrich(base(),records);assert.equal(runs,1);
  now=3600001;fail=true;
  const failed=await collector.enrich(base(),records);
  assert.equal(failed.identification.windowsStatus,'unavailable');
  assert.ok(failed.interfaces.every(i=>i.capabilitiesStatus==='unavailable'));
  now+=60001;fail=false;await collector.enrich(base(),records);assert.equal(runs,3);
  await collector.enrich(base(),records.map(d=>({...d,path:d.path+'-replacement'})));assert.equal(runs,4);
});

test('non-Windows collection does not run PowerShell or vendor commands', async () => {
  const collector=new HardwareEvidence({call:()=>{throw new Error('Must not call');}},{platform:'linux',run:()=>{throw new Error('Must not run');}});
  const result=await collector.enrich(base(),records);
  assert.equal(result.identification.windowsStatus,'unavailable');
  assert.equal(result.identification.softwareStatus,'not-supported');
  assert.equal(result.interfaces.length,3);
});

test('shared IDs preserve descriptor variants even with identical labels and sanitized punctuation', async () => {
  const units=[{...records[2],product:'Mouse & Receiver'}, {...records[2],product:'Mouse & Receiver',path:'PRIVATE-second'}];
  const collector=new HardwareEvidence({call:async (_method,{path})=>({...caps,featureReportBytes:path==='PRIVATE-second'?16:8})},
    {platform:'win32',run:async()=>({stdout:'{}'})});
  const result=await collector.enrich(collectReports(units,{})[0],units);
  assert.deepEqual(result.interfaces.map(i=>i.capabilities.featureReportBytes).sort((a,b)=>a-b),[8,16]);
});

test('large Unicode evidence remains transportable without dropping the mouse collection', () => {
  const label='漢'.repeat(100),report=base();
  report.interfaces=Array.from({length:32},(_,i)=>({...report.interfaces[2],interface:i,product:label,manufacturer:label,capabilities:caps}));
  report.identification.windows=Array.from({length:16},(_,i)=>({deviceClass:String(i),description:label,busDescription:label,manufacturer:label,driverProvider:label,driverVersion:label}));
  const result=normalizeReport(report);
  assert.equal(result.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<=30000);
  assert.ok(result.interfaces.some(i=>i.usagePage===1&&i.usage===2));
  assert.deepEqual(normalizeReport(result),result);
});

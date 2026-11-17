const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./store.cjs');
const { collectReports, reportKey, normalizeReport, reportFingerprint, normalizeConfirmation, supportedConfirmation } = require('./hardware-report.cjs');
const { catalog } = require('./catalog.cjs');
const DAY = 86400000;

class HardwareReporter {
  constructor({ directory, endpoint = '', repository, system, enrich = async report => report, onChange = () => {}, fetch = globalThis.fetch, now = Date.now }) {
    this.directory = directory; this.endpoint = endpoint; this.repository = repository;
    this.system = system; this.enrich = enrich; this.fetch = fetch; this.now = now; this.busy = false; this.nextScan = 0;
    this.file = path.join(directory, 'hardware-reporting.json'); this.entries = {};
    this.confirmationFile = path.join(directory,'hardware-identifications.json'); this.confirmations = {};
    this.onChange = onChange; this.current = new Map(); this.reports = new Map(); this.lastPublished = '';
    if (endpoint) {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Hardware reporting requires an HTTPS endpoint.');
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version === 1 && data.endpoint === endpoint && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) this.entries = data.entries;
    } catch { /* Missing or damaged delivery cache can be rebuilt; the server also deduplicates. */ }
    try {
      const data = JSON.parse(fs.readFileSync(this.confirmationFile,'utf8'));
      if (data.version === 1) for (const [key,value] of Object.entries(data.confirmations || {})) {
        try { const confirmation=normalizeConfirmation(value);if(reportKey(confirmation)===key)this.confirmations[key]=confirmation; } catch { }
      }
    } catch { /* Keep detection working if saved confirmations cannot be read. */ }
  }
  persist() { atomicWrite(this.file, { version: 1, endpoint: this.endpoint, entries: this.entries }); }
  observe(records) {
    this.current = new Map(collectReports(records,this.system).map(r=>[reportKey(r),r]));
    for (const d of records) {
      const model = d.vendorId===0x1532 && catalog.find(m=>m.productId===d.productId && m.driver && m.driverValidation!=='best-guess');
      if(model)this.current.set(reportKey(d),{vendorId:d.vendorId,productId:d.productId,model:model.name});
    }
    this.publish();
  }
  summaries() {
    return [...this.current].map(([key,base])=>{
      const report=this.reports.get(key)||base, confirmation=this.confirmations[key], entry=this.entries[key]||{};
      const model=base.vendorId===0x1532 && catalog.find(m=>m.productId===base.productId);
      const candidates=[...new Set([...(model ? ['Razer '+model.name] : []),...(report.identification?.software||[]).map(s=>s.name)])];
      return {key,deviceName:base.model,candidates,confirmedModel:confirmation?.modelName||'',
        supported:Boolean(confirmation && supportedConfirmation(confirmation)), issueUrl:entry.issueUrl||'',
        status:confirmation ? (supportedConfirmation(confirmation) ? entry.resolution || (this.endpoint?'pending':'local-only') : 'driver-needed') : 'unconfirmed'};
    });
  }
  publish() { const next=JSON.stringify(this.summaries());if(next!==this.lastPublished){this.lastPublished=next;this.onChange();} }
  confirm(key, modelName) {
    const device=this.current.get(key);
    if(!device)throw new Error('This mouse is no longer detected. Refresh devices and try again.');
    const confirmation=normalizeConfirmation({version:1,vendorId:device.vendorId,productId:device.productId,modelName});
    const next={...this.confirmations,[key]:confirmation};
    atomicWrite(this.confirmationFile,{version:1,confirmations:next});this.confirmations=next;
    const previous=this.entries[key]||{};
    this.entries[key]={issueUrl:previous.issueUrl, fingerprint:previous.fingerprint};
    this.persist();this.nextScan=0;this.publish();
    return confirmation;
  }
  validIssueUrl(url) {
    const prefix=`https://github.com/${this.repository}/issues/`;
    return typeof url==='string' && url.startsWith(prefix) && /^[1-9][0-9]*$/.test(url.slice(prefix.length));
  }
  async resolveConfirmed() {
    if(!this.endpoint)return;
    for(const [key,confirmation] of Object.entries(this.confirmations)) {
      if(!this.current.has(key)||!supportedConfirmation(confirmation))continue;
      const previous=this.entries[key]||{};
      if(['closed','no-issue','manual-review'].includes(previous.resolution)||previous.nextAttempt>this.now())continue;
      const attempts=Math.min((previous.attempts||0)+1,10);
      this.entries[key]={...previous,resolution:'pending',attempts,nextAttempt:this.now()+Math.min(DAY,60000*2**(attempts-1))};this.persist();
      try {
        const url=new URL(this.endpoint);url.pathname='/hardware-resolution';
        const response=await this.fetch(url.href,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(confirmation),signal:AbortSignal.timeout(15000)});
        const retry=Number(response.headers.get('retry-after'));
        if(Number.isFinite(retry)&&retry>0)this.entries[key].nextAttempt=this.now()+Math.min(7*DAY,Math.max(60000,retry*1000));
        if(response.status===200) {
          const result=await response.json();
          if(result.key!==key||!['closed','no-issue','manual-review'].includes(result.status)||
            (result.status!=='no-issue'&&!this.validIssueUrl(result.issueUrl)))throw new Error('Invalid resolution receipt.');
          // Do not replace a newer local answer while its request was in flight.
          if(this.confirmations[key].modelName===confirmation.modelName)
            this.entries[key]={issueUrl:result.issueUrl||previous.issueUrl,resolution:result.status};
        }
        this.persist();
      } catch { /* Confirmation remains saved and resolution retries automatically. */ }
    }
  }
  async tick(records) {
    this.observe(records);
    if (this.busy || this.now() < this.nextScan) return;
    this.busy = true; this.nextScan = this.now() + 60000;
    try {
      await this.resolveConfirmed();
      for (const base of collectReports(records, this.system)) {
        const key = reportKey(base), previous = this.entries[key] || {};
        if (previous.nextAttempt > this.now()) continue;
        let report = base;
        try { report = normalizeReport(await this.enrich(base, records)); } catch { /* Send the base report when enrichment fails. */ }
        if(this.confirmations[key])report=normalizeReport({...report,identification:{...report.identification,confirmedModel:this.confirmations[key].modelName}});
        this.reports.set(key,report);this.publish();
        const fingerprint = await reportFingerprint(report);
        atomicWrite(path.join(this.directory, 'hardware-reports', key.replace(':','-') + '.json'), report);
        if (previous.issueUrl && previous.fingerprint === fingerprint) continue;
        if (!this.endpoint) continue;
        // Persist backoff before sending, including across crashes and restarts.
        const attempts = Math.min((Number(previous.attempts) || 0) + 1, 10);
        this.entries[key] = { ...previous, attempts, nextAttempt: this.now() + Math.min(DAY, 60000 * 2 ** (attempts - 1)) };
        this.persist();
        try {
          const response = await this.fetch(this.endpoint, { method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(15000) });
          const retry = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retry) && retry > 0) this.entries[key].nextAttempt = this.now() + Math.min(7 * DAY, Math.max(60000, retry * 1000));
          if (response.status === 200 || response.status === 201) {
            const result = await response.json();
            if (result.key !== key || result.fingerprint !== fingerprint || !this.validIssueUrl(result.issueUrl)) throw new Error('Invalid report receipt.');
            this.entries[key] = { issueUrl: result.issueUrl, fingerprint };
          }
          this.persist();
        } catch { /* Offline, timeout, or service failure: retry without affecting mouse controls. */ }
      }
    } finally { this.busy = false; this.publish(); }
  }
}
module.exports = { HardwareReporter };

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseChord } = require('./keys.cjs');

const { topControls, mouseActions, defaultTopBindings, macroTriggers } = require('./controls.cjs');
const defaults = ['1','2','3','4','5','6','7','8','9','0','-','='];
function newProfile(name = 'Default', model = 0x0067, plate = 12) {
  return { id: randomUUID(), name, model, plate, executable: '', bindings: Array.from({ length: plate }, (_, index) => ({ type: 'key', value: defaults[index] })), topBindings: defaultTopBindings(), macros: [] };
}
function validateProfile(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(p.id)) throw new Error('Invalid profile ID.');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) throw new Error('Profile name must be 1–60 characters.');
  if (!Number.isInteger(p.model) || p.model < 0 || p.model > 65535 || ![2,6,7,12].includes(p.plate)) throw new Error('Invalid device or side plate.');
  if (typeof p.executable !== 'string' || (p.executable && !/^[^<>:"/\\|?*\x00-\x1f]{1,100}\.exe$/i.test(p.executable))) throw new Error('Use an executable name, such as Wow.exe.');
  if (!Array.isArray(p.macros) || p.macros.length > 5000) throw new Error('Too many macros.');
  const ids = new Set();
  const macros = p.macros.map(m => {
    if (!m || typeof m.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(m.id) || ids.has(m.id)) throw new Error('Invalid or duplicate macro ID.');
    ids.add(m.id);
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) throw new Error('Give each macro a name (1–60 characters).');
    if (!Number.isInteger(m.repeat) || m.repeat < 1 || m.repeat > 20 || !Array.isArray(m.steps) || m.steps.length < 1 || m.steps.length > 100) throw new Error('Macros need 1–100 steps and 1–20 repeats.');
    let duration = 0;
    const steps = m.steps.map(s => {
      if (s.type === 'delay') {
        if (!Number.isInteger(s.ms) || s.ms < 10 || s.ms > 10000) throw new Error('Delays must be 10–10,000 ms.');
        duration += s.ms; return { type: 'delay', ms: s.ms };
      }
      if (s.type !== 'key') throw new Error('Unsupported macro step.');
      const chord = parseChord(s.value);
      if (chord.hid >= 0x68 && chord.hid <= 0x73) throw new Error('F13–F24 are reserved for macro triggers.');
      duration += 15; return { type: 'key', value: s.value.trim() };
    });
    if (duration * m.repeat > 120000) throw new Error('A macro may run for at most two minutes.');
    return { id: m.id, name: m.name.trim(), repeat: m.repeat, steps };
  });
  if (!Array.isArray(p.bindings) || p.bindings.length !== p.plate) throw new Error('Button count does not match the side plate.');
  const validateBinding = (b, top = false) => {
    if (b.type === 'key') { parseChord(b.value); return { type: 'key', value: b.value.trim() }; }
    if (b.type === 'macro' && ids.has(b.value)) return { type: 'macro', value: b.value };
    if (b.type === 'mouse' && Object.hasOwn(mouseActions,b.value)) return {type:'mouse',value:b.value};
    if (top && b.type === 'default') return {type:'default',value:''};
    if (b.type === 'disabled') return { type: 'disabled', value: '' };
    throw new Error('Every macro binding must reference an existing macro.');
  };
  const bindings = p.bindings.map(b=>validateBinding(b));
  if (p.topBindings !== undefined && (!p.topBindings || typeof p.topBindings !== 'object' || Array.isArray(p.topBindings) || Object.keys(p.topBindings).some(id=>!topControls.some(c=>c.id===id)))) throw new Error('Invalid top-button bindings.');
  const topBindings = Object.fromEntries(topControls.map(c=>[c.id,validateBinding(p.topBindings?.[c.id] || {type:'default'},true)]));
  if (topBindings.left.type !== 'default' && ![...bindings,...Object.values(topBindings)].some(b=>b.type==='mouse' && b.value==='left')) throw new Error('Assign Left click to another button before rebinding the primary click.');
  const executablePath = p.executablePath || '', gameId = p.gameId || '', gameName = p.gameName || '';
  if (typeof executablePath !== 'string' || (executablePath && (!path.win32.isAbsolute(executablePath) || !/\.exe$/i.test(executablePath) || path.win32.basename(executablePath).toLowerCase() !== p.executable.toLowerCase()))) throw new Error('Choose a valid game executable path.');
  if (typeof gameId !== 'string' || !/^[a-z0-9-]{0,80}$/i.test(gameId) || typeof gameName !== 'string' || gameName.length > 200 || (gameId && (!gameName || !executablePath))) throw new Error('Invalid game association.');
  const profile = { id: p.id, name: p.name.trim(), model: p.model, plate: p.plate, executable: p.executable.trim(), executablePath, gameId, gameName, bindings, topBindings, macros };
  // Sensitivity belongs to the mouse, not a button profile.
  delete profile.dpi;
  const triggers = macroTriggers(profile);
  if ([...bindings,...Object.values(topBindings)].some(b=>b.type==='key' && triggers.some(t=>parseChord(b.value).hid===t.hid))) throw new Error('A keyboard binding conflicts with an F13–F24 macro trigger. Choose another key.');
  return profile;
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
class Store {
  constructor(directory) {
    this.directory = directory; this.file = path.join(directory, 'profiles.json'); this.warning = ''; this.macros = [];
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (![1,2].includes(data.version) || !Array.isArray(data.profiles) || !data.profiles.length || data.profiles.length > 100) throw new Error('Invalid profile file.');
      if(data.version===2) {
        this.macros=validateProfile({...newProfile(),macros:data.macros}).macros;
        this.profiles=data.profiles.map(p=>validateProfile({...p,macros:this.macros}));
      } else {
        this.profiles=data.profiles.map(p=>mergeProfileMacros(validateProfile(p),this.macros));
        this.profiles=this.profiles.map(p=>validateProfile({...p,macros:this.macros}));
      }
      if (new Set(this.profiles.map(p => p.id)).size !== this.profiles.length) throw new Error('Duplicate profiles.');
      if(data.version===1) { fs.copyFileSync(this.file,this.file+`.before-shared-macros-${Date.now()}`); this.persist(); }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        fs.copyFileSync(this.file, this.file + `.recovery-${Date.now()}`);
        this.warning = 'The profile file was invalid. A recovery copy was kept beside it.';
      }
      this.macros=[]; this.profiles = [newProfile()]; this.persist();
    }
  }
  write(profiles,macros=this.macros) { atomicWrite(this.file,{version:2,macros,profiles:profiles.map(({macros,...p})=>p)}); }
  persist() { this.write(this.profiles); }
  save(input) {
    const index = this.profiles.findIndex(x => x.id === input.id), macros=structuredClone(this.macros);
    const p = index<0 ? mergeProfileMacros(validateProfile(input),macros) : validateProfile({...input,macros});
    p.macros=macros; validateProfile(p);
    if (p.executable && this.profiles.some(other => other.id !== p.id && other.model === p.model && other.plate === p.plate && ((p.gameId && other.gameId === p.gameId) || (p.executablePath && other.executablePath ? path.win32.normalize(other.executablePath).toLowerCase() === path.win32.normalize(p.executablePath).toLowerCase() : !p.executablePath && !other.executablePath && other.executable.toLowerCase() === p.executable.toLowerCase()))))
      throw new Error('Another profile for this model and side plate already uses that executable.');
    if (index < 0 && this.profiles.length >= 100) throw new Error('Profile limit reached.');
    const next = this.profiles.map(p=>({...p,macros})); if (index < 0) next.push(p); else next[index] = p;
    this.write(next,macros); this.profiles = next; this.macros=macros; return p;
  }
  saveMacros(input) {
    const macros=validateProfile({...newProfile(),macros:input}).macros, ids=new Set(macros.map(m=>m.id));
    const next=this.profiles.map(profile=>{
      const p=structuredClone(profile); p.macros=macros;
      p.bindings=p.bindings.map((b,i)=>b.type==='macro'&&!ids.has(b.value)?{type:'key',value:defaults[i]}:b);
      for(const [id,b] of Object.entries(p.topBindings))if(b.type==='macro'&&!ids.has(b.value))p.topBindings[id]={type:'default',value:''};
      return validateProfile(p);
    });
    this.write(next,macros);this.profiles=next;this.macros=macros;return macros;
  }
  remove(id) {
    if (this.profiles.length <= 1) throw new Error('Keep at least one profile.');
    const next = this.profiles.filter(p => p.id !== id);
    this.write(next); this.profiles = next;
  }
}
function mergeProfileMacros(input,library) {
  const p=structuredClone(input);
  for(const macro of p.macros) {
    const existing=library.find(m=>m.id===macro.id);
    if(existing && JSON.stringify(existing)!==JSON.stringify(macro)) {
      const oldId=macro.id;macro.id=randomUUID();
      for(const b of [...p.bindings,...Object.values(p.topBindings)])if(b.type==='macro'&&b.value===oldId)b.value=macro.id;
    }
    if(!existing || macro.id!==existing.id)library.push(macro);
  }
  return p;
}
module.exports = { Store, newProfile, validateProfile, atomicWrite, defaults };

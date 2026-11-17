const keyboardRows = [
  [['Escape','Esc'],...Array.from({length:12},(_,i)=>[`F${i+1}`,`F${i+1}`])],
  [['Backquote','`'],...Array.from('1234567890',n=>[`Digit${n}`,n]),['Minus','-'],['Equal','='],['Backspace','Backspace',2]],
  [['Tab','Tab',1.5],...Array.from('QWERTYUIOP',n=>[`Key${n}`,n]),['BracketLeft','['],['BracketRight',']'],['Backslash','\\',1.5]],
  [['CapsLock','Caps',1.8],...Array.from('ASDFGHJKL',n=>[`Key${n}`,n]),['Semicolon',';'],['Quote',"'"],['Enter','Enter',2.2]],
  [['ShiftLeft','Shift',2.4],...Array.from('ZXCVBNM',n=>[`Key${n}`,n]),['Comma',','],['Period','.'],['Slash','/'],['ShiftRight','Shift',2.6]],
  [['ControlLeft','Ctrl',1.5],['MetaLeft','Win',1.2],['AltLeft','Alt',1.3],['Space','Space',6],['AltRight','Alt',1.3],['ControlRight','Ctrl',1.5],['ArrowLeft','←'],['ArrowUp','↑'],['ArrowDown','↓'],['ArrowRight','→']]
];
const keyboardPressed = new Set();
const keyboardModifiers = {ControlLeft:'Ctrl',ControlRight:'Ctrl',ShiftLeft:'Shift',ShiftRight:'Shift',AltLeft:'Alt',AltRight:'Alt',MetaLeft:'Win',MetaRight:'Win'};
function keyboardBinding(code,label) {
  return keyboardModifiers[code] || ({Escape:'Escape',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight',ArrowUp:'ArrowUp',ArrowDown:'ArrowDown'}[code]) || label;
}
function renderKeyboard() {
  return `<section class="card live-keyboard"><div class="card-head"><div><h2>Virtual keyboard</h2><p>Press keys or mouse buttons to see their output. Click a key to assign it to ${esc(selectionName())}.</p></div><button class="button" id="test-keys">Test keys</button></div><div class="keyboard-surface" id="keyboard-tester" tabindex="0" role="group" aria-label="Live keyboard tester"><div class="keyboard-focus-hint">Testing keys · shortcuts stay in this window where Windows allows</div>${keyboardRows.map(row=>`<div class="keyboard-row">${row.map(([code,label,width=1])=>`<button class="keyboard-key key-width-${String(width).replace('.','-')} ${keyboardPressed.has(code)?'pressed':''}" data-key-code="${code}" data-key-value="${esc(keyboardBinding(code,label))}" aria-label="Assign ${esc(label)} to ${esc(selectionName())}"><span>${esc(label)}</span></button>`).join('')}</div>`).join('')}</div><div class="keyboard-feedback" id="keyboard-feedback" role="status">${keyboardPressed.size ? 'Held: '+[...keyboardPressed].map(code=>keyboardBinding(code,code.replace(/^Key|^Digit/,''))).join(' + ') : 'No keys held · highlights work while Neuron has focus'}</div></section>`;
}
function wireKeyboard() {
  $('#test-keys').onclick = () => $('#keyboard-tester').focus();
  document.querySelectorAll('[data-key-code]').forEach(button => button.onclick = () => {
    setBindingKey(button.dataset.keyValue);
    toast(`${selectionName()} → ${button.dataset.keyValue}. Click Save & apply to mouse.`);
  });
}
function syncKeyboardHighlights() {
  document.querySelectorAll('[data-key-code]').forEach(button=>button.classList.toggle('pressed',keyboardPressed.has(button.dataset.keyCode)));
  if ($('#keyboard-feedback')) $('#keyboard-feedback').textContent = keyboardPressed.size ? 'Held: '+[...keyboardPressed].map(code=>keyboardBinding(code,code.replace(/^Key|^Digit/,''))).join(' + ') : 'No keys held · highlights work while Neuron has focus';
}
// The shared UI state in app.js must exist before focus or key events run.
document.addEventListener('DOMContentLoaded', () => {
document.addEventListener('keydown', event => {
  if (page !== 'buttons') return;
  keyboardPressed.add(event.code); syncKeyboardHighlights();
  if (document.activeElement?.id === 'keyboard-tester') event.preventDefault();
}, true);
document.addEventListener('keyup', event => { keyboardPressed.delete(event.code); syncKeyboardHighlights(); }, true);
window.addEventListener('blur', () => { keyboardPressed.clear(); syncKeyboardHighlights(); });
}, { once: true });

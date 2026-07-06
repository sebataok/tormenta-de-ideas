// pin.js — PIN de 4 dígitos con hash SHA-256, guardado en localStorage.
// Primera vez: setea el PIN (usuario ingresa 4 dígitos, se pide confirmar).
// Siguientes: pide el PIN y compara hash.

const LS_HASH_KEY = 'tormenta:pin_hash';
const LS_UNLOCK_KEY = 'tormenta:unlocked_until';
const UNLOCK_MS = 12 * 60 * 60 * 1000; // 12h de sesión

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export const Pin = {
  hasPin() {
    return !!localStorage.getItem(LS_HASH_KEY);
  },
  isUnlocked() {
    const until = parseInt(localStorage.getItem(LS_UNLOCK_KEY) || '0', 10);
    return Date.now() < until;
  },
  lock() {
    localStorage.removeItem(LS_UNLOCK_KEY);
  },
  async set(pin) {
    const hash = await sha256Hex(pin);
    localStorage.setItem(LS_HASH_KEY, hash);
    localStorage.setItem(LS_UNLOCK_KEY, String(Date.now() + UNLOCK_MS));
  },
  async check(pin) {
    const hash = await sha256Hex(pin);
    const ok = hash === localStorage.getItem(LS_HASH_KEY);
    if (ok) localStorage.setItem(LS_UNLOCK_KEY, String(Date.now() + UNLOCK_MS));
    return ok;
  },
  reset() {
    localStorage.removeItem(LS_HASH_KEY);
    localStorage.removeItem(LS_UNLOCK_KEY);
  }
};

/**
 * Controla la vista de PIN.
 * @param {HTMLElement} root  Contenedor #view-pin
 * @param {() => void} onSuccess Callback cuando el PIN queda verificado / seteado
 */
export function mountPinView(root, onSuccess) {
  const dots = [...root.querySelectorAll('.pin-dots .dot')];
  const dotsWrap = root.querySelector('.pin-dots');
  const hint = root.querySelector('#pin-hint');
  const iosHint = root.querySelector('#ios-hint');
  const keys = root.querySelectorAll('.pin-key[data-key]');
  const btnDel = root.querySelector('#pin-del');
  const btnReset = root.querySelector('#pin-reset');

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (isIOS && !isStandalone) iosHint.hidden = false;

  let buffer = '';
  let stage = Pin.hasPin() ? 'verify' : 'set';
  let firstAttempt = ''; // usado para confirmar en modo set

  function refresh() {
    dots.forEach((d, i) => d.classList.toggle('filled', i < buffer.length));
    if (stage === 'set') {
      hint.textContent = 'Elegí un PIN de 4 dígitos';
    } else if (stage === 'confirm') {
      hint.textContent = 'Repetí tu PIN para confirmar';
    } else {
      hint.textContent = 'Ingresá tu PIN';
    }
  }

  function shake() {
    dotsWrap.classList.remove('shake');
    void dotsWrap.offsetWidth;
    dotsWrap.classList.add('shake');
  }

  async function onComplete() {
    if (stage === 'set') {
      firstAttempt = buffer;
      buffer = '';
      stage = 'confirm';
      refresh();
    } else if (stage === 'confirm') {
      if (buffer === firstAttempt) {
        await Pin.set(buffer);
        onSuccess();
      } else {
        shake();
        buffer = '';
        firstAttempt = '';
        stage = 'set';
        refresh();
      }
    } else {
      const ok = await Pin.check(buffer);
      if (ok) {
        onSuccess();
      } else {
        shake();
        buffer = '';
        refresh();
      }
    }
  }

  keys.forEach(k => {
    k.addEventListener('click', () => {
      if (buffer.length >= 4) return;
      buffer += k.dataset.key;
      refresh();
      if (buffer.length === 4) setTimeout(onComplete, 120);
    });
  });
  btnDel.addEventListener('click', () => { buffer = buffer.slice(0, -1); refresh(); });
  btnReset.addEventListener('click', () => {
    if (!confirm('¿Borrar el PIN actual y elegir otro? (Se pedirá volver a definirlo)')) return;
    Pin.reset();
    buffer = ''; firstAttempt = ''; stage = 'set'; refresh();
  });

  refresh();
}

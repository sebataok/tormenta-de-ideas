// app.js — orquestador principal de la PWA.

import { Storage } from './storage.js';
import { VoiceCapture, isSpeechSupported } from './voice.js';
import { Pin, mountPinView } from './pin.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._to);
  toast._to = setTimeout(() => (t.hidden = true), ms);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function goto(viewId) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#' + viewId).classList.add('active');
}

async function renderList() {
  const ideas = await Storage.listIdeas();
  const list = $('#ideas-list');
  list.innerHTML = '';
  $('#ideas-count').textContent = ideas.length;

  if (!ideas.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Ninguna idea todavía. Tocá el botón grande y contá algo.';
    list.appendChild(li);
    return;
  }

  ideas.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  for (const idea of ideas) {
    const advances = await Storage.listAdvances(idea.id);
    const episodes = await Storage.listEpisodes(idea.id);
    const li = document.createElement('li');
    li.className = 'idea-card';
    const status = episodes.length
      ? `<span class="badge ready">🎧 ${episodes.length} episodio${episodes.length > 1 ? 's' : ''}</span>`
      : `<span class="badge pending">⏳ preparando</span>`;
    li.innerHTML = `
      <div class="title">${escapeHtml(idea.title || '(sin título)')}</div>
      <div class="meta">
        <span>${fmtDate(idea.updated_at || idea.created_at)}</span>
        <span>· ${advances.length} avance${advances.length === 1 ? '' : 's'}</span>
        ${status}
      </div>
      <div class="actions">
        <button class="btn-tiny" data-act="open" data-id="${idea.id}">Abrir</button>
        <button class="btn-tiny" data-act="advance" data-id="${idea.id}">➕ Marcar avance</button>
        ${episodes.length ? `<button class="btn-tiny" data-act="play" data-id="${idea.id}">▶ Último episodio</button>` : ''}
        <button class="btn-tiny danger" data-act="delete" data-id="${idea.id}" title="Borrar idea">🗑</button>
      </div>
    `;
    list.appendChild(li);
  }

  list.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === 'open') openIdea(id);
    if (act === 'advance') startAdvance(id);
    if (act === 'play') {
      const eps = await Storage.listEpisodes(id);
      eps.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const last = eps[0];
      if (last?.audio_url) window.open(last.audio_url, '_blank');
      else toast('El episodio aún no está listo');
    }
    if (act === 'delete') {
      // Confirmación doble-toque: primera vez cambia a "Confirmar", segunda ejecuta.
      if (btn.dataset.confirm === '1') {
        clearTimeout(btn._to);
        await Storage.deleteIdea(id);
        toast('Idea borrada');
        await renderList();
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = '¿Seguro? 🗑';
        btn.classList.add('danger-active');
        btn._to = setTimeout(() => {
          btn.dataset.confirm = '';
          btn.textContent = '🗑';
          btn.classList.remove('danger-active');
        }, 3500);
      }
    }
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

async function openIdea(id) {
  const idea = await Storage.getIdea(id);
  const advances = await Storage.listAdvances(id);
  const episodes = await Storage.listEpisodes(id);
  const modal = $('#modal');
  $('#modal-title').textContent = idea.title || '(sin título)';
  const body = $('#modal-body');
  body.innerHTML = `
    <p style="color:var(--muted);font-size:12px">${fmtDate(idea.created_at)}</p>
    <p>${escapeHtml(idea.text || '')}</p>
    ${advances.map(a => `
      <div class="advance" style="display:flex;gap:8px;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:11px;color:var(--muted)">${fmtDate(a.created_at)}</div>
          <div>${escapeHtml(a.text)}</div>
        </div>
        <button class="modal-del" data-act="del-adv" data-id="${a.id}" data-idea="${id}" title="Borrar avance">✕</button>
      </div>
    `).join('')}
    ${episodes.map((ep, i) => `
      <div class="episode" style="position:relative">
        <button class="modal-del" data-act="del-ep" data-id="${ep.id}" style="position:absolute;top:8px;right:8px" title="Borrar episodio">✕</button>
        <div style="font-weight:600">🎧 Episodio ${ep.number || i + 1}</div>
        <div style="font-size:11px;color:var(--muted)">${fmtDate(ep.created_at)}</div>
        ${ep.summary ? `<p style="margin:6px 0 0">${escapeHtml(ep.summary)}</p>` : ''}
        ${ep.audio_url ? `<audio controls preload="none" src="${ep.audio_url}"></audio>` : '<div style="color:var(--muted);font-size:12px">Sin audio aún</div>'}
      </div>
    `).join('')}
    <div class="modal-danger-zone">
      <button class="btn danger-big" data-act="del-idea" data-id="${id}">🗑 Borrar esta idea completa</button>
      <p class="modal-danger-hint">Se borran también sus ${advances.length} avance${advances.length===1?'':'s'} y ${episodes.length} episodio${episodes.length===1?'':'s'}. Tocá dos veces para confirmar.</p>
    </div>
  `;
  modal.hidden = false;

  body.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act } = btn.dataset;
    const doDouble = async (label, run) => {
      if (btn.dataset.confirm === '1') {
        clearTimeout(btn._to);
        await run();
      } else {
        btn.dataset.confirm = '1';
        btn._origText = btn.textContent;
        btn.textContent = label;
        btn.classList.add('danger-active');
        btn._to = setTimeout(() => {
          btn.dataset.confirm = '';
          btn.textContent = btn._origText;
          btn.classList.remove('danger-active');
        }, 3500);
      }
    };
    if (act === 'del-adv') {
      await doDouble('¿Seguro? ✕', async () => {
        await Storage.deleteAdvance(btn.dataset.id, btn.dataset.idea);
        toast('Avance borrado');
        openIdea(id);
        renderList();
      });
    }
    if (act === 'del-ep') {
      await doDouble('¿Seguro? ✕', async () => {
        await Storage.deleteEpisode(btn.dataset.id);
        toast('Episodio borrado');
        openIdea(id);
        renderList();
      });
    }
    if (act === 'del-idea') {
      await doDouble('¿Confirmás borrar TODO? 🗑', async () => {
        await Storage.deleteIdea(btn.dataset.id);
        toast('Idea borrada');
        modal.hidden = true;
        renderList();
      });
    }
  };
}
$('#modal-close')?.addEventListener('click', () => { $('#modal').hidden = true; });
$('#modal')?.addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

// -------- Grabación --------
const capture = new VoiceCapture({
  lang: 'es-CL',
  onInterim: (txt) => {
    const el = $('#transcript');
    el.hidden = false;
    el.classList.add('interim');
    el.textContent = txt;
  },
  onFinal: (txt) => {
    const el = $('#transcript');
    el.hidden = false;
    el.classList.remove('interim');
    el.textContent = txt;
  },
  onError: (err) => {
    console.warn('voice err', err);
    if (err.message === 'not-allowed') toast('Concedé permiso de micrófono');
  }
});

let currentAdvanceForIdea = null;
let recording = false;

const btnRec = $('#btn-record');
const recLabel = $('#record-label');

async function startRecording() {
  recording = true;
  btnRec.classList.add('recording');
  recLabel.textContent = 'Escuchando...';
  $('#record-hint').textContent = 'Tocá otra vez para detener';
  $('#transcript').hidden = true;
  $('#transcript').textContent = '';
  $('#transcript-actions').hidden = true;
  await capture.start();
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  btnRec.classList.remove('recording');
  recLabel.textContent = currentAdvanceForIdea ? 'Nueva idea' : 'Nueva idea';
  $('#record-hint').textContent = 'Mantené presionado o tocá para hablar';
  const result = await capture.stop();
  if (result?.text) {
    $('#transcript').hidden = false;
    $('#transcript').classList.remove('interim');
    $('#transcript').textContent = result.text;
    $('#transcript-actions').hidden = false;
  } else {
    $('#transcript').hidden = true;
    $('#transcript-actions').hidden = true;
    toast('No pude escuchar bien. Probá de nuevo.');
    currentAdvanceForIdea = null;
  }
}

btnRec.addEventListener('click', () => {
  if (recording) stopRecording(); else startRecording();
});

$('#btn-discard').addEventListener('click', () => {
  $('#transcript').hidden = true;
  $('#transcript-actions').hidden = true;
  $('#transcript').textContent = '';
  currentAdvanceForIdea = null;
});

$('#btn-confirm').addEventListener('click', async () => {
  const text = $('#transcript').textContent.trim();
  if (!text) return;
  if (currentAdvanceForIdea) {
    await Storage.addAdvance(currentAdvanceForIdea, { text });
    toast('Avance guardado');
    currentAdvanceForIdea = null;
  } else {
    await Storage.saveIdea({ text });
    toast('Idea guardada');
  }
  $('#transcript').hidden = true;
  $('#transcript-actions').hidden = true;
  $('#transcript').textContent = '';
  await renderList();
  Storage.syncNow();
});

function startAdvance(ideaId) {
  currentAdvanceForIdea = ideaId;
  toast('Grabá el avance sobre esta idea');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  recLabel.textContent = 'Marcar avance';
}

// -------- Boot --------
(async () => {
  // Defensa: forzar cierre de overlays al arrancar, por si algún estilo los abrió.
  ['modal', 'transcript', 'transcript-actions', 'toast'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });

  await Storage.init();

  // Vista PIN o directo al main
  const pinView = $('#view-pin');
  const mainView = $('#view-main');

  const goMain = async () => {
    goto('view-main');
    await renderList();
    Storage.startAutoSync(30000, (status) => {
      const b = $('#sync-badge');
      b.classList.remove('ok', 'pending', 'err');
      if (status === 'ok') b.classList.add('ok');
      else if (status === 'pending') b.classList.add('pending');
      else if (status === 'err') b.classList.add('err');
    });
    if (!isSpeechSupported()) {
      toast('Web Speech no soportada. Se guardará sólo el audio.');
    }
  };

  if (Pin.hasPin() && Pin.isUnlocked()) {
    await goMain();
  } else {
    mountPinView(pinView, goMain);
  }
})();

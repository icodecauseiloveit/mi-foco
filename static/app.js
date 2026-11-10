'use strict';
/* Mi Foco — interfaz web (vanilla JS, sin dependencias externas). */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ESTADOS = { pendiente: 'Pendiente', en_progreso: 'En progreso', pausada: 'Pausada', completada: 'Completada', cancelada: 'Cancelada' };
const PRIORIDADES = {
  A: 'A · Debo hacerla (consecuencias serias)',
  B: 'B · Debería hacerla (consecuencias leves)',
  C: 'C · Sería bueno (sin consecuencias)',
  D: 'D · Delegar',
  E: 'E · Eliminar',
};
const EVENTOS = {
  creada: 'Creada', editada: 'Editada', reprogramada: 'Reprogramada', iniciada: 'Iniciada', reanudada: 'Reanudada',
  pausada: 'Pausada', completada: 'Completada', reabierta: 'Reabierta', cancelada: 'Cancelada', vencida: 'Venció', eliminada: 'Eliminada',
  adjunto: 'Soporte 📎', trabajo: 'Trabajo realizado 📝', novedad: 'Novedad ●', novedad_resuelta: 'Novedad resuelta', dependencias: 'Dependencias', desbloqueada: 'Desbloqueada 🔓', bloqueada: 'Bloqueada 🔒',
  subtarea_completada: 'Subtarea completada', subtarea_reabierta: 'Subtarea desmarcada', subtareas: 'Subtareas modificadas',
};
const ABIERTOS = ['pendiente', 'en_progreso', 'pausada'];

const st = {
  vista: 'hoy',
  tareas: [],
  metas: [],
  catalogos: { categorias: [], descripciones: [] },
  subInvertidas: new Set(),
  subHoy: new Set(),
  expandidas: new Set(),       // tareas desplegadas en la vista Tareas
  hist: { tab: 'semana', anio: null, semana: null },          // en Hoy van plegadas; aquí las que el usuario abrió   // tareas cuya lista de subtareas el usuario abrió/cerró a mano
  filtros: { estado: 'abiertas', prioridad: '', categoria: '', q: '' },
  periodo: 30,
  ia: { activa: false },         // asistente con IA (solo si hay OPENAI_API_KEY en .env)
  fraseIA: null,
  alertas: [],
  notificadas: new Set(),
  activa: null,        // { titulo, base, desde }
};

/* ─────────── utilidades ─────────── */
async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error((data && data.error) || `Error ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  if (data && Array.isArray(data.desbloqueadas) && data.desbloqueadas.length) avisarDesbloqueadas(data.desbloqueadas);
  return data;
}

/** Aviso cuando terminar algo libera tareas que estaban esperando. */
function avisarDesbloqueadas(lista) {
  const nombres = lista.map((t) => `«${t.titulo}»`).join(', ');
  toast(`🔓 Ya puedes empezar: ${nombres}`, 'exito');
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification('Mi Foco · Tarea desbloqueada', { body: `Ya puedes empezar: ${nombres}` });
  }
}

function toast(msg, tipo = '') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

const pad = (n) => String(n).padStart(2, '0');
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function aLocalInput(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtFecha(iso, hora = true) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  const o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (hora && iso.length > 10) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('es-CO', o);
}
function fmtMin(m) {
  m = Math.round(m || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} h${r ? ' ' + r + ' min' : ''}`;
}
function fmtDias(d) {
  if (d == null) return '—';
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  return `${String(Number(d.toFixed(1))).replace('.', ',')} d`;
}
const abierta = (t) => ABIERTOS.includes(t.estado);
function ordenPrioridad(a, b) {
  if (a.prioridad !== b.prioridad) return a.prioridad < b.prioridad ? -1 : 1;
  if (a.vencida !== b.vencida) return a.vencida ? -1 : 1;
  const fa = a.fecha_limite || '9999', fb = b.fecha_limite || '9999';
  return fa < fb ? -1 : fa > fb ? 1 : b.id - a.id;
}

/* ─────────── carga de datos ─────────── */
async function cargarTareas() {
  st.tareas = await api('/api/tareas?incluir_cerradas=1');
  const t = st.tareas.find((x) => x.sesion_abierta);
  st.activa = t ? { id: t.id, titulo: t.subtarea_en_curso ? `${t.titulo} › ${t.subtarea_en_curso.titulo}` : t.titulo,
    base: t.minutos_sesion_actual, desde: Date.now() } : null;
  pintarEnCurso();
}
async function cargarMetas() { st.metas = await api('/api/metas'); }
async function cargarCatalogos() { st.catalogos = await api('/api/catalogos'); }

/* Íconos de categoría: imagen propia > emoji > nada. */
const infoCategoria = (nombre) => st.catalogos.categorias.find((c) => c.nombre.toLowerCase() === String(nombre || '').toLowerCase());
function iconoCategoria(nombre, clase = 'cat-ico') {
  const c = infoCategoria(nombre);
  if (!c) return '';
  if (c.imagen_url) return `<img class="${clase}" src="${c.imagen_url}" alt="" loading="lazy">`;
  if (c.icono) return `<span class="${clase}">${esc(c.icono)}</span>`;
  return '';
}
/** Para <option>, que no admite imágenes: solo el emoji. */
const prefijoEmoji = (nombre) => { const c = infoCategoria(nombre); return c && c.icono && !c.imagen_url ? c.icono + ' ' : ''; };

const EMOJIS = ['📁', '💼', '🏭', '🛢️', '⚙️', '🛠️', '🔧', '🏗️', '📊', '📈', '📋', '📝', '📅', '⏰', '💻', '🐍',
  '🗄️', '🔌', '📚', '🎓', '🧠', '💡', '🔍', '📧', '💬', '📞', '🤝', '👥', '🏠', '👨‍👩‍👧', '🧹', '🛒', '💰',
  '🧾', '🏦', '❤️', '🏃', '🍎', '✈️', '🚗', '🎯', '🚀', '⭐', '🔥', '✅', '⚠️', '🔒', '🌱', '🎨', '🎵'];

function formIconoCategoria(c) {
  const actual = iconoCategoria(c.nombre, 'cat-ico grande') || '<span class="cat-ico grande vacio-ico">?</span>';
  abrirModal(`<h2>Ícono de «${esc(c.nombre)}»</h2>
    <div class="ico-actual">${actual}<div><b>${esc(c.nombre)}</b><br><span class="sutil">${c.imagen_url ? 'Imagen propia' : c.icono ? 'Emoji' : 'Sin ícono'}</span></div></div>
    <h3 class="sub-h">Elige un emoji</h3>
    <div class="emojis">${EMOJIS.map((e) => `<button type="button" class="emoji-btn ${c.icono === e && !c.imagen_url ? 'sel' : ''}" data-poner-icono="${e}" data-cat="${c.id}">${e}</button>`).join('')}</div>
    <form id="f-emoji" data-cat="${c.id}" class="rapida" style="margin-top:10px">
      <input name="icono" maxlength="16" placeholder="…o escribe/pega cualquier emoji (Win + . abre el selector)" autocomplete="off">
      <button class="secundario">Usar</button>
    </form>
    <h3 class="sub-h">O sube una imagen</h3>
    <label class="subir">
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-subir-imagen="${c.id}">
      <span>📤 Seleccionar imagen (PNG, JPG, WEBP o GIF)</span>
    </label>
    <p class="ayuda">Se recorta al centro en cuadrado y se reduce a 96×96 px. Se guarda dentro de la base de datos, así que viaja con tus respaldos.</p>
    <div class="botones">
      ${c.icono || c.imagen_url ? `<button type="button" class="secundario" data-quitar-icono="${c.id}">Quitar ícono</button>` : ''}
      <button type="button" class="primario" data-volver-catalogos>Listo</button>
    </div>`);
}

function imagenA96(file, lado = 96) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Usa una imagen PNG, JPG, WEBP o GIF.'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error('La imagen supera 8 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const lienzo = document.createElement('canvas');
      lienzo.width = lienzo.height = lado;
      const ctx = lienzo.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, lado, lado);
      URL.revokeObjectURL(url);
      resolve(lienzo.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

async function guardarIcono(cid, cuerpo, msg) {
  st.catalogos = await api(`/api/categorias/${cid}`, { method: 'PUT', body: cuerpo });
  const c = st.catalogos.categorias.find((x) => x.id === cid);
  toast(msg, 'exito');
  if (c) formIconoCategoria(c);
  render();
}
/** Categorías guardadas (las más usadas primero) + cualquiera que aparezca en tareas. */
function categorias() {
  const vistas = new Set();
  const out = [];
  for (const c of [...st.catalogos.categorias.map((x) => x.nombre), ...st.tareas.map((t) => t.categoria)]) {
    if (c && !vistas.has(c.toLowerCase())) { vistas.add(c.toLowerCase()); out.push(c); }
  }
  return out;
}

function pintarEnCurso() {
  const el = $('#en-curso');
  if (!st.activa) { el.classList.add('oculto'); return; }
  const min = st.activa.base + (Date.now() - st.activa.desde) / 60000;
  const s = Math.floor(min * 60);
  const reloj = `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  el.innerHTML = `<span class="pulso"></span><span class="txt">${esc(st.activa.titulo)}</span><b>${reloj}</b>`;
  el.classList.remove('oculto');
}
setInterval(pintarEnCurso, 1000);

/* ─────────── componentes ─────────── */
function etiquetaLimite(t) {
  if (!t.fecha_limite) return '';
  if (t.estado === 'completada') {
    return t.completada_a_tiempo === false
      ? `<span class="chip rojo">Entregada con ${fmtDias(t.dias_atraso)} de atraso</span>`
      : `<span class="chip verde">✓ A tiempo</span>`;
  }
  if (t.estado === 'cancelada') return '';
  if (t.vencida) return `<span class="chip rojo">⚠ Vencida hace ${fmtDias(t.dias_atraso)}</span>`;
  const h = t.horas_restantes;
  if (h != null && h <= 24) return `<span class="chip ambar">⏰ Vence ${fmtFecha(t.fecha_limite)}</span>`;
  return `<span class="chip">📅 ${fmtFecha(t.fecha_limite)}</span>`;
}

const recorte = (txt, n) => (txt.length > n ? txt.slice(0, n - 1) + '…' : txt);
/** Subtarea corriendo o, si no hay, la primera pendiente. */
const siguienteSubtarea = (t) => (t.subtareas || []).find((s) => s.sesion_abierta) || (t.subtareas || []).find((s) => !s.completada);

/* Subtareas: abiertas por defecto en tareas abiertas, cerradas en las terminadas. */
const subExpandida = (t) => (abierta(t) ? !st.subInvertidas.has(t.id) : st.subInvertidas.has(t.id));

function checklistSubtareas(t, conAgregar = true) {
  return `<ul class="subtareas">${t.subtareas.map((s) => {
    const est = s.completada ? 'hecho' : s.novedad ? 'novedad' : 'vacio';
    return `<li class="${s.completada ? 'hecha' : ''} ${s.novedad && !s.completada ? 'con-novedad' : ''} ${s.es_entregable ? 'entregable' : ''} ${s.sesion_abierta ? 'corriendo' : ''}">
      <span class="sub-marca" role="checkbox" tabindex="${t.estado === 'cancelada' ? -1 : 0}" aria-checked="${est === 'hecho' ? 'true' : est === 'novedad' ? 'mixed' : 'false'}"
        ${t.estado === 'cancelada' ? 'aria-disabled="true"' : `data-chk-subtarea="${s.id}" data-tarea="${t.id}" data-estado="${est}" data-titulo="${esc(s.titulo)}"`}
        title="Clic: completar · otro clic: ● con novedad · otro clic: pendiente">
        <span class="chk chk-${est}"></span>
        <span class="sub-titulo">${s.es_entregable ? '<em class="tag-entregable">📦 Entregable</em> ' : ''}${esc(s.titulo)}</span></span>
      ${s.tiempo_min > 0 || s.sesion_abierta ? `<span class="tiempo-sub" title="Tiempo trabajado en esta subtarea">⏱ ${fmtMin(s.tiempo_min)}</span>` : ''}
      ${!s.completada && abierta(t) ? (s.sesion_abierta
        ? `<button type="button" class="crono-sub en-curso" data-sub-accion="pausar" data-sub="${s.id}" data-tarea="${t.id}" title="Pausar">${ICO_PAUSA}</button>`
        : `<button type="button" class="crono-sub" data-sub-accion="iniciar" data-sub="${s.id}" data-tarea="${t.id}" title="Iniciar el tiempo en esta subtarea">${ICO_PLAY}</button>`) : ''}
      ${s.completada && s.completada_en ? `<button type="button" class="fecha-sub" data-fecha-subtarea="${s.id}" data-tarea="${t.id}" title="Cambiar la fecha en que se completó">✅ ${fmtFecha(s.completada_en)} <span class="lapiz">✎</span></button>` : ''}
      ${s.novedad && !s.completada ? `<div class="sub-novedad"><b>● Novedad:</b> ${esc(s.novedad)} <small>· ${cuandoCorto(s.novedad_en)}</small>
        <button type="button" class="ico" data-editar-novedad-sub="${s.id}" data-tarea="${t.id}" data-texto="${esc(s.novedad)}" title="Editar la novedad">✎</button></div>` : ''}</li>`;
  }).join('')}</ul>
    ${conAgregar && abierta(t) ? `<form class="f-subtarea" data-tarea="${t.id}"><input name="titulo" placeholder="+ Agregar subtarea y Enter" autocomplete="off"></form>` : ''}`;
}

function barraAvance(t, conBoton = true, expandida = subExpandida(t), compacta = false) {
  if (!t.subtareas_total) return '';
  return `<div class="avance">
    <div class="progreso ${t.progreso_pct === 100 ? 'lleno' : ''}"><div style="width:${t.progreso_pct}%"></div></div>
    <span>${t.subtareas_hechas}/${t.subtareas_total} · <b>${t.progreso_pct}%</b></span>
    ${conBoton ? `<button class="ico" data-expandir="${t.id}" ${compacta ? 'data-compacta' : ''}>${expandida ? '▾' : '▸'} subtareas</button>` : ''}
  </div>`;
}

/* ─────────── dependencias ─────────── */
const nombreRequisito = (d) => (d.tipo === 'subtarea' ? `${d.titulo} (de «${d.tarea_titulo}»)` : d.titulo);

function chipsDependencia(t) {
  const chips = [];
  if (t.bloqueada) {
    const pend = t.dependencias.filter((d) => !d.completa);
    const lista = pend.map((d) => '• ' + nombreRequisito(d)).join('\n');
    const texto = pend.length === 1 ? `Espera: ${pend[0].titulo}` : `Espera ${pend.length} cosas`;
    chips.push(`<span class="chip bloq" title="Esta tarea espera:\n${esc(lista)}">🔒 ${esc(texto)}</span>`);
  } else if (abierta(t) && t.dependencias.length) {
    chips.push(`<span class="chip verde" title="Todo lo que esperaba ya está listo">🔓 Lista para empezar</span>`);
  }
  if (t.frena_a && t.frena_a.length) {
    const lista = t.frena_a.map((x) => '• ' + x.titulo).join('\n');
    chips.push(`<span class="chip ambar" title="Estas tareas esperan a esta:\n${esc(lista)}">⛓ Frena a ${t.frena_a.length}</span>`);
  }
  return chips.join('');
}

/** Opciones agrupadas por tarea: la tarea completa o cualquiera de sus subtareas pendientes. */
function opcionesDependencia(t) {
  const elegidas = new Set((t.dependencias || []).map((d) => `${d.tipo}:${d.ref_id}`));
  return st.tareas
    .filter((x) => x.id !== t.id && abierta(x))
    .sort(ordenPrioridad)
    .map((x) => {
      const subs = x.subtareas.filter((s) => !s.completada);
      return `<optgroup label="${esc(`${x.prioridad} · ${x.titulo}`)}">
        <option value="tarea:${x.id}" ${elegidas.has(`tarea:${x.id}`) ? 'disabled' : ''}>▸ Toda la tarea</option>
        ${subs.map((s) => `<option value="subtarea:${s.id}" ${elegidas.has(`subtarea:${s.id}`) ? 'disabled' : ''}>↳ ${esc(s.titulo)}</option>`).join('')}
      </optgroup>`;
    }).join('');
}

const chipDependencia = (d) => `<span class="chip dep-chip ${d.completa ? 'verde' : 'bloq'}" data-dep-valor="${d.tipo}:${d.ref_id}">
    ${d.completa ? '✓' : '⏳'} ${esc(nombreRequisito(d))}
    <button type="button" class="dep-x" data-quitar-dep title="Quitar">✕</button></span>`;

function editorDependencias(t) {
  const hay = st.tareas.some((x) => x.id !== t.id && abierta(x));
  return `<div class="dep-editor">
    <div class="dep-lista">${(t.dependencias || []).map(chipDependencia).join('')}</div>
    ${hay ? `<select data-dep-select><option value="">＋ Esperar a una tarea o subtarea…</option>${opcionesDependencia(t)}</select>`
      : '<span class="ayuda">No hay otras tareas abiertas de las cuales depender.</span>'}
  </div>`;
}

/** Arma la descripción de un requisito elegido en el formulario a partir de las tareas cargadas. */
function requisitoDesdeValor(valor) {
  const [tipo, id] = valor.split(':');
  const ref = Number(id);
  if (tipo === 'tarea') {
    const x = st.tareas.find((y) => y.id === ref);
    return x && { tipo, ref_id: ref, titulo: x.titulo, tarea_titulo: x.titulo, completa: !abierta(x) };
  }
  for (const x of st.tareas) {
    const sub = x.subtareas.find((y) => y.id === ref);
    if (sub) return { tipo, ref_id: ref, titulo: sub.titulo, tarea_titulo: x.titulo, completa: sub.completada };
  }
  return null;
}

/** Franja roja con la novedad de la tarea, con acciones. */
function bannerNovedad(t) {
  const partes = [];
  if (t.novedad) {
    partes.push(`<div class="banner-novedad">
      <div><b>● Novedad:</b> ${esc(t.novedad)} <small>· desde ${cuandoCorto(t.novedad_en)}</small></div>
      ${abierta(t) ? `<span class="banner-acc">
        <button class="mini" data-accion="novedad" data-id="${t.id}">✎ Editar</button>
        <button class="mini ok" data-accion="quitar_novedad" data-id="${t.id}">✓ Resuelta</button></span>` : ''}
    </div>`);
  }
  // Las novedades de subtareas se ven junto a cada subtarea; aquí solo la de la tarea.
  return partes.join('');
}

/** Línea de resumen de una tarea contraída: lo esencial en texto corto. */
function resumenTarea(t) {
  const p = [`<span class="r-cat">${iconoCategoria(t.categoria)}${esc(t.categoria)}</span>`];
  if (t.novedad && abierta(t)) p.push(`<span class="txt-rojo">● Novedad: ${esc(recorte(t.novedad, 48))}</span>`);
  else if (t.novedades_sub && t.novedades_sub.length && abierta(t)) p.push(`<span class="txt-rojo">● ${t.novedades_sub.length} subtarea${t.novedades_sub.length === 1 ? '' : 's'} con novedad</span>`);
  if (t.estado === 'completada') p.push(`<span class="txt-verde">✓ Completada ${cuandoCorto(t.completada_en)}${t.completada_a_tiempo === false ? ' · con atraso' : ''}</span>`);
  else if (t.estado === 'cancelada') p.push('Cancelada');
  else if (t.subtarea_en_curso) p.push(`<span class="txt-acento">▶ en «${esc(recorte(t.subtarea_en_curso.titulo, 30))}»</span>`);
  else if (t.estado === 'en_progreso') p.push('<span class="txt-acento">▶ en marcha</span>');
  else if (t.vencida) p.push(`<span class="txt-rojo">Vencida hace ${fmtDias(t.dias_atraso)}</span>`);
  else if (t.horas_restantes != null && t.horas_restantes <= 24) p.push(`<span class="txt-ambar">Vence ${cuandoCorto(t.fecha_limite)}</span>`);
  else if (t.bloqueada) p.push('🔒 En espera');
  else if (t.estado === 'pausada') p.push('Pausada');
  else if (t.fecha_limite) p.push(`Vence ${cuandoCorto(t.fecha_limite)}`);
  if (t.bloqueada && (t.vencida || t.estado === 'pausada')) p.push('🔒 en espera');
  if (t.subtareas_total) p.push(`${t.subtareas_hechas}/${t.subtareas_total} subtareas`);
  if (t.meta_nombre) p.push(`◆ ${esc(recorte(t.meta_nombre, 24))}`);
  const extra = [t.comentarios_total ? `💬 ${t.comentarios_total}` : '', t.adjuntos_total ? `📎 ${t.adjuntos_total}` : ''].filter(Boolean).join('  ');
  if (extra) p.push(extra);
  return p.join('<i class="sep">·</i>');
}

/** Acción principal de una tarea (la que más probablemente quieres hacer ahora). */
function accionPrincipal(t, conTexto) {
  const sig = t.tiempo_por_subtareas && abierta(t) ? siguienteSubtarea(t) : null;
  const b = (attrs, ico, texto, clase = '') => conTexto
    ? `<button class="btn-acc principal ${clase}" ${attrs}>${ico}<span>${texto}</span></button>`
    : `<button class="btn-redondo ${clase}" ${attrs} title="${esc(texto)}">${ico}</button>`;
  if (t.subtarea_en_curso) return b(`data-sub-accion="pausar" data-sub="${t.subtarea_en_curso.id}" data-tarea="${t.id}"`, ICO_PAUSA, `Pausar «${esc(recorte(t.subtarea_en_curso.titulo, 22))}»`, 'activo');
  if (t.estado === 'en_progreso') return b(`data-accion="pausar" data-id="${t.id}"`, ICO_PAUSA, 'Pausar', 'activo');
  if (sig) return b(`data-sub-accion="iniciar" data-sub="${sig.id}" data-tarea="${t.id}"`, ICO_PLAY, `Iniciar «${esc(recorte(sig.titulo, 22))}»`);
  if (['pendiente', 'pausada'].includes(t.estado)) return b(`data-accion="iniciar" data-id="${t.id}"`, ICO_PLAY, t.estado === 'pausada' ? 'Reanudar' : 'Iniciar');
  return b(`data-accion="reabrir" data-id="${t.id}"`, '↺', 'Reabrir', 'neutro');
}

function tarjetaTarea(t) {
  const desplegada = st.expandidas.has(t.id);
  const estadoTxt = t.subtarea_en_curso ? `En progreso · ▶ «${esc(t.subtarea_en_curso.titulo)}»` : ESTADOS[t.estado];
  let limite = '—';
  if (t.fecha_limite) {
    limite = fmtFecha(t.fecha_limite);
    if (t.vencida) limite += ` <span class="txt-rojo">· vencida hace ${fmtDias(t.dias_atraso)}</span>`;
    else if (t.estado === 'completada' && t.completada_a_tiempo === false) limite += ` <span class="txt-rojo">· entregada con ${fmtDias(t.dias_atraso)} de atraso</span>`;
    else if (t.estado === 'completada') limite += ' <span class="txt-verde">· a tiempo</span>';
  }
  const exceso = t.estimado_min && t.tiempo_real_min > t.estimado_min;
  const info = [
    ['Estado', estadoTxt],
    ['Fecha límite', limite],
    t.estado === 'completada' && t.completada_en
      ? ['Completada', `<button type="button" class="enlace-fecha" data-fecha-completado="${t.id}" title="Cambiar la fecha de completado">${fmtFecha(t.completada_en)} ✎</button>`] : null,
    ['Tiempo', `<span class="${exceso ? 'txt-ambar' : ''}">${fmtMin(t.tiempo_real_min)}</span>${t.estimado_min ? ` <span class="sutil-i">de ${fmtMin(t.estimado_min)} estimados</span>` : ''}`],
    ['Categoría', `${iconoCategoria(t.categoria)}${esc(t.categoria)}`],
    t.meta_nombre ? ['Meta', `◆ ${esc(t.meta_nombre)}`] : null,
    t.entregable ? ['Entregable', `📦 ${esc(t.entregable)} ${t.entregable_listo ? '<span class="txt-verde">✓</span>' : ''}`] : null,
    t.dependencias.length ? ['Depende de', t.dependencias.map((d) => `${d.completa ? '✓' : '⏳'} <a href="#" data-detalle="${d.tarea_id}">${esc(nombreRequisito(d))}</a>`).join('<br>')] : null,
    t.frena_a && t.frena_a.length ? ['Frena a', t.frena_a.map((x) => `⛓ <a href="#" data-detalle="${x.id}">${esc(x.titulo)}</a>`).join('<br>')] : null,
    ['Soporte', t.adjuntos_total ? `<a href="#" data-detalle="${t.id}" data-ir-soporte>📎 ${t.adjuntos_total} archivo(s)/enlace(s)</a>` : '<span class="sutil-i">—</span>'],
    ['Comentarios', t.comentarios_total ? `<a href="#" data-detalle="${t.id}" data-ir-comentarios>💬 ${t.comentarios_total} · último ${cuandoCorto(t.ultimo_comentario)}</a>` : '<span class="sutil-i">—</span>'],
  ].filter(Boolean);

  const principal = `
    ${t.descripcion ? `<p class="t-desc">${esc(t.descripcion)}</p>` : ''}
    ${t.subtareas_total ? `${barraAvance(t, false)}${checklistSubtareas(t)}`
      : abierta(t) ? `<p class="sutil-i t-sin-sub">Sin subtareas.</p>${checklistSubtareas(t)}` : '<p class="sutil-i t-sin-sub">Sin subtareas.</p>'}`;

  const secundarias = [
    `<button class="btn-acc" data-detalle="${t.id}" data-ir-comentarios><span class="i">💬</span><span>Comentar</span></button>`,
    `<button class="btn-acc" data-editar="${t.id}"><span class="i">✎</span><span>Editar</span></button>`,
    `<button class="btn-acc" data-duplicar="${t.id}"><span class="i">⧉</span><span>Duplicar</span></button>`,
    `<button class="btn-acc" data-detalle="${t.id}"><span class="i">↗</span><span>Ver detalle</span></button>`,
  ];
  const peligrosas = [
    abierta(t) ? `<button class="btn-acc solo-ico" data-accion="cancelar" data-id="${t.id}" title="Cancelar tarea">⊘</button>` : '',
    `<button class="btn-acc solo-ico peligro" data-eliminar="${t.id}" title="Eliminar tarea">🗑</button>`,
  ].join('');

  return `<article class="tarea est-${t.estado} ${t.vencida ? 'vencida' : ''} ${t.bloqueada ? 'bloqueada' : ''} ${desplegada ? 'abierta' : ''}" data-tarea-id="${t.id}">
    <div class="t-fila" data-toggle-tarea="${t.id}">
      <div class="prio prio-${t.prioridad}" title="${esc(PRIORIDADES[t.prioridad])}">${t.prioridad}</div>
      <div class="t-cuerpo">
        <div class="t-titulo">${t.con_novedad && abierta(t) ? '<span class="dot-novedad" title="Con novedad"></span>' : ''}${t.bloqueada ? '🔒 ' : ''}${t.es_rana ? '🐸 ' : ''}${esc(t.titulo)}</div>
        <div class="t-resumen">${resumenTarea(t)}</div>
      </div>
      ${t.subtareas_total ? `<div class="mini-avance" title="${t.subtareas_hechas} de ${t.subtareas_total} subtareas"><div style="width:${t.progreso_pct}%"></div></div>` : ''}
      <div class="t-rapidas">
        ${accionPrincipal(t, false)}
        <button class="chevron" data-toggle-tarea="${t.id}" aria-expanded="${desplegada}" title="${desplegada ? 'Contraer' : 'Ver más detalles'}">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg>
        </button>
      </div>
    </div>
    <div class="t-detalle" ${desplegada ? '' : 'inert'}>
      <div class="t-detalle-int"><div class="t-detalle-cont">
        ${bannerNovedad(t)}
        <div class="t-det-grid">
          <div class="t-det-principal">${principal}</div>
          <dl class="t-det-info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        </div>
        <div class="t-barra">
          <div class="t-barra-izq">
            ${accionPrincipal(t, true)}
            ${abierta(t) ? `<button class="btn-acc ok" data-accion="completar" data-id="${t.id}">${ICO_OK}<span>Completar</span></button>` : ''}
            ${abierta(t) && !t.novedad ? `<button class="btn-acc novedad" data-accion="novedad" data-id="${t.id}" title="Algo impide terminarla: queda abierta con su tiempo"><span class="i">●</span><span>Novedad</span></button>` : ''}
          </div>
          <div class="t-barra-der">${secundarias.join('')}<span class="t-barra-sep"></span>${peligrosas}</div>
        </div>
      </div></div>
    </div>
  </article>`;
}

/** Despliega / contrae una tarea sin volver a dibujar la lista (animado). */
function alternarTarea(id, abrir) {
  const art = document.querySelector(`article.tarea[data-tarea-id="${id}"]`);
  const abrirla = abrir ?? !st.expandidas.has(id);
  if (abrirla) st.expandidas.add(id); else st.expandidas.delete(id);
  if (!art) return;
  art.classList.toggle('abierta', abrirla);
  art.querySelector('.t-detalle').toggleAttribute('inert', !abrirla);
  const ch = art.querySelector('.chevron');
  ch.setAttribute('aria-expanded', String(abrirla));
  ch.title = abrirla ? 'Contraer' : 'Ver más detalles';
}

function listaTareas(tareas, vacio = 'Nada por aquí.') {
  if (!tareas.length) return `<div class="vacio">${vacio}</div>`;
  return `<div class="lista">${tareas.map((t) => tarjetaTarea(t)).join('')}</div>`;
}

function graficoBarras(datos, formato = (v) => v, clase = '') {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const paso = Math.ceil(datos.length / 10);
  return `<div class="barras ${clase}">${datos.map((d, i) => `
    <div class="barra" title="${esc(d.etiqueta)}: ${esc(formato(d.valor))}">
      <div class="barra-relleno" style="height:${(d.valor / max * 100).toFixed(1)}%"></div>
      <span class="barra-et">${i % paso === 0 ? esc(d.corta) : ''}</span>
    </div>`).join('')}</div>`;
}

function barrasH(datos, formato = (v) => v) {
  if (!datos.length) return '<div class="vacio">Sin datos en el periodo.</div>';
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return datos.map((d) => `<div class="hbar"><span title="${esc(d.etiqueta)}">${d.html || esc(d.etiqueta)}</span>
    <div class="hbar-pista"><div style="width:${(d.valor / max * 100).toFixed(1)}%;${d.color ? 'background:' + d.color : ''}"></div></div>
    <b>${esc(formato(d.valor))}</b></div>`).join('');
}

const kpi = (valor, etiqueta, detalle = '', clase = '') =>
  `<div class="kpi ${clase}"><div class="v">${valor}</div><div class="l">${etiqueta}</div>${detalle ? `<div class="d">${detalle}</div>` : ''}</div>`;

/* ─────────── vistas ─────────── */
async function vistaHoy() {
  const fraseHoy = st.fraseIA && st.fraseIA.dia === hoyISO() ? st.fraseIA : null;
  const [frase, stats] = await Promise.all([fraseHoy || api('/api/frase'), api('/api/estadisticas?dias=1'), cargarTareas(), cargarCatalogos()]);
  if (st.ia.activa && !fraseHoy) setTimeout(cargarFraseIA, 0);
  const abiertas = st.tareas.filter(abierta);
  const hoy = hoyISO();
  const completadasHoy = st.tareas.filter((t) => t.estado === 'completada' && (t.completada_en || '').startsWith(hoy));
  const enCurso = abiertas.filter((t) => ['en_progreso', 'pausada'].includes(t.estado)).sort(ordenPrioridad);
  const noEnCurso = (t) => !enCurso.includes(t);
  const vencidas = abiertas.filter((t) => t.vencida && noEnCurso(t)).sort(ordenPrioridad);
  const pronto = abiertas.filter((t) => !t.vencida && noEnCurso(t) && t.horas_restantes != null && t.horas_restantes <= 24).sort(ordenPrioridad);
  const rana = abiertas.filter((t) => t.es_rana).sort(ordenPrioridad)[0] || abiertas.filter((t) => t.prioridad === 'A').sort(ordenPrioridad)[0];
  const usadas = new Set([rana, ...vencidas, ...pronto, ...enCurso].filter(Boolean).map((t) => t.id));
  const prioA = abiertas.filter((t) => t.prioridad === 'A' && !usadas.has(t.id)).sort(ordenPrioridad);
  const sinRana = (lista) => lista.filter((t) => !rana || t.id !== rana.id);  // la rana ya está destacada arriba

  // ── La rana: lo más importante del día, en grande
  let bloqueRana;
  if (rana) {
    const sig = rana.tiempo_por_subtareas ? siguienteSubtarea(rana) : null;
    const corriendo = rana.subtarea_en_curso || rana.estado === 'en_progreso';
    const detalle = [];
    if (rana.novedad) detalle.push(`<span class="txt-rojo">● Novedad: ${esc(recorte(rana.novedad, 60))}</span>`);
    if (rana.vencida) detalle.push(`<span class="txt-rojo">Vencida hace ${fmtDias(rana.dias_atraso)}</span>`);
    else if (rana.fecha_limite) detalle.push(`Vence ${fmtFecha(rana.fecha_limite)}`);
    if (rana.subtareas_total) detalle.push(`${rana.subtareas_hechas}/${rana.subtareas_total} subtareas`);
    if (rana.bloqueada) detalle.push('🔒 en espera de otra tarea');
    if (sig && !rana.subtarea_en_curso) detalle.push(`siguiente: ${esc(sig.titulo)}`);
    if (rana.subtarea_en_curso) detalle.push(`<span class="txt-acento">▶ en «${esc(rana.subtarea_en_curso.titulo)}»</span>`);
    else if (rana.estado === 'en_progreso') detalle.push('<span class="txt-acento">▶ en marcha</span>');
    const boton = rana.subtarea_en_curso
      ? `<button class="secundario" data-sub-accion="pausar" data-sub="${rana.subtarea_en_curso.id}" data-tarea="${rana.id}">⏸ Pausar</button>`
      : rana.estado === 'en_progreso' && !sig
        ? `<button class="exito" data-accion="completar" data-id="${rana.id}">✓ Terminé</button>`
        : sig
          ? `<button class="primario grande" data-sub-accion="iniciar" data-sub="${sig.id}" data-tarea="${rana.id}">Comer la rana ▶</button>`
          : `<button class="primario grande" data-accion="iniciar" data-id="${rana.id}">Comer la rana ▶</button>`;
    bloqueRana = `<section class="tarjeta rana-hero ${corriendo ? 'en-marcha' : ''}">
      <div class="rana-emoji">🐸</div>
      <div class="rana-cuerpo">
        <span class="rana-etiqueta">${rana.es_rana ? 'Tu rana de hoy' : 'Lo más importante hoy'}</span>
        <a href="#" class="rana-titulo" data-detalle="${rana.id}">${esc(rana.titulo)}</a>
        ${detalle.length ? `<div class="rana-detalle">${detalle.join(' · ')}</div>` : ''}
        ${rana.subtareas_total ? `<div class="progreso fino"><div style="width:${rana.progreso_pct}%"></div></div>` : ''}
      </div>
      ${boton}
    </section>`;
  } else {
    bloqueRana = `<section class="tarjeta rana-hero vacia">
      <div class="rana-emoji">🐸</div>
      <div class="rana-cuerpo"><span class="rana-etiqueta">Tu rana de hoy</span>
        <span class="rana-titulo apagado">Aún no eliges tu tarea más importante</span>
        <div class="rana-detalle">Márcala como 🐸 al crearla o editarla y hazla primero.</div></div>
    </section>`;
  }

  // ── Resumen: una línea discreta; el rojo solo aparece si hay vencidas
  const nVenc = abiertas.filter((t) => t.vencida).length;
  const resumen = `<div class="resumen-hoy">
      <div><b>${abiertas.length}</b><span>pendientes</span></div>
      <div class="${nVenc ? 'con-vencidas' : ''}"><b>${nVenc}</b><span>vencida${nVenc === 1 ? '' : 's'}</span></div>
      <div><b>${completadasHoy.length}</b><span>hechas hoy</span></div>
      <div><b>${fmtMin(stats.minutos_foco)}</b><span>de foco${stats.racha_dias ? ` · 🔥 ${stats.racha_dias}` : ''}</span></div>
      ${st.ia.activa && abiertas.length ? '<div class="resumen-ia"><button class="ia-btn" data-ia-plan title="La IA ordena tus pendientes para hoy (método de la rana)">✨ Planear mi día</button></div>' : ''}
    </div>`;

  const panel = (titulo, lista, vacio, tipo) => `
    <section class="tarjeta panel-hoy">
      <h3>${titulo}${lista.length ? ` <span class="cuenta ${tipo === 'urgente' ? 'roja' : ''}">${lista.length}</span>` : ''}</h3>
      <div class="panel-cuerpo">${lista.length ? `<ul class="filas-hoy">${lista.map((t) => filaHoy(t, tipo)).join('')}</ul>` : `<div class="vacio-hoy">${vacio}</div>`}</div>
    </section>`;

  return `<div class="hoy">
    <div class="hoy-sup">
      <div class="frase-suave" title="${esc(frase.principio)} — ${esc(frase.practica)}">
        <span class="comillas">“</span>
        <div><p>${esc(frase.texto)}</p><small>${frase.ia ? '<span class="frase-ia" title="Frase de hoy generada con IA según tus pendientes">✨</span> ' : ''}${esc(frase.principio)} · 💡 ${esc(frase.practica)}</small></div>
        <button class="ico" data-otra-frase title="Otra frase">↻</button>
      </div>
      ${resumen}
    </div>

    <div class="hoy-medio">
      ${bloqueRana}
      <form id="f-rapida" class="tarjeta captura">
        <input name="titulo" placeholder="＋ Anota un pendiente y presiona Enter" autocomplete="off">
        <div class="captura-opciones">
          ${selectorCategoria(st.ultimaCategoria || 'General')}
          <select name="prioridad" title="Prioridad">${Object.keys(PRIORIDADES).map((p) => `<option ${p === 'B' ? 'selected' : ''}>${p}</option>`).join('')}</select>
          ${st.ia.activa ? '<button type="button" class="ia-btn ico-ia" data-ia-interpretar title="Completar con IA: escribe la tarea como la dirías (fecha, prioridad, entregable…) y revisa el formulario antes de guardar">✨</button>' : ''}
          <button class="secundario">Agregar</button>
        </div>
      </form>
    </div>

    <div class="hoy-paneles">
      ${panel('En curso', sinRana(enCurso), rana && rana.estado === 'en_progreso' ? '🐸 Tu rana está en marcha.<br>Una cosa a la vez.' : 'Nada en curso.<br>Empieza por tu rana.', 'curso')}
      ${panel('Vencidas y por vencer', sinRana([...vencidas, ...pronto]), '✨ Todo al día.', 'urgente')}
      ${panel('Otras tareas A', prioA, 'No hay más tareas A.', 'a')}
    </div>
  </div>`;
}

const ICO_PLAY = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9-5.5z"/></svg>';
const ICO_PAUSA = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>';
const ICO_OK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5l3.2 3L13 4.5"/></svg>';

/** Fecha corta y amable: «hoy 17:00», «mañana 9:30», «mié 12 nov». */
function cuandoCorto(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T23:59:00' : iso);
  const hoyD = new Date(); hoyD.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const n = Math.round((dia - hoyD) / 86400000);
  const hora = iso.length > 10 ? ` ${d.getHours()}:${pad(d.getMinutes())}` : '';
  if (n === 0) return `hoy${hora}`;
  if (n === 1) return `mañana${hora}`;
  if (n === -1) return `ayer${hora}`;
  return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
}

/** Fila simple para los paneles de Hoy: prioridad, título, un dato clave y una acción discreta. */
function filaHoy(t, tipo) {
  let dato = '', claseDato = '';
  if (t.novedad) { dato = `● ${esc(recorte(t.novedad, 40))}`; claseDato = 'txt-rojo'; }
  else if (t.novedades_sub && t.novedades_sub.length) { dato = `● ${t.novedades_sub.length === 1 ? `${esc(t.novedades_sub[0].titulo)}: ${esc(recorte(t.novedades_sub[0].novedad, 30))}` : `${t.novedades_sub.length} subtareas con novedad`}`; claseDato = 'txt-rojo'; }
  else if (t.subtarea_en_curso) { dato = `▶ ${esc(t.subtarea_en_curso.titulo)}`; claseDato = 'txt-acento'; }
  else if (t.estado === 'en_progreso') { dato = `▶ en marcha${t.tiempo_real_min >= 1 ? ` · ${fmtMin(t.tiempo_real_min)}` : ''}`; claseDato = 'txt-acento'; }
  else if (t.vencida) { dato = `Vencida hace ${fmtDias(t.dias_atraso)}`; claseDato = 'txt-rojo'; }
  else if (t.horas_restantes != null && t.horas_restantes <= 24) { dato = `Vence ${t.horas_restantes < 1 ? `en ${Math.max(1, Math.round(t.horas_restantes * 60))} min` : cuandoCorto(t.fecha_limite)}`; claseDato = 'txt-ambar'; }
  else if (t.bloqueada) dato = '🔒 en espera';
  else if (t.estado === 'pausada') dato = t.tiempo_real_min ? `Pausada · ${fmtMin(t.tiempo_real_min)}` : 'Pausada';
  else if (t.fecha_limite) dato = `Vence ${cuandoCorto(t.fecha_limite)}`;
  const avance = t.subtareas_total ? `<span class="fila-avance">${t.subtareas_hechas}/${t.subtareas_total}</span>` : '';

  const sig = t.tiempo_por_subtareas ? siguienteSubtarea(t) : null;
  let accion;
  if (t.subtarea_en_curso) accion = `<button class="fila-btn activo" data-sub-accion="pausar" data-sub="${t.subtarea_en_curso.id}" data-tarea="${t.id}" title="Pausar">${ICO_PAUSA}</button>`;
  else if (t.estado === 'en_progreso') accion = `<button class="fila-btn activo" data-accion="pausar" data-id="${t.id}" title="Pausar">${ICO_PAUSA}</button>`;
  else if (sig) accion = `<button class="fila-btn" data-sub-accion="iniciar" data-sub="${sig.id}" data-tarea="${t.id}" title="Iniciar «${esc(sig.titulo)}»">${ICO_PLAY}</button>`;
  else accion = `<button class="fila-btn" data-accion="iniciar" data-id="${t.id}" title="${t.estado === 'pausada' ? 'Reanudar' : 'Iniciar'}">${ICO_PLAY}</button>`;

  return `<li class="fila-hoy ${tipo === 'urgente' && t.vencida ? 'urgente' : ''}">
    <span class="punto-prio prio-${t.prioridad}" title="Prioridad ${t.prioridad}"></span>
    <a href="#" class="fila-txt" data-detalle="${t.id}">
      <span class="fila-titulo">${t.es_rana ? '🐸 ' : ''}${esc(t.titulo)}</span>
      ${dato || avance ? `<span class="fila-dato ${claseDato}">${dato}${dato && avance ? ' · ' : ''}${avance}</span>` : ''}
    </a>
    <span class="fila-acciones">${accion}<button class="fila-btn ok" data-accion="completar" data-id="${t.id}" title="Completar">${ICO_OK}</button></span>
  </li>`;
}

function filtrarTareas() {
  const f = st.filtros;
  const q = f.q.trim().toLowerCase();
  return st.tareas.filter((t) => {
    if (f.estado === 'abiertas' && !abierta(t)) return false;
    if (f.estado === 'vencidas' && !t.vencida) return false;
    if (f.estado === 'bloqueadas' && !t.bloqueada) return false;
    if (f.estado === 'disponibles' && (!abierta(t) || t.bloqueada)) return false;
    if (!['abiertas', 'vencidas', 'todas', 'bloqueadas', 'disponibles'].includes(f.estado) && t.estado !== f.estado) return false;
    if (f.prioridad && t.prioridad !== f.prioridad) return false;
    if (f.categoria && t.categoria !== f.categoria) return false;
    if (q && !`${t.titulo} ${t.descripcion || ''} ${t.categoria}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    if (abierta(a) !== abierta(b)) return abierta(a) ? -1 : 1;
    if (!abierta(a)) return (b.completada_en || b.actualizada_en || '').localeCompare(a.completada_en || a.actualizada_en || '');
    return ordenPrioridad(a, b);
  });
}

function htmlListaTareas() {
  const lista = filtrarTareas();
  const todas = lista.length && lista.every((t) => st.expandidas.has(t.id));
  return `<div class="lista-cab"><span class="sutil">${lista.length} tarea(s)</span>
      ${lista.length ? `<button class="enlace" data-desplegar-todas="${todas ? '0' : '1'}">${todas ? '⌃ Contraer todas' : '⌄ Desplegar todas'}</button>` : ''}</div>`
    + listaTareas(lista, '<span class="grande">🔍</span>No hay tareas con esos filtros.');
}
function pintarListaTareas() {
  const el = $('#lista-tareas');
  if (el) el.innerHTML = htmlListaTareas();
}

async function vistaTareas() {
  await Promise.all([cargarTareas(), cargarMetas(), cargarCatalogos()]);
  const f = st.filtros;
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${sel === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `
    <div class="filtros">
      <input id="f-q" placeholder="Buscar…" value="${esc(f.q)}">
      <select id="f-estado">
        ${opt('abiertas', 'Abiertas', f.estado)}${opt('disponibles', 'Disponibles (sin bloqueo)', f.estado)}${opt('bloqueadas', '🔒 Bloqueadas', f.estado)}${opt('vencidas', 'Vencidas', f.estado)}
        ${Object.entries(ESTADOS).map(([k, v]) => opt(k, v, f.estado)).join('')}${opt('todas', 'Todas', f.estado)}
      </select>
      <select id="f-prioridad">${opt('', 'Toda prioridad', f.prioridad)}${Object.keys(PRIORIDADES).map((p) => opt(p, 'Prioridad ' + p, f.prioridad)).join('')}</select>
      <select id="f-categoria">${opt('', 'Toda categoría', f.categoria)}${categorias().map((c) => opt(c, prefijoEmoji(c) + c, f.categoria)).join('')}</select>
    </div>
    <div id="lista-tareas">${htmlListaTareas()}</div>`;
}

function tarjetaMeta(m) {
  const puntos = [1, 2, 3, 4, 5].map((n) => `<span class="punto ${n <= m.nivel_actual ? 'lleno' : ''} ${n === m.nivel_objetivo ? 'meta' : ''}"></span>`).join('');
  const estadoChip = m.estado === 'lograda' ? '<span class="chip verde">🏆 Lograda</span>' : m.estado === 'pausada' ? '<span class="chip">Pausada</span>' : '';
  let plazo = 'Sin fecha';
  if (m.dias_restantes != null) plazo = m.dias_restantes < 0 ? `Venció hace ${-m.dias_restantes} d` : `${m.dias_restantes} días`;
  return `<div class="tarjeta">
    <div class="meta-cab">
      <div><h3>${esc(m.herramienta)}</h3><span class="sutil">${esc(m.categoria || '')}${m.fecha_objetivo ? ' · meta ' + fmtFecha(m.fecha_objetivo, false) : ''}</span> ${estadoChip}</div>
      <div class="meta-pct">${m.progreso_pct}%</div>
    </div>
    ${m.descripcion ? `<p class="sutil" style="margin:8px 0 0">${esc(m.descripcion)}</p>` : ''}
    <div class="progreso" style="margin-top:12px"><div style="width:${m.progreso_pct}%"></div></div>
    <div class="niveles" style="margin-top:10px">Nivel ${m.nivel_actual} → ${m.nivel_objetivo} ${puntos}</div>
    <div class="datos">
      <div><b>${m.horas_acumuladas} / ${m.horas_objetivo} h</b><span>Horas de práctica</span></div>
      <div><b>${plazo}</b><span>Plazo restante</span></div>
      <div><b>${m.ritmo_semanal_necesario != null ? m.ritmo_semanal_necesario + ' h' : '—'}</b><span>Ritmo semanal necesario</span></div>
    </div>
    <div class="sutil" style="font-size:.8rem">Hitos ${m.hitos_completados}/${m.hitos.length} · ${m.tareas_vinculadas} tarea(s) vinculada(s) (${m.horas_tareas} h) · última práctica: ${m.ultima_practica ? fmtFecha(m.ultima_practica, false) : 'nunca'}</div>
    <ul class="hitos">${m.hitos.map((h) => `<li class="${h.completado ? 'hecho' : ''}">
      <input type="checkbox" data-hito="${h.id}" ${h.completado ? 'checked' : ''}><span>${esc(h.titulo)}</span>
      <button class="ico" data-borrar-hito="${h.id}" title="Quitar hito">✕</button></li>`).join('')}</ul>
    <form class="f-hito" data-meta="${m.id}"><input name="titulo" placeholder="+ Agregar hito (ej. dominar CALCULATE en DAX)" autocomplete="off"></form>
    <div class="pie-meta">
      <button class="mini ok" data-practica="${m.id}">+ Registrar práctica</button>
      <button class="mini" data-registros="${m.id}">Registros</button>
      <button class="mini" data-editar-meta="${m.id}">✎ Editar</button>
      <button class="ico" data-eliminar-meta="${m.id}" title="Eliminar meta">🗑</button>
    </div>
  </div>`;
}

async function vistaMetas() {
  await Promise.all([cargarMetas(), cargarTareas(), cargarCatalogos()]);
  const activas = st.metas.filter((m) => m.estado === 'activa');
  const horas = st.metas.reduce((s, m) => s + m.horas_acumuladas, 0);
  const prom = activas.length ? Math.round(activas.reduce((s, m) => s + m.progreso_pct, 0) / activas.length) : 0;
  return `
    <div class="rejilla r4">
      ${kpi(activas.length, 'Metas activas', '', 'azul')}
      ${kpi(st.metas.filter((m) => m.estado === 'lograda').length, 'Metas logradas', '', 'verde')}
      ${kpi(horas.toFixed(1) + ' h', 'Horas invertidas en aprender')}
      ${kpi(prom + '%', 'Avance promedio (activas)')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 14px">
      <p class="sutil">Define la herramienta, el nivel al que quieres llegar, horas y fecha. Vincula tareas para que su tiempo sume.</p>
      <button class="primario" data-nueva-meta>+ Nueva meta</button>
    </div>
    ${st.metas.length ? `<div class="metas">${st.metas.map(tarjetaMeta).join('')}</div>`
      : `<div class="tarjeta vacio"><span class="grande">◆</span>Aún no tienes metas de aprendizaje. Crea la primera (por ejemplo: Power BI — DAX avanzado).</div>`}`;
}

async function vistaRendimiento() {
  const [s] = await Promise.all([api(`/api/estadisticas?dias=${st.periodo}`), cargarCatalogos()]);
  const pct = (v) => (v == null ? '—' : v + '%');
  const serieComp = s.serie.map((d) => ({ etiqueta: fmtFecha(d.fecha, false), corta: d.fecha.slice(8) + '/' + d.fecha.slice(5, 7), valor: d.completadas }));
  const serieFoco = s.serie.map((d) => ({ etiqueta: fmtFecha(d.fecha, false), corta: d.fecha.slice(8) + '/' + d.fecha.slice(5, 7), valor: d.minutos_foco + d.minutos_aprendizaje }));
  const colores = { A: 'var(--pA)', B: 'var(--pB)', C: 'var(--pC)', D: 'var(--pD)', E: 'var(--pE)' };
  let ratio = '—', ratioTxt = 'Pon estimados a tus tareas';
  if (s.ratio_real_vs_estimado != null) {
    ratio = s.ratio_real_vs_estimado + '×';
    ratioTxt = s.ratio_real_vs_estimado > 1.1 ? 'Subestimas: tardas más de lo planeado' : s.ratio_real_vs_estimado < 0.9 ? 'Sobrestimas tus tiempos' : 'Estimas con buena precisión';
  }
  return `
    <div class="filtros">
      <select id="f-periodo">${[7, 14, 30, 90, 180, 365].map((d) => `<option value="${d}" ${st.periodo === d ? 'selected' : ''}>Últimos ${d} días</option>`).join('')}</select>
      ${st.ia.activa ? '<button class="ia-btn" data-ia-analisis>✨ Analizar mi rendimiento</button>' : ''}
    </div>
    <div class="rejilla r2">
      <div class="tarjeta puntaje">
        <div class="anillo" style="--p:${s.puntaje ?? 0}"><div>${s.puntaje ?? '—'}</div></div>
        <div><h3 style="margin-bottom:6px">Puntaje de rendimiento</h3>
          <ul class="leyenda" style="padding-left:16px;margin:0">
            <li>40 % entregas a tiempo: <b>${pct(s.tasa_a_tiempo_pct)}</b></li>
            <li>30 % cumplimiento (completadas/creadas): <b>${pct(s.tasa_cumplimiento_pct)}</b></li>
            <li>20 % foco en lo vital (A+B): <b>${pct(s.foco_vital_pct)}</b></li>
            <li>10 % precisión de estimación</li>
          </ul></div>
      </div>
      <div class="rejilla r2">
        ${kpi(s.completadas, 'Completadas', `${s.creadas} creadas · ${s.canceladas} canceladas · ${s.subtareas_completadas} subtareas ✓`, 'verde')}
        ${kpi(`${s.racha_dias} 🔥`, 'Racha de días', 'con al menos 1 tarea completada')}
        ${kpi(fmtMin(s.minutos_foco), 'Tiempo de foco', `+ ${fmtMin(s.minutos_aprendizaje)} de práctica`, 'azul')}
        ${kpi(s.ranas_completadas + ' 🐸', 'Ranas comidas')}
      </div>
    </div>
    <div class="rejilla r4 mt">
      ${kpi(`${s.a_tiempo} / ${s.a_tiempo + s.tarde}`, 'Entregas a tiempo', 'de las que tenían fecha límite')}
      ${kpi(s.promedio_atraso_dias != null ? fmtDias(s.promedio_atraso_dias) : '—', 'Atraso promedio', 'en las que se entregaron tarde', s.tarde ? 'rojo' : '')}
      ${kpi(s.promedio_ciclo_horas != null ? fmtDias(s.promedio_ciclo_horas / 24) : '—', 'Ciclo promedio', 'desde creada hasta completada')}
      ${kpi(ratio, 'Real vs. estimado', ratioTxt)}
    </div>
    <div class="rejilla r4 mt">
      ${kpi(s.abiertas, 'Abiertas ahora')}
      ${kpi(s.vencidas_abiertas, 'Vencidas ahora', '', s.vencidas_abiertas ? 'rojo' : '')}
      ${kpi(s.reprogramaciones, 'Reprogramaciones', 'cambios de fecha límite en el periodo')}
      ${kpi(pct(s.foco_vital_pct), 'Foco en lo vital', 'regla 80/20: % de logros A o B')}
    </div>
    <div class="rejilla r2 mt">
      <div class="tarjeta"><h3>Tareas completadas por día</h3>${graficoBarras(serieComp, (v) => v + ' tarea(s)', 'verde')}</div>
      <div class="tarjeta"><h3>Minutos de foco + aprendizaje por día</h3>${graficoBarras(serieFoco, fmtMin)}</div>
    </div>
    <div class="rejilla r2 mt">
      <div class="tarjeta"><h3>Completadas por prioridad <small>abiertas entre paréntesis</small></h3>
        ${barrasH(s.por_prioridad.map((p) => ({ etiqueta: `${p.prioridad} (${p.abiertas})`, valor: p.completadas, color: colores[p.prioridad] })))}</div>
      <div class="tarjeta"><h3>Completadas por categoría</h3>
        ${barrasH(s.por_categoria.map((c) => ({ etiqueta: c.categoria, html: iconoCategoria(c.categoria) + esc(c.categoria), valor: c.completadas })))}</div>
    </div>`;
}

async function vistaHistorial() {
  const pestanas = `<div class="pestanas" role="tablist">
      <button role="tab" class="${st.hist.tab === 'semana' ? 'activo' : ''}" data-hist-tab="semana">📅 Reporte semanal</button>
      <button role="tab" class="${st.hist.tab === 'bitacora' ? 'activo' : ''}" data-hist-tab="bitacora">📜 Bitácora de eventos</button>
    </div>`;
  return pestanas + (st.hist.tab === 'semana' ? await vistaSemana() : await vistaBitacora());
}

async function vistaBitacora() {
  const eventos = await api('/api/historial?limite=400');
  if (!eventos.length) return '<div class="tarjeta vacio">Todavía no hay movimientos.</div>';
  return `<div class="tarjeta tabla-scroll"><table>
    <thead><tr><th>Momento</th><th>Tarea</th><th>Evento</th><th>Estado</th><th>Detalle</th></tr></thead>
    <tbody>${eventos.map((e) => `<tr>
      <td style="white-space:nowrap">${fmtFecha(e.momento)}</td>
      <td><span class="prio prio-${e.prioridad}" style="display:inline-grid;width:22px;height:22px;font-size:.7rem;border-radius:6px;margin-right:6px">${e.prioridad}</span>
        <a href="#" data-detalle="${e.tarea_id}">${esc(e.titulo)}</a></td>
      <td>${EVENTOS[e.tipo] || esc(e.tipo)}</td>
      <td class="sutil">${e.estado_anterior && e.estado_nuevo && e.estado_anterior !== e.estado_nuevo ? `${ESTADOS[e.estado_anterior] || e.estado_anterior} → ${ESTADOS[e.estado_nuevo] || e.estado_nuevo}` : ''}</td>
      <td class="sutil">${esc(e.detalle || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ─────────── Reporte semanal día por día ─────────── */
const fechaDia = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
const textoRangoSemana = (s) => {
  const a = new Date(s.desde + 'T00:00:00'), b = new Date(s.hasta + 'T00:00:00');
  const anioFin = b.getFullYear();
  return a.getFullYear() !== anioFin
    ? `lunes ${fechaDia(s.desde)} de ${a.getFullYear()} al domingo ${fechaDia(s.hasta)} de ${anioFin}`
    : `lunes ${fechaDia(s.desde)} al domingo ${fechaDia(s.hasta)} de ${anioFin}`;
};
const enlaceTarea = (t) => `<span class="prio prio-${t.prioridad} prio-mini">${t.prioridad}</span><a href="#" data-detalle="${t.id}">${esc(t.titulo)}</a>`;

function tarjetaDia(d) {
  const etiquetas = [];
  if (d.hoy) etiquetas.push('<span class="chip azul">Hoy</span>');
  if (d.festivo) etiquetas.push(`<span class="chip festivo">🎉 Festivo · ${esc(d.festivo)}</span>`);
  else if (d.fin_de_semana) etiquetas.push('<span class="chip">Fin de semana</span>');
  const nTotal = d.completadas.length + d.subtareas.length + d.trabajadas.length + d.comentarios.length + d.practica.length + d.novedades.length;
  const cifras = [];
  if (d.completadas.length) cifras.push(`<b>${d.completadas.length}</b> completada${d.completadas.length === 1 ? '' : 's'}`);
  if (d.subtareas.length) cifras.push(`<b>${d.subtareas.length}</b> subtarea${d.subtareas.length === 1 ? '' : 's'}`);
  if (d.minutos_foco) cifras.push(`<b>${fmtMin(d.minutos_foco)}</b> de foco`);
  if (d.minutos_practica) cifras.push(`<b>${fmtMin(d.minutos_practica)}</b> de práctica`);
  const nNov = d.novedades.filter((n) => !n.resuelta).length;
  if (nNov) cifras.push(`<b class="txt-rojo">${nNov}</b> novedad${nNov === 1 ? '' : 'es'}`);

  const seccion = (titulo, items) => (items.length ? `<div class="dia-sec"><h4>${titulo}</h4><ul>${items.join('')}</ul></div>` : '');
  const cuerpo = nTotal ? [
    seccion('✅ Tareas completadas', d.completadas.map((t) => `<li>${enlaceTarea(t)}
      <span class="chip ${t.a_tiempo === false ? 'rojo' : t.a_tiempo ? 'verde' : ''}">${t.a_tiempo === false ? `con ${fmtDias(t.dias_atraso)} de atraso` : t.a_tiempo ? 'a tiempo' : 'sin fecha límite'}</span>
      <small>${esc(t.hora)}${t.entregable ? ` · 📦 ${esc(t.entregable)}` : ''}</small></li>`)),
    seccion('☑ Subtareas completadas', d.subtareas.map((s) => `<li>${s.es_entregable ? '📦 ' : ''}${esc(s.titulo)}
      <small>de ${enlaceTarea(s.tarea)} · ${esc(s.hora)}</small></li>`)),
    seccion('⏱ Tiempo trabajado', d.trabajadas.map((t) => `<li>${enlaceTarea(t)} <span class="chip">${fmtMin(t.minutos)}</span>
      ${t.por_subtarea && t.por_subtarea.length ? `<small class="desglose-sub">${t.por_subtarea.map((x) => `${esc(x.titulo)} ${fmtMin(x.minutos)}`).join(' · ')}</small>` : ''}
      ${(t.notas || []).map((n) => `<div class="nota-dia"><span class="nota-hora">${esc(n.hora)}–${esc(n.fin)} · ${fmtMin(n.minutos)}${n.subtarea ? ` · ${esc(n.subtarea)}` : ''}</span>📝 ${esc(n.nota)}</div>`).join('')}</li>`)),
    seccion('💬 Comentarios', d.comentarios.map((c) => `<li><span class="coment-dia">${esc(c.texto)}</span>
      <small>en ${enlaceTarea(c.tarea)} · ${esc(c.hora)}</small></li>`)),
    seccion('● Novedades', d.novedades.map((n) => `<li class="${n.resuelta ? 'nov-resuelta' : 'nov-abierta'}">
      <span>${n.resuelta ? '✓' : '●'} ${esc(n.texto)}</span><small>en ${enlaceTarea(n.tarea)} · ${esc(n.hora)}</small></li>`)),
    seccion('📚 Aprendizaje', d.practica.map((p) => `<li>${esc(p.meta)} <span class="chip">${fmtMin(p.minutos)}</span>${p.nota ? ` <small>${esc(p.nota)}</small>` : ''}</li>`)),
  ].join('') : `<div class="dia-vacio">${d.futuro ? 'Aún no llega' : d.festivo ? '🎉 Día festivo · sin actividad' : d.fin_de_semana ? 'Fin de semana · sin actividad' : 'Sin actividad registrada'}</div>`;

  return `<section class="tarjeta dia ${d.festivo ? 'es-festivo' : ''} ${d.fin_de_semana ? 'es-finde' : ''} ${d.hoy ? 'es-hoy' : ''} ${d.futuro ? 'es-futuro' : ''}">
    <header class="dia-cab">
      <div><b>${d.dia_semana}</b> <span class="sutil">${fechaDia(d.fecha)}</span> ${etiquetas.join(' ')}</div>
      <div class="dia-cifras">${cifras.join(' · ')}</div>
    </header>
    ${cuerpo}
  </section>`;
}

async function vistaSemana() {
  const q = st.hist.anio ? `?anio=${st.hist.anio}&semana=${st.hist.semana}` : '';
  const s = await api(`/api/semana${q}`);
  st.hist.anio = s.anio; st.hist.semana = s.semana;
  const r = s.resumen;
  const anioActual = new Date().getFullYear();
  const anios = [];
  for (let a = anioActual - 3; a <= anioActual + 1; a++) anios.push(a);
  const fuente = { api: 'consultados en línea (Nager.Date)', guardado: 'de la API, guardados', calculado: 'calculados localmente (sin conexión a la API)' }[s.festivos_fuente];
  return `
    <div class="semana-filtros">
      <button class="mini" data-semana-ir="${s.anterior.anio}-${s.anterior.semana}" title="Semana anterior">‹</button>
      <label class="semana-sel">Semana
        <input type="number" id="h-semana" min="1" max="${s.semanas_del_anio}" value="${s.semana}"></label>
      <label class="semana-sel">Año
        <select id="h-anio">${anios.map((a) => `<option ${a === s.anio ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <button class="mini" data-semana-ir="${s.siguiente.anio}-${s.siguiente.semana}" title="Semana siguiente">›</button>
      ${s.es_actual ? '<span class="chip azul">semana actual</span>' : '<button class="mini" data-semana-ir="hoy">Esta semana</button>'}
      <div class="semana-rango"><b>Semana ${s.semana}</b> · del ${textoRangoSemana(s)}</div>
      ${st.ia.activa ? '<button class="ia-btn" data-ia-resumen>✨ Redactar resumen</button>' : ''}
    </div>

    <div class="rejilla r4 semana-kpis">
      ${kpi(r.completadas, 'Tareas completadas', r.completadas ? `${r.a_tiempo} a tiempo · ${r.subtareas} subtareas` : `${r.subtareas} subtareas`, 'verde')}
      ${kpi(fmtMin(r.minutos_foco), 'Tiempo de foco', r.minutos_practica ? `+ ${fmtMin(r.minutos_practica)} de práctica` : '', 'azul')}
      ${kpi(`${r.dias_habiles} <small class="kpi-sub">de 5</small>`, 'Días hábiles', s.festivos_semana.length ? `🎉 ${s.festivos_semana.map((f) => esc(f.nombre)).join(', ')}` : 'sin festivos esta semana')}
      ${kpi(r.promedio_por_dia_habil ?? '—', 'Completadas por día hábil', `${r.dias_con_actividad} día(s) con actividad${r.novedades ? ` · ● ${r.novedades} novedad${r.novedades === 1 ? '' : 'es'}` : ''}`)}
    </div>

    <div class="dias">${s.dias.map(tarjetaDia).join('')}</div>
    <p class="sutil fuente-festivos">Festivos de Colombia ${fuente}.
      ${s.festivos_fuente === 'calculado' ? `<button class="enlace" data-festivos-actualizar="${s.anio}">Reintentar consulta en línea</button>` : ''}</p>`;
}

const VISTAS = {
  hoy: ['Hoy', vistaHoy],
  tareas: ['Tareas', vistaTareas],
  metas: ['Metas de aprendizaje', vistaMetas],
  rendimiento: ['Rendimiento', vistaRendimiento],
  historial: ['Historial', vistaHistorial],
};

async function render() {
  const [titulo, fn] = VISTAS[st.vista];
  $('#titulo-vista').textContent = titulo;
  $$('#nav button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === st.vista));
  document.body.classList.toggle('modo-pantalla', st.vista === 'hoy');
  // En Metas de aprendizaje solo se ofrece «+ Nueva meta» (dentro de la vista).
  $('#btn-nueva').classList.toggle('oculto', st.vista === 'metas');
  const misma = st.vistaPintada === st.vista;
  const y = window.scrollY;
  const paneles = $$('#vista .panel-cuerpo, #vista .tabla-scroll').map((e) => e.scrollTop);
  let html;
  try {
    html = await fn();
  } catch (e) {
    html = `<div class="tarjeta vacio">No se pudo cargar: ${esc(e.message)}</div>`;
  }
  $('#vista').innerHTML = html;
  if (misma) {
    // Actualización de la misma vista (marcar una subtarea, completar, etc.): quedarse donde estaba.
    window.scrollTo(0, y);
    $$('#vista .panel-cuerpo, #vista .tabla-scroll').forEach((e, i) => { e.scrollTop = paneles[i] || 0; });
  } else {
    window.scrollTo(0, 0);
  }
  st.vistaPintada = st.vista;
}

async function refrescar() { await render(); revisarAlertas(); }

/* ─────────── modales y formularios ─────────── */
function abrirModal(html, { enfocar = true } = {}) {
  const caja = $('#modal-caja');
  caja.innerHTML = html;
  delete caja.dataset.detalleAbierto;
  $('#modal').classList.remove('oculto', 'opaco');
  caja.scrollTop = 0;
  const f = enfocar && $('#modal-caja input:not([type=checkbox]):not([type=hidden]), #modal-caja textarea');
  if (f) f.focus({ preventScroll: true });
}
function cerrarModal() { $('#modal').classList.add('oculto'); $('#modal').classList.remove('opaco'); $('#modal-caja').innerHTML = ''; $('#modal-caja').classList.remove('modal-ancho'); }

function selectorCategoria(actual = 'General', nombre = 'categoria') {
  const lista = categorias();
  if (actual && !lista.some((c) => c.toLowerCase() === actual.toLowerCase())) lista.unshift(actual);
  return `<select name="${nombre}" data-selector-categoria>
      ${lista.map((c) => `<option value="${esc(c)}" ${c.toLowerCase() === (actual || '').toLowerCase() ? 'selected' : ''}>${esc(prefijoEmoji(c) + c)}</option>`).join('')}
      <option value="__nueva__">＋ Nueva categoría…</option>
    </select>
    <input name="${nombre}_nueva" class="oculto" placeholder="Nombre de la nueva categoría" maxlength="60">`;
}

function selectorDescripcion() {
  const ds = st.catalogos.descripciones;
  if (!ds.length) return '';
  const corta = (s) => (s.length > 70 ? s.slice(0, 70) + '…' : s).replace(/\s+/g, ' ');
  return `<select data-usar-descripcion style="margin-bottom:6px">
      <option value="">📋 Usar una descripción guardada… (${ds.length})</option>
      ${ds.map((d) => `<option value="${d.id}">${esc(corta(d.texto))}</option>`).join('')}
    </select>`;
}

const filaSubtarea = (s = {}) => `<div class="sub-fila" data-sub-id="${s.id || ''}">
    <span class="sub-estado" title="${s.completada ? 'Completada' : 'Pendiente'}">${s.completada ? '✓' : '○'}</span>
    <input class="sub-input" value="${esc(s.titulo || '')}" placeholder="Ej. U108 — actualizar fecha de ejecución" maxlength="200" autocomplete="off">
    <button type="button" class="ico" data-quitar-sub title="Quitar">✕</button>
  </div>`;

function editorSubtareas(subs) {
  return `<div class="sub-editor">
    <div class="sub-filas">${subs.map(filaSubtarea).join('')}</div>
    <button type="button" class="mini" data-agregar-sub>+ Agregar subtarea</button>
    ${st.ia.activa ? '<button type="button" class="ia-btn mini" data-ia-subtareas title="La IA propone los pasos a partir del título, la descripción y el entregable">✨ Sugerir pasos</button>' : ''}
    <span class="ayuda">Enter agrega otra · puedes pegar una lista (una por línea)</span>
  </div>`;
}

function agregarFilaSub(despuesDe = null, titulo = '') {
  const cont = $('#f-tarea .sub-filas');
  const tmp = document.createElement('div');
  tmp.innerHTML = filaSubtarea({ titulo });
  const fila = tmp.firstElementChild;
  if (despuesDe) despuesDe.after(fila); else cont.appendChild(fila);
  return fila;
}

async function formTarea(t = {}) {
  await Promise.all([st.metas.length ? null : cargarMetas().catch(() => {}), cargarCatalogos().catch(() => {}),
    st.tareas.length ? null : cargarTareas().catch(() => {})]);
  const metas = st.metas.filter((m) => m.estado !== 'lograda' || m.id === t.meta_id);
  const dup = t._duplicado;
  abrirModal(`<h2>${dup ? '⧉ Duplicar tarea' : t.id ? 'Editar tarea' : 'Nueva tarea'}</h2>
    ${dup ? `<p class="aviso-dup">Copia de «${esc(dup.original.titulo)}». Revisa y ajusta lo que necesites antes de guardar.
      No se copian los comentarios ni el historial (eventos, tiempo trabajado, fechas de inicio y completado); las subtareas quedan sin marcar.</p>` : ''}
    <form id="f-tarea" data-id="${t.id || ''}" ${dup ? `data-original="${dup.original.id}"` : ''}>
      ${dup ? `<input type="hidden" name="duplicada_de" value="${dup.duplicada_de}">` : ''}
      ${t._ia ? `<p class="aviso-ia">✨ Completado con IA a partir de «${esc(recorte(t._ia, 140))}». Revisa los campos antes de guardar.</p>` : ''}
      ${st.ia.activa && !t.id && !dup && !t._ia ? `<div class="ia-caja">
        <textarea id="ia-texto-tarea" rows="2" maxlength="2000" placeholder="✨ Escríbela como la dirías: «revisar avance de hitos PHD el jueves en la mañana, prioridad A, entregable: informe a puntos focales»"></textarea>
        <button type="button" class="ia-btn" data-ia-interpretar-form>Completar campos</button>
      </div>` : ''}
      <label>Título<input name="titulo" required maxlength="200" value="${esc(t.titulo || '')}"></label>
      <label class="campo-entregable">📦 Entregable <span class="ayuda">¿Qué debe existir para dar esta tarea por terminada? Se agrega como la última subtarea.</span>
        <input name="entregable" maxlength="200" value="${esc(t.entregable || '')}" placeholder="Ej. Programa actualizado enviado a los puntos focales" autocomplete="off"></label>
      <label>Descripción${selectorDescripcion()}<textarea name="descripcion" rows="3">${esc(t.descripcion || '')}</textarea></label>
      <div class="fila">
        <label>Prioridad (método ABCDE)<select name="prioridad">${Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}" ${(t.prioridad || 'B') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Categoría${selectorCategoria(t.categoria || 'General')}</label>
      </div>
      <div class="fila">
        <label>Fecha límite<input type="datetime-local" name="fecha_limite" value="${esc((t.fecha_limite || '').slice(0, 16))}"></label>
        <label>Tiempo estimado (min)<input type="number" min="0" step="5" name="estimado_min" value="${t.estimado_min ?? ''}"></label>
      </div>
      <label>Meta de aprendizaje vinculada <span class="ayuda">(el tiempo de esta tarea sumará a la meta)</span>
        <select name="meta_id"><option value="">— Ninguna —</option>${metas.map((m) => `<option value="${m.id}" ${t.meta_id === m.id ? 'selected' : ''}>${esc(m.herramienta)}</option>`).join('')}</select></label>
      <label>Subtareas <span class="ayuda">(opcional · cada una se completa por separado y define el % de avance)</span></label>
      ${editorSubtareas((t.subtareas || []).filter((x) => !x.es_entregable))}
      <label>Depende de <span class="ayuda">(opcional · la tarea queda 🔒 bloqueada hasta que esto se complete)</span></label>
      ${editorDependencias(t)}
      ${t.id ? '' : `
      <div class="ya-completada">
        <label class="check"><input type="checkbox" name="ya_completada" data-toggle-completada> ✅ Ya está completada <span class="ayuda">(registrar algo que ya hiciste)</span></label>
        <div class="fila campos-completada oculto">
          <label>Fecha y hora de completado<input type="datetime-local" name="completada_en" value="${aLocalInput(new Date())}" max="${aLocalInput(new Date())}"></label>
          <label>Tiempo dedicado (min)<input type="number" name="minutos_dedicados" min="0" step="5" placeholder="Opcional · ej. 90"></label>
        </div>
      </div>`}
      ${t.estado === 'completada' ? `
      <div class="ya-completada">
        <label>✅ Fecha de completado <span class="ayuda">(corrígela si la marcaste tarde)</span>
          <input type="datetime-local" name="completada_en" value="${esc((t.completada_en || '').slice(0, 16))}" max="${aLocalInput(new Date())}"></label>
      </div>` : ''}
      ${dup && dup.adjuntos_total ? `<label class="check"><input type="checkbox" name="copiar_soporte" checked> 📎 Copiar también el soporte (${dup.adjuntos_total} archivo(s)/enlace(s))</label>` : ''}
      <label class="check"><input type="checkbox" name="es_rana" ${t.es_rana ? 'checked' : ''}> 🐸 Es mi “rana”: la tarea más importante y difícil, la hago primero</label>
      <div class="botones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button class="primario">Guardar</button></div>
    </form>`);
}

function formMeta(m = {}) {
  const niv = (name, val) => `<select name="${name}">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${val === n ? 'selected' : ''}>${n} · ${['Básico', 'Principiante', 'Intermedio', 'Avanzado', 'Experto'][n - 1]}</option>`).join('')}</select>`;
  abrirModal(`<h2>${m.id ? 'Editar' : 'Nueva'} meta de aprendizaje</h2>
    <form id="f-meta" data-id="${m.id || ''}">
      <label>Herramienta o tema<input name="herramienta" required value="${esc(m.herramienta || '')}" placeholder="Ej. Power BI — DAX avanzado"></label>
      <label>¿Para qué / qué quieres lograr?<textarea name="descripcion" rows="2">${esc(m.descripcion || '')}</textarea></label>
      <div class="fila">
        <label>Categoría<input name="categoria" value="${esc(m.categoria || 'Herramienta')}"></label>
        <label>Horas objetivo<input type="number" name="horas_objetivo" min="0" step="1" value="${m.horas_objetivo ?? 20}"></label>
      </div>
      <div class="fila">
        <label>Nivel actual${niv('nivel_actual', m.nivel_actual || 1)}</label>
        <label>Nivel objetivo${niv('nivel_objetivo', m.nivel_objetivo || 3)}</label>
      </div>
      <div class="fila">
        <label>Fecha objetivo<input type="date" name="fecha_objetivo" value="${esc(m.fecha_objetivo || '')}"></label>
        <label>Estado<select name="estado">${['activa', 'pausada', 'lograda'].map((e) => `<option value="${e}" ${(m.estado || 'activa') === e ? 'selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('')}</select></label>
      </div>
      <div class="botones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button class="primario">Guardar</button></div>
    </form>`);
}

function formPractica(m) {
  abrirModal(`<h2>Registrar práctica · ${esc(m.herramienta)}</h2>
    <form id="f-practica" data-meta="${m.id}">
      <div class="fila">
        <label>Minutos<input type="number" name="minutos" min="1" step="5" value="30" required></label>
        <label>Fecha<input type="date" name="fecha" value="${hoyISO()}"></label>
      </div>
      <label>¿Qué aprendiste o practicaste?<textarea name="nota" rows="3" placeholder="Ej. curso de Power Query, ejercicio de funciones de tabla…"></textarea></label>
      <div class="botones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button class="primario">Guardar</button></div>
    </form>`);
}

function verRegistros(m) {
  abrirModal(`<h2>Registros · ${esc(m.herramienta)}</h2>
    ${m.registros.length ? `<table><thead><tr><th>Fecha</th><th>Min</th><th>Nota</th><th></th></tr></thead><tbody>
      ${m.registros.map((r) => `<tr><td>${fmtFecha(r.fecha, false)}</td><td>${r.minutos}</td><td>${esc(r.nota)}</td>
      <td><button class="ico" data-borrar-registro="${r.id}" title="Borrar">🗑</button></td></tr>`).join('')}</tbody></table>
      <p class="sutil" style="margin-top:8px">Se muestran los últimos 15.</p>` : '<div class="vacio">Sin registros todavía.</div>'}
    <div class="botones"><button class="secundario" data-cerrar>Cerrar</button></div>`);
}

async function gestionarCatalogos(pestana = 'categorias') {
  await cargarCatalogos();
  const { categorias: cats, descripciones: descs } = st.catalogos;
  const tab = (id, txt) => `<button class="mini ${pestana === id ? 'ok' : ''}" data-tab-catalogo="${id}">${txt}</button>`;
  const cuerpo = pestana === 'categorias'
    ? `<form id="f-cat-nueva" class="rapida" style="margin-bottom:12px"><input name="nombre" placeholder="Nueva categoría (ej. Paradas PHD)" maxlength="60" required><button class="primario">Agregar</button></form>
       <table><thead><tr><th>Categoría</th><th>Tareas</th><th>Usos</th><th></th></tr></thead><tbody>
       ${cats.map((c) => `<tr><td>
           <button class="btn-cat-ico" data-editar-icono="${c.id}" title="Cambiar ícono o imagen">${iconoCategoria(c.nombre, 'cat-ico mediano') || '<span class="cat-ico mediano vacio-ico">＋</span>'}</button>
           <b>${esc(c.nombre)}</b></td><td>${c.tareas}</td><td>${c.usos}</td>
         <td style="text-align:right;white-space:nowrap">
           <button class="ico" data-editar-icono="${c.id}" title="Ícono o imagen">🖼</button>
           <button class="ico" data-renombrar-cat="${c.id}" data-nombre="${esc(c.nombre)}" title="Renombrar (actualiza las tareas)">✎</button>
           ${c.nombre.toLowerCase() === 'general' ? '' : `<button class="ico" data-borrar-cat="${c.id}" data-nombre="${esc(c.nombre)}" data-tareas="${c.tareas}" title="Eliminar">🗑</button>`}
         </td></tr>`).join('')}</tbody></table>`
    : `<form id="f-desc-nueva" style="margin-bottom:12px"><textarea name="texto" rows="2" placeholder="Nueva descripción reutilizable (ej. Revisar avance en STO, validar contra Prometheus y actualizar tablero)" required></textarea>
         <div class="botones" style="margin-top:6px"><button class="primario">Agregar</button></div></form>
       ${descs.length ? `<table><thead><tr><th>Descripción</th><th>Usos</th><th></th></tr></thead><tbody>
       ${descs.map((d) => `<tr><td style="white-space:pre-wrap">${esc(d.texto)}</td><td>${d.usos}</td>
         <td><button class="ico" data-borrar-desc="${d.id}" title="Quitar de las sugerencias">🗑</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="vacio">Aún no hay descripciones guardadas. Se guardan solas cada vez que escribes una en una tarea.</div>'}`;
  abrirModal(`<h2>Categorías y descripciones</h2>
    <p class="sutil" style="margin-bottom:12px">Todo lo que escribes en una tarea se guarda aquí para reutilizarlo. Puedes agregar, renombrar o quitar.</p>
    <div style="display:flex;gap:6px;margin-bottom:14px">${tab('categorias', `🏷 Categorías (${cats.length})`)}${tab('descripciones', `📋 Descripciones (${descs.length})`)}</div>
    ${cuerpo}
    <div class="botones"><button class="secundario" data-cerrar>Cerrar</button></div>`);
}

function formFechaCompletado(t, desdeDetalle = false, sub = null) {
  const actual = new Date(sub ? sub.completada_en : t.completada_en);
  const conDias = (n) => { const d = new Date(actual); const hoy = new Date(); d.setFullYear(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n); return aLocalInput(d > hoy ? hoy : d); };
  abrirModal(`<h2>✅ Fecha de completado</h2>
    <p class="sutil" style="margin-bottom:12px">${sub ? `Subtarea «${esc(sub.titulo)}» de «${esc(t.titulo)}»` : `«${esc(t.titulo)}»${t.fecha_limite ? ` · fecha límite ${fmtFecha(t.fecha_limite)}` : ''}`}</p>
    <form id="f-fecha-comp" data-id="${t.id}" ${sub ? `data-subtarea="${sub.id}"` : ''} ${desdeDetalle ? 'data-desde-detalle' : ''}>
      <label>¿Cuándo la terminaste?
        <input type="datetime-local" name="completada_en" value="${aLocalInput(actual)}" max="${aLocalInput(new Date())}" required></label>
      <div class="atajos-fecha">
        <button type="button" class="mini" data-fijar-fecha="${conDias(0)}">Hoy</button>
        <button type="button" class="mini" data-fijar-fecha="${conDias(1)}">Ayer</button>
        <button type="button" class="mini" data-fijar-fecha="${conDias(2)}">Hace 2 días</button>
        <button type="button" class="mini" data-fijar-fecha="${conDias(7)}">Hace una semana</button>
      </div>
      <p class="ayuda">Se conserva la hora; ajústala si hace falta. ${sub ? 'El cambio' : 'Se recalcula si fue a tiempo y el cambio'} queda en el historial.</p>
      <div class="botones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button class="primario">Guardar fecha</button></div>
    </form>`);
}

const ICONOS_ARCHIVO = [[/\.pdf$/i, '📕'], [/\.(xlsx?|xlsm|csv)$/i, '📊'], [/\.(docx?|odt|rtf)$/i, '📄'],
  [/\.(pptx?|odp)$/i, '📽'], [/\.(png|jpe?g|gif|webp|bmp)$/i, '🖼'], [/\.(zip|rar|7z)$/i, '🗜'], [/\.(msg|eml)$/i, '✉️'],
  [/\.(pbix|pbit)$/i, '📈'], [/\.(txt|log|md)$/i, '📝']];
const legible = (url) => { try { return decodeURI(url); } catch { return url; } };
const iconoAdjunto = (a) => (a.tipo === 'enlace' ? '🔗' : (ICONOS_ARCHIVO.find(([re]) => re.test(a.nombre)) || [null, '📎'])[1]);

function bloqueSoporte(t) {
  const lista = t.adjuntos.map((a) => `<li>
      <span class="adj-ico">${iconoAdjunto(a)}</span>
      <div class="adj-info">
        <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" title="${a.tipo === 'enlace' ? esc(a.url) : a.visible ? 'Abrir' : 'Descargar'}">${esc(a.nombre)}</a>
        <small>${a.tipo === 'enlace' ? esc(legible(a.url).replace(/^https?:\/\//, '')) : esc(a.tamano_texto)} · ${fmtFecha(a.creado_en)}</small>
      </div>
      ${a.tipo === 'archivo' ? `<a class="ico" href="${esc(a.url)}?descargar=1" title="Descargar">⬇</a>` : ''}
      <button type="button" class="ico" data-borrar-adjunto="${a.id}" data-tarea="${t.id}" title="Quitar">🗑</button>
    </li>`).join('');
  return `<h3 id="sec-soporte" style="margin:18px 0 8px">Soporte <small class="sutil">archivos y enlaces ${t.adjuntos.length || ''}</small></h3>
    ${t.adjuntos.length ? `<ul class="adjuntos">${lista}</ul>` : ''}
    <label class="drop-adjuntos" data-tarea="${t.id}">
      <input type="file" multiple data-subir-adjuntos="${t.id}">
      <span>📎 Arrastra archivos aquí o <u>haz clic para elegir</u> <small>(máx. 50 MB cada uno)</small></span>
    </label>
    <form id="f-enlace" data-tarea="${t.id}" class="f-enlace">
      <input name="url" placeholder="🔗 Pega un enlace (SharePoint, web…)" autocomplete="off">
      <input name="nombre" placeholder="Nombre (opcional)" autocomplete="off">
      <button class="secundario">Agregar enlace</button>
    </form>`;
}

async function subirAdjuntos(tid, archivos) {
  if (!archivos || !archivos.length) return;
  const datos = new FormData();
  [...archivos].forEach((f) => datos.append('archivo', f, f.name));
  toast(`Subiendo ${archivos.length} archivo(s)…`);
  try {
    const r = await fetch(`/api/tareas/${tid}/adjuntos`, { method: 'POST', body: datos });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || `Error ${r.status}`);
    toast(`📎 ${j.length} archivo(s) adjuntado(s)`, 'exito');
    await verDetalle(tid, 'soporte');
    render();
  } catch (err) { toast(err.message, 'error'); }
}

function bloqueComentarios(t) {
  const lista = t.comentarios.map((c) => `<li data-comentario="${c.id}">
      <div class="coment-texto">${esc(c.texto)}</div>
      <div class="coment-meta">${fmtFecha(c.creado_en)}${c.editado_en ? ` · editado ${fmtFecha(c.editado_en)}` : ''}
        <button type="button" class="ico" data-editar-comentario="${c.id}" data-tarea="${t.id}" title="Editar">✎</button>
        <button type="button" class="ico" data-borrar-comentario="${c.id}" data-tarea="${t.id}" title="Borrar">🗑</button></div>
    </li>`).join('');
  return `<h3 id="sec-comentarios" style="margin:18px 0 8px">Comentarios <small class="sutil">${t.comentarios.length || ''}</small></h3>
    ${t.comentarios.length ? `<ul class="comentarios">${lista}</ul>` : '<p class="sutil" style="margin:0 0 8px">Sin comentarios todavía.</p>'}
    <form id="f-comentario" data-tarea="${t.id}" class="f-comentario" data-ctx-tarea="${esc(t.titulo)}">
      <textarea name="texto" rows="2" maxlength="5000" placeholder="Escribe un comentario: avances, acuerdos, bloqueos… (Ctrl + Enter para guardar)"></textarea>
      <div class="coment-botones">${botonMejorar('comentario')}<button class="primario">Comentar</button></div>
    </form>`;
}

async function verDetalle(id, ir = false) {
  const t = await api(`/api/tareas/${id}`);
  const filas = [
    ['Estado', ESTADOS[t.estado]], ['Prioridad', PRIORIDADES[t.prioridad].split(' (')[0]], ['Categoría', esc(t.categoria)],
    ['Creada', fmtFecha(t.creada_en)], ['Iniciada', fmtFecha(t.iniciada_en)],
    ['Completada', t.estado === 'completada' ? `<button type="button" class="enlace-fecha" data-fecha-completado="${t.id}" data-desde-detalle title="Cambiar la fecha de completado">${fmtFecha(t.completada_en)} ✎</button>` : fmtFecha(t.completada_en)],
    ['Fecha límite', fmtFecha(t.fecha_limite)], ['Tiempo real', fmtMin(t.tiempo_real_min)],
    ['Estimado', t.estimado_min ? fmtMin(t.estimado_min) : '—'],
    ['Ciclo total', t.ciclo_horas != null ? fmtDias(t.ciclo_horas / 24) : '—'],
    ['Atraso', t.dias_atraso > 0 ? fmtDias(t.dias_atraso) : 'Ninguno'],
    ['Sesiones de trabajo', t.sesiones.length],
  ];
  // Si ya se está viendo el detalle de esta misma tarea (p. ej. al marcar una subtarea), conservar el scroll.
  const caja = $('#modal-caja');
  const mismo = !$('#modal').classList.contains('oculto') && caja.dataset.detalleAbierto === String(id);
  const arriba = caja.scrollTop;
  abrirModal(`<h2>${t.es_rana ? '🐸 ' : ''}${esc(t.titulo)}</h2>
    ${t.descripcion ? `<p style="white-space:pre-wrap">${esc(t.descripcion)}</p>` : ''}
    ${bannerNovedad(t)}
    ${t.entregable ? `<div class="entregable-detalle ${t.entregable_listo ? 'listo' : ''}">📦 <b>Entregable:</b> ${esc(t.entregable)}
      <span class="estado ${t.entregable_listo ? 'bien' : 'sin'}">${t.entregable_listo ? '✓ Listo' : 'Pendiente'}</span></div>` : ''}
    <div class="datos" style="grid-template-columns:repeat(3,1fr)">${filas.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    ${t.dependencias.length || t.frena_a.length ? `<h3 style="margin:18px 0 8px">Dependencias ${t.bloqueada ? '<span class="chip bloq">🔒 Bloqueada</span>' : ''}</h3>
      ${t.dependencias.length ? `<div class="sutil" style="margin-bottom:6px">Espera a:</div><ul class="deps">${t.dependencias.map((d) => `<li class="${d.completa ? 'resuelta' : ''}">
          <span>${d.completa ? '✓' : '⏳'}</span>
          <a href="#" data-detalle="${d.tarea_id}">${esc(nombreRequisito(d))}</a>
          <small>${d.completa ? (d.estado === 'completada' ? 'completada' : esc(d.estado)) : 'pendiente'}</small>
          <button class="ico" data-borrar-dep="${d.id}" data-tarea="${t.id}" title="Quitar dependencia">✕</button></li>`).join('')}</ul>` : ''}
      ${t.frena_a.length ? `<div class="sutil" style="margin:10px 0 6px">Estas tareas te esperan:</div><ul class="deps">${t.frena_a.map((x) => `<li><span>⛓</span>
          <a href="#" data-detalle="${x.id}">${esc(x.titulo)}</a></li>`).join('')}</ul>` : ''}` : ''}
    ${t.subtareas_total || abierta(t) ? `<h3 style="margin:18px 0 8px">Subtareas</h3><div data-detalle-subs="${t.id}">${barraAvance(t, false)}${checklistSubtareas(t)}</div>` : ''}
    ${bloqueSoporte(t)}
    ${bloqueComentarios(t)}
    <h3 style="margin:18px 0 12px">Línea de tiempo</h3>
    <ul class="timeline">${t.eventos.map((e) => `<li class="ev-${e.tipo}"><b>${EVENTOS[e.tipo] || esc(e.tipo)}</b>
      <div class="cuando">${fmtFecha(e.momento)}</div>${e.detalle ? `<div class="sutil">${esc(e.detalle)}</div>` : ''}</li>`).join('')}</ul>
    <div class="botones">${abierta(t) && !t.novedad ? `<button class="secundario" data-accion="novedad" data-id="${t.id}">● Novedad</button>` : ''}<button class="secundario" data-duplicar="${t.id}">⧉ Duplicar</button><button class="secundario" data-editar="${t.id}">✎ Editar</button><button class="primario" data-cerrar>Cerrar</button></div>`, { enfocar: false });
  caja.dataset.detalleAbierto = String(id);
  if (mismo && !ir) caja.scrollTop = arriba;
  if (ir === 'soporte') {
    $('#sec-soporte').scrollIntoView({ block: 'start' });
  } else if (ir) {
    $('#sec-comentarios').scrollIntoView({ block: 'start' });
    $('#f-comentario textarea').focus();
  }
}

/* ─────────── casilla de subtarea de 3 estados: vacía → ✓ → ● novedad → vacía ───────────
   Los clics seguidos se acumulan (se ve el cambio al instante) y al detenerse se aplica solo el estado final:
   así un doble clic pasa directo de «vacía» a «● novedad» sin completar la subtarea por el camino. */
const CICLO_SUB = { vacio: 'hecho', hecho: 'novedad', novedad: 'vacio' };
const pendientesChk = new Map();
function clicSubtarea(marca) {
  const sid = Number(marca.dataset.chkSubtarea);
  const prev = pendientesChk.get(sid);
  const inicial = prev ? prev.inicial : marca.dataset.estado;
  const actual = prev ? prev.actual : marca.dataset.estado;
  const siguiente = CICLO_SUB[actual];
  // Vista inmediata
  const caja = marca.querySelector('.chk');
  caja.className = `chk chk-${siguiente}`;
  marca.setAttribute('aria-checked', siguiente === 'hecho' ? 'true' : siguiente === 'novedad' ? 'mixed' : 'false');
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => aplicarSubtarea(marca, sid, inicial, siguiente), 650);
  pendientesChk.set(sid, { inicial, actual: siguiente, timer });
}

async function aplicarSubtarea(marca, sid, inicial, final) {
  pendientesChk.delete(sid);
  if (final === inicial) return;
  const tid = Number(marca.dataset.tarea);
  const titulo = marca.dataset.titulo;
  const revertir = () => { marca.querySelector('.chk').className = `chk chk-${inicial}`; };
  let cuerpo;
  if (final === 'hecho') cuerpo = { completada: true };
  else if (final === 'novedad') {
    const txt = prompt(`● Novedad en «${titulo}»\n\n¿Qué impide terminarla? Queda sin completar y se conserva el tiempo dedicado.`, '');
    if (txt === null) { revertir(); return; }
    cuerpo = { novedad: txt.trim() || 'Con novedad (sin descripción)' };
  } else cuerpo = inicial === 'novedad' ? { novedad: '' } : { completada: false };
  try {
    const t = await api(`/api/subtareas/${sid}`, { method: 'PUT', body: cuerpo });
    const enModal = !!marca.closest('[data-detalle-subs]');
    if (final === 'hecho') toast(`✓ Avance ${t.progreso_pct}% (${t.subtareas_hechas}/${t.subtareas_total})`, 'exito');
    else if (final === 'novedad') toast(`● Novedad registrada en «${titulo}». Su tiempo queda guardado.`);
    else if (inicial === 'novedad') toast(`Novedad resuelta: «${titulo}» queda pendiente.`);
    if (enModal) await verDetalle(t.id);
    await render();
    if (final === 'hecho' && t.subtareas_total && t.subtareas_hechas === t.subtareas_total && abierta(t)
        && confirm('¡Todas las subtareas listas! 🎉 ¿Marcar la tarea como completada?')) {
      if (enModal) cerrarModal();
      await accionTarea(t.id, 'completar');
    }
  } catch (err) { toast(err.message, 'error'); revertir(); }
}

document.addEventListener('keydown', (e) => {
  const marca = e.target.closest && e.target.closest('[data-chk-subtarea]');
  if (marca && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); clicSubtarea(marca); }
});

/* ─────────── asistente con IA (opcional: solo con OPENAI_API_KEY en .env) ─────────── */
const botonMejorar = (tipo) => (st.ia.activa
  ? `<button type="button" class="ia-btn mini" data-ia-mejorar="${tipo}" title="Corrige ortografía y redacción sin cambiar el contenido">✨ Mejorar redacción</button>
     <button type="button" class="mini oculto" data-ia-deshacer title="Volver a tu texto">↶ Original</button>`
  : '');

/** Pone el botón en «Pensando…» mientras la IA responde. */
async function conIA(boton, fn) {
  const antes = boton.innerHTML;
  boton.disabled = true;
  boton.classList.add('pensando');
  boton.innerHTML = '<span class="giro"></span>' + (boton.classList.contains('ico-ia') ? '' : ' Pensando…');
  try { return await fn(); } finally {
    if (boton.isConnected) { boton.disabled = false; boton.classList.remove('pensando'); boton.innerHTML = antes; }
  }
}

function ventanaIA(html) {
  abrirModal(`<div class="ia-ventana">${html}</div>`, { enfocar: false });
  $('#modal').classList.add('opaco');
}
function cargandoIA(titulo, detalle = 'Revisando tus datos…') {
  st.iaRegenerar = null;
  ventanaIA(`<h2>✨ ${esc(titulo)}</h2><div class="ia-cargando"><span class="giro grande"></span><span>${esc(detalle)}</span></div>`);
}
function errorIA(err, reintentar) {
  st.iaRegenerar = reintentar;
  ventanaIA(`<h2>✨ No se pudo completar</h2><p class="ia-error">${esc(err.message)}</p>
    <div class="botones"><button type="button" class="secundario" data-cerrar>Cerrar</button>
    ${reintentar ? '<button type="button" class="primario" data-ia-regenerar>Reintentar</button>' : ''}</div>`);
}
function resultadoTextoIA(titulo, texto, regenerar) {
  st.iaRegenerar = regenerar;
  ventanaIA(`<h2>✨ ${esc(titulo)}</h2>
    <textarea class="ia-texto" rows="18" spellcheck="true">${esc(texto)}</textarea>
    <div class="botones">
      <span class="ayuda" style="margin-right:auto">Generado con IA a partir de tus datos · revísalo y edítalo aquí antes de usarlo.</span>
      <button type="button" class="secundario" data-ia-regenerar>↻ Otra versión</button>
      <button type="button" class="secundario" data-cerrar>Cerrar</button>
      <button type="button" class="primario" data-ia-copiar=".ia-texto">📋 Copiar</button>
    </div>`);
}
async function copiarTexto(texto, msg = '📋 Copiado') {
  try { await navigator.clipboard.writeText(texto); toast(msg, 'exito'); } catch { toast('El navegador no permitió copiar: selecciona el texto y usa Ctrl + C.', 'error'); }
}

async function iaResumenSemanal() {
  cargandoIA(`Resumen de la semana ${st.hist.semana}`, 'Leyendo lo que hiciste cada día…');
  try {
    const r = await api('/api/ia/resumen-semanal', { method: 'POST', body: { anio: st.hist.anio, semana: st.hist.semana } });
    resultadoTextoIA(`Resumen de la semana ${st.hist.semana}`, r.texto, iaResumenSemanal);
  } catch (err) { errorIA(err, iaResumenSemanal); }
}

async function iaAnalisis() {
  const dias = st.periodo;
  cargandoIA(`Análisis de rendimiento · últimos ${dias} días`, 'Buscando patrones en tus métricas…');
  try {
    const r = await api('/api/ia/analisis-rendimiento', { method: 'POST', body: { dias } });
    resultadoTextoIA(`Análisis de rendimiento · últimos ${dias} días`, r.texto, iaAnalisis);
  } catch (err) { errorIA(err, iaAnalisis); }
}

async function iaPlanDia() {
  cargandoIA('Plan para hoy', 'Ordenando tus pendientes: primero la rana…');
  try {
    const [r] = await Promise.all([api('/api/ia/plan-dia', { method: 'POST' }), cargarTareas()]);
    const items = r.orden.map((o) => ({ o, t: st.tareas.find((x) => x.id === o.id) })).filter((x) => x.t);
    const total = items.reduce((a, x) => a + x.o.minutos, 0);
    st.iaRegenerar = iaPlanDia;
    ventanaIA(`<h2>✨ Plan para hoy</h2>
      <p class="plan-resumen">${esc(r.resumen)}</p>
      ${items.length ? `<ol class="plan-dia">${items.map(({ o, t }, i) => `<li>
          <span class="plan-num">${i + 1}</span>
          <div class="plan-info">
            <div>${enlaceTarea(t)}${t.es_rana ? ' 🐸' : ''}${t.vencida ? ' <span class="chip rojo">vencida</span>' : ''}</div>
            <small>${esc(o.motivo)}</small>
          </div>
          <span class="chip">${fmtMin(o.minutos)}</span>
          ${abierta(t) && !t.bloqueada ? accionPrincipal(t, false) : ''}
        </li>`).join('')}</ol>
        <p class="sutil plan-total">Total sugerido: <b>${fmtMin(total)}</b></p>` : '<p class="sutil">No se sugirieron tareas para hoy.</p>'}
      ${r.advertencias ? `<div class="plan-aviso">⚠ ${esc(r.advertencias)}</div>` : ''}
      <div class="botones">
        <span class="ayuda" style="margin-right:auto">Sugerencia de la IA · tú decides. ▶ inicia la tarea.</span>
        <button type="button" class="secundario" data-ia-regenerar>↻ Otra versión</button>
        <button type="button" class="primario" data-cerrar>Listo</button>
      </div>`);
  } catch (err) { errorIA(err, iaPlanDia); }
}

async function cargarFraseIA() {
  try {
    const fr = await api('/api/ia/frase');
    st.fraseIA = { ...fr, dia: hoyISO() };
    const caja = $('#vista .frase-suave');
    if (!caja) return;
    caja.querySelector('p').textContent = fr.texto;
    caja.querySelector('small').innerHTML = `<span class="frase-ia" title="Frase de hoy generada con IA según tus pendientes">✨</span> ${esc(fr.principio)} · 💡 ${esc(fr.practica)}`;
    caja.title = `${fr.principio} — ${fr.practica}`;
  } catch (err) {
    console.warn('Frase con IA no disponible:', err.message);  // se queda la frase local
  }
}

/** Datos que devuelve la IA → campos del formulario de tarea abierto. */
function agregarSubtareasForm(lista) {
  const ya = new Set($$('#f-tarea .sub-input').map((i) => i.value.trim().toLowerCase()).filter(Boolean));
  $$('#f-tarea .sub-fila').forEach((r) => { if (!r.dataset.subId && !$('.sub-input', r).value.trim()) r.remove(); });
  let n = 0;
  lista.forEach((titulo) => { if (!ya.has(titulo.toLowerCase())) { agregarFilaSub(null, titulo); ya.add(titulo.toLowerCase()); n++; } });
  return n;
}
function llenarFormTarea(f, r) {
  const poner = (campo, v) => { if (v && f[campo]) f[campo].value = v; };
  poner('titulo', r.titulo); poner('descripcion', r.descripcion); poner('prioridad', r.prioridad);
  poner('fecha_limite', r.fecha_limite); poner('entregable', r.entregable);
  if (r.estimado_min) f.estimado_min.value = r.estimado_min;
  if (r.categoria) {
    const sel = f.categoria;
    let op = [...sel.options].find((o) => o.value.toLowerCase() === r.categoria.toLowerCase());
    if (!op) { op = new Option(r.categoria, r.categoria); sel.insertBefore(op, sel.lastElementChild); }
    sel.value = op.value;
    f.categoria_nueva.classList.add('oculto');
  }
  if (r.es_rana) f.es_rana.checked = true;
  agregarSubtareasForm(r.subtareas || []);
}
const datosDesdeIA = (r, texto) => ({
  titulo: r.titulo, descripcion: r.descripcion, prioridad: r.prioridad, categoria: r.categoria,
  fecha_limite: r.fecha_limite, estimado_min: r.estimado_min || null, entregable: r.entregable, es_rana: r.es_rana,
  subtareas: (r.subtareas || []).map((titulo) => ({ titulo })), _ia: texto,
});

/* ─────────── al pausar: ¿qué hiciste en ese tiempo? (opcional) ─────────── */
function pedirNotaSesion(t, ses, volverA = null) {
  const hora = (iso) => (iso || '').slice(11, 16);
  abrirModal(`<div class="nota-sesion">
    <div class="nota-cab">
      <span class="nota-ico">${ICO_PAUSA}</span>
      <div class="nota-tit"><h2>Tiempo pausado</h2>
        <p>«${esc(t.titulo)}»${ses.subtarea ? ` <span class="sutil">›</span> «${esc(ses.subtarea)}»` : ''}</p></div>
      <div class="nota-dur"><b>${fmtMin(ses.minutos)}</b><span>${hora(ses.inicio)} – ${hora(ses.fin)}</span></div>
    </div>
    <form id="f-nota-sesion" data-sesion="${ses.id}" data-volver="${volverA || ''}" data-ctx-tarea="${esc(t.titulo)}" data-ctx-sub="${esc(ses.subtarea || '')}">
      <label>¿Qué hiciste en este tiempo? <span class="ayuda">Opcional. Queda en el reporte semanal y en el historial de la tarea.</span>
        <textarea name="nota" rows="4" maxlength="2000" placeholder="Ej. Descargué el corte del lunes y validé las fechas de U108 y U109"></textarea></label>
      <div class="botones">
        <span class="ayuda" style="margin-right:auto">Ctrl + Enter guarda · Esc omite</span>
        ${botonMejorar('nota')}
        <button type="button" class="secundario" data-omitir-nota>Omitir</button>
        <button class="primario">Guardar</button>
      </div>
    </form>
  </div>`);
  $('#modal').classList.add('opaco');
}

/* ─────────── acciones ─────────── */
async function accionSubtarea(sid, tid, accion) {
  try {
    const t = await api(`/api/subtareas/${sid}/accion`, { method: 'POST', body: { accion } });
    const sub = t.subtareas.find((x) => x.id === sid);
    const enDetalle = !$('#modal').classList.contains('oculto') && $('#modal-caja').dataset.detalleAbierto === String(tid);
    if (accion === 'pausar' && t.sesion_cerrada) {
      await refrescar();
      return pedirNotaSesion(t, t.sesion_cerrada, enDetalle ? tid : null);
    }
    toast(accion === 'iniciar' ? `▶ En marcha: «${sub.titulo}»` : `⏸ Pausada «${sub.titulo}» · lleva ${fmtMin(sub.tiempo_min)} · tarea ${fmtMin(t.tiempo_real_min)}`);
    if (enDetalle) await verDetalle(tid);
    await refrescar();
  } catch (err) { toast(err.message, 'error'); }
}

async function accionTarea(id, accion) {
  const t = st.tareas.find((x) => x.id === id);
  const cuerpo = { accion };
  if (accion === 'completar' && t && t.subtareas_total > t.subtareas_hechas) {
    const faltan = t.subtareas.filter((s) => !s.completada).map((s) => `• ${s.titulo}`).join('\n');
    if (!confirm(`Quedan ${t.subtareas_total - t.subtareas_hechas} subtarea(s) pendiente(s):\n${faltan}\n\n¿Marcarlas como completadas y cerrar la tarea?`)) return;
    cuerpo.completar_subtareas = true;
  }
  if (accion === 'completar' && t && t.tiempo_real_min === 0 && !t.sesion_abierta) {
    const m = prompt('¿Cuántos minutos le dedicaste? (opcional, para medir tu rendimiento)', t.estimado_min || '');
    if (m === null) return;
    if (m.trim()) cuerpo.minutos_manual = m.trim();
  }
  if (accion === 'novedad') {
    const txt = prompt(`● Novedad en «${t ? t.titulo : 'la tarea'}»\n\n¿Qué impide terminarla? La tarea queda abierta (pausada si estaba corriendo) y se conserva el tiempo dedicado.`, (t && t.novedad) || '');
    if (txt === null) return;
    if (!txt.trim()) { toast('Escribe la novedad para registrarla.', 'error'); return; }
    cuerpo.texto = txt.trim();
  }
  if (accion === 'cancelar') {
    const motivo = prompt('¿Por qué la cancelas? (opcional)');
    if (motivo === null) return;
    cuerpo.motivo = motivo;
  }
  try {
    let r;
    try {
      r = await api(`/api/tareas/${id}/accion`, { method: 'POST', body: cuerpo });
    } catch (err) {
      if (err.status !== 409 || !err.data || !err.data.bloqueada) throw err;
      const verbo = accion === 'iniciar' ? 'Iniciarla' : 'Completarla';
      if (!confirm(`🔒 Esta tarea está esperando:\n• ${err.data.pendientes.join('\n• ')}\n\n¿${verbo} de todas formas? Quedará registrado en el historial.`)) return;
      r = await api(`/api/tareas/${id}/accion`, { method: 'POST', body: { ...cuerpo, forzar: true } });
    }
    const msgs = {
      iniciar: '▶ En marcha. Una sola cosa a la vez.',
      pausar: '⏸ Pausada.',
      completar: r.es_rana ? '🐸 ¡Te comiste la rana! Lo demás será más fácil.' : r.completada_a_tiempo === false ? '✓ Completada (con atraso).' : '✓ ¡Completada!',
      reabrir: '↺ Reabierta.',
      cancelar: '⊘ Cancelada.',
      novedad: '● Novedad registrada. La tarea queda abierta y su tiempo guardado.',
      quitar_novedad: '✓ Novedad resuelta.',
    };
    const enDetalle = !$('#modal').classList.contains('oculto') && $('#modal-caja').dataset.detalleAbierto === String(id);
    if (accion === 'pausar' && r.sesion_cerrada) {
      if (st.vista === 'metas') await cargarTareas();
      await refrescar();
      return pedirNotaSesion(r, r.sesion_cerrada, enDetalle ? id : null);
    }
    toast(msgs[accion], accion === 'completar' ? 'exito' : '');
    if (enDetalle) await verDetalle(id);
    if (st.vista === 'metas') await cargarTareas();
    await refrescar();
  } catch (e) { toast(e.message, 'error'); }
}

function datosForm(f) {
  const o = Object.fromEntries(new FormData(f));
  $$('input[type=checkbox]', f).forEach((c) => { o[c.name] = c.checked; });
  if (o.categoria === '__nueva__') {
    o.categoria = (o.categoria_nueva || '').trim();
    if (!o.categoria) throw new Error('Escribe el nombre de la nueva categoría.');
  }
  delete o.categoria_nueva;
  if ($('.dep-editor', f)) {
    o.dependencias = $$('.dep-chip', f).map((c) => {
      const [tipo, id] = c.dataset.depValor.split(':');
      return { tipo, id: Number(id) };
    });
  }
  if ($('.sub-editor', f)) {
    o.subtareas = $$('.sub-fila', f)
      .map((r) => ({ id: r.dataset.subId ? Number(r.dataset.subId) : null, titulo: $('.sub-input', r).value.trim() }))
      .filter((s) => s.titulo);
  }
  return o;
}

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  try {
    if (f.id === 'f-tarea') {
      const d = datosForm(f);
      if (f.dataset.original) {
        if (d.copiar_soporte) d.copiar_adjuntos_de = Number(f.dataset.original);
        delete d.copiar_soporte;
      }
      if (!f.dataset.id && !d.ya_completada && !(d.entregable || '').trim()
          && !confirm('Esta tarea no tiene entregable.\n\n¿Qué debe existir para darla por terminada? Definirlo ayuda a saber cuándo está realmente lista.\n\nAceptar = crearla sin entregable · Cancelar = escribirlo ahora')) {
        f.entregable.focus();
        return;
      }
      if (f.dataset.id) await api(`/api/tareas/${f.dataset.id}`, { method: 'PUT', body: d });
      else await api('/api/tareas', { method: 'POST', body: d });
      cerrarModal();
      toast(f.dataset.original ? `⧉ Copia creada: «${d.titulo}»` : !f.dataset.id && d.ya_completada ? '✅ Registrada como completada' : 'Tarea guardada',
        f.dataset.original || (!f.dataset.id && d.ya_completada) ? 'exito' : '');
      await cargarCatalogos(); await refrescar();
    } else if (f.id === 'f-rapida') {
      const d = datosForm(f);
      if (!d.titulo.trim()) return;
      await api('/api/tareas', { method: 'POST', body: d });
      st.ultimaCategoria = d.categoria;
      toast('Tarea agregada'); await cargarCatalogos(); await refrescar();
      $('#f-rapida input') && $('#f-rapida input').focus();
    } else if (f.classList.contains('f-subtarea')) {
      const titulo = f.titulo.value.trim();
      if (!titulo) return;
      const enModal = !!f.closest('[data-detalle-subs]');
      const t = await api(`/api/tareas/${f.dataset.tarea}/subtareas`, { method: 'POST', body: { titulo } });
      if (enModal) await verDetalle(t.id);
      await render();
      const otra = enModal ? $('#modal-caja .f-subtarea input') : $(`#vista .f-subtarea[data-tarea="${t.id}"] input`);
      if (otra) otra.focus();
    } else if (f.id === 'f-nota-sesion') {
      const nota = f.nota.value.trim();
      if (nota) {
        await api(`/api/sesiones/${f.dataset.sesion}`, { method: 'PUT', body: { nota } });
        toast('📝 Guardado: quedará en el reporte semanal', 'exito');
      }
      if (f.dataset.volver) await verDetalle(Number(f.dataset.volver)); else cerrarModal();
      if (nota) render();
    } else if (f.id === 'f-enlace') {
      if (!f.url.value.trim()) return;
      await api(`/api/tareas/${f.dataset.tarea}/adjuntos`, { method: 'POST', body: { url: f.url.value, nombre: f.nombre.value } });
      toast('🔗 Enlace agregado', 'exito');
      await verDetalle(Number(f.dataset.tarea), 'soporte');
      render();
    } else if (f.id === 'f-comentario') {
      const texto = f.texto.value.trim();
      if (!texto) return;
      await api(`/api/tareas/${f.dataset.tarea}/comentarios`, { method: 'POST', body: { texto } });
      toast('💬 Comentario guardado', 'exito');
      await verDetalle(Number(f.dataset.tarea), true);
      render();
    } else if (f.classList.contains('f-editar-coment')) {
      await api(`/api/comentarios/${f.dataset.id}`, { method: 'PUT', body: { texto: f.texto.value } });
      await verDetalle(Number(f.dataset.tarea), true);
    } else if (f.id === 'f-fecha-comp' && f.dataset.subtarea) {
      const r = await api(`/api/subtareas/${f.dataset.subtarea}`, { method: 'PUT', body: { completada_en: f.completada_en.value } });
      const sub = r.subtareas.find((x) => x.id === Number(f.dataset.subtarea));
      toast(`Subtarea «${sub.titulo}» completada el ${fmtFecha(sub.completada_en)}`, 'exito');
      if (f.dataset.desdeDetalle !== undefined) await verDetalle(r.id); else cerrarModal();
      await refrescar();
    } else if (f.id === 'f-fecha-comp') {
      const r = await api(`/api/tareas/${f.dataset.id}`, { method: 'PUT', body: { completada_en: f.completada_en.value } });
      const plazo = r.completada_a_tiempo === true ? ' · a tiempo ✓' : r.completada_a_tiempo === false ? ` · ${fmtDias(r.dias_atraso)} de atraso` : '';
      toast(`Fecha de completado: ${fmtFecha(r.completada_en)}${plazo}`, 'exito');
      if (f.dataset.desdeDetalle !== undefined) await verDetalle(r.id); else cerrarModal();
      await refrescar();
    } else if (f.id === 'f-emoji') {
      const icono = f.icono.value.trim();
      if (!icono) return;
      await guardarIcono(Number(f.dataset.cat), { icono }, `Ícono ${icono} asignado`);
    } else if (f.id === 'f-cat-nueva') {
      st.catalogos = await api('/api/categorias', { method: 'POST', body: { nombre: f.nombre.value } });
      gestionarCatalogos('categorias');
    } else if (f.id === 'f-desc-nueva') {
      st.catalogos = await api('/api/descripciones', { method: 'POST', body: { texto: f.texto.value } });
      gestionarCatalogos('descripciones');
    } else if (f.id === 'f-meta') {
      const d = datosForm(f);
      if (f.dataset.id) await api(`/api/metas/${f.dataset.id}`, { method: 'PUT', body: d });
      else await api('/api/metas', { method: 'POST', body: d });
      cerrarModal(); toast('Meta guardada'); await cargarMetas(); await refrescar();
    } else if (f.id === 'f-practica') {
      await api(`/api/metas/${f.dataset.meta}/registros`, { method: 'POST', body: datosForm(f) });
      cerrarModal(); toast('Práctica registrada 💪', 'exito'); await refrescar();
    } else if (f.classList.contains('f-hito')) {
      const titulo = f.titulo.value.trim();
      if (!titulo) return;
      await api(`/api/metas/${f.dataset.meta}/hitos`, { method: 'POST', body: { titulo } });
      await render();
    }
  } catch (err) { toast(err.message, 'error'); }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-detalle], [data-vista]');
  if (!el) {
    if (!e.target.closest('#panel-alertas, #btn-alertas')) $('#panel-alertas').classList.add('oculto');
    return;
  }
  const d = el.dataset;
  try {
    if (d.vista) { $('#panel-alertas').classList.add('oculto'); st.vista = d.vista; render(); return; }
    if (d.cerrar !== undefined) return cerrarModal();
    if ((d.accion || d.subAccion) && el.closest('.plan-dia')) cerrarModal();
    if (d.accion) return accionTarea(Number(d.id), d.accion);
    if (d.detalle) { e.preventDefault(); $('#panel-alertas').classList.add('oculto'); return verDetalle(Number(d.detalle), d.irSoporte !== undefined ? 'soporte' : d.irComentarios !== undefined); }
    if (d.editar) {
      let t = st.tareas.find((x) => x.id === Number(d.editar));
      if (!t) t = await api(`/api/tareas/${d.editar}`);
      return formTarea(t);
    }
    if (d.eliminar) {
      if (!confirm('¿Eliminar la tarea? Su historial se conserva para tus estadísticas.')) return;
      await api(`/api/tareas/${d.eliminar}`, { method: 'DELETE' });
      toast('Tarea eliminada'); return refrescar();
    }
    if (d.iaPlan !== undefined) return iaPlanDia();
    if (d.iaAnalisis !== undefined) return iaAnalisis();
    if (d.iaResumen !== undefined) return iaResumenSemanal();
    if (d.iaRegenerar !== undefined) return st.iaRegenerar && st.iaRegenerar();
    if (d.iaCopiar) return copiarTexto(el.closest('.ia-ventana, .rpt-correo').querySelector(d.iaCopiar).value, d.iaMsg || '📋 Copiado');
    if (d.iaInterpretar !== undefined) {
      const inp = $('#f-rapida input[name=titulo]');
      const texto = inp.value.trim();
      if (!texto) { toast('Escribe la tarea como la dirías y luego pulsa ✨', 'error'); inp.focus(); return; }
      const r = await conIA(el, () => api('/api/ia/interpretar-tarea', { method: 'POST', body: { texto } }));
      inp.value = '';
      return formTarea(datosDesdeIA(r, texto));
    }
    if (d.iaInterpretarForm !== undefined) {
      const texto = $('#ia-texto-tarea').value.trim();
      if (!texto) { toast('Escribe la tarea como la dirías', 'error'); $('#ia-texto-tarea').focus(); return; }
      const r = await conIA(el, () => api('/api/ia/interpretar-tarea', { method: 'POST', body: { texto } }));
      llenarFormTarea($('#f-tarea'), r);
      toast('✨ Campos completados: revísalos antes de guardar', 'exito');
      return;
    }
    if (d.iaSubtareas !== undefined) {
      const f = $('#f-tarea');
      if (!f.titulo.value.trim()) { toast('Escribe primero el título de la tarea', 'error'); f.titulo.focus(); return; }
      const cat = f.categoria.value === '__nueva__' ? f.categoria_nueva.value : f.categoria.value;
      const r = await conIA(el, () => api('/api/ia/sugerir-subtareas', { method: 'POST', body: {
        titulo: f.titulo.value, descripcion: f.descripcion.value, categoria: cat, entregable: f.entregable.value,
        existentes: $$('.sub-input', f).map((i) => i.value.trim()).filter(Boolean) } }));
      const n = agregarSubtareasForm(r.subtareas);
      toast(n ? `✨ ${n} paso(s) sugerido(s): quita los que no apliquen` : 'No hubo pasos nuevos que sugerir', n ? 'exito' : '');
      return;
    }
    if (d.iaMejorar) {
      const f = el.closest('form');
      const area = $('textarea', f);
      const texto = area.value.trim();
      if (!texto) { toast('Escribe algo primero y luego mejora la redacción', 'error'); area.focus(); return; }
      const r = await conIA(el, () => api('/api/ia/mejorar-texto', { method: 'POST', body: {
        texto, tipo: d.iaMejorar, tarea: f.dataset.ctxTarea, subtarea: f.dataset.ctxSub } }));
      const deshacer = $('[data-ia-deshacer]', f);
      deshacer.dataset.original = area.value;
      deshacer.classList.remove('oculto');
      area.value = r.texto;
      area.focus();
      return;
    }
    if (d.iaDeshacer !== undefined) {
      const area = $('textarea', el.closest('form'));
      area.value = d.original || area.value;
      el.classList.add('oculto');
      return;
    }
    if (d.otraFrase !== undefined) {
      const fr = await api('/api/frase?aleatoria=1');
      const caja = el.closest('.frase-suave');
      caja.querySelector('p').textContent = fr.texto;
      caja.querySelector('small').textContent = `${fr.principio} · 💡 ${fr.practica}`;
      caja.title = `${fr.principio} — ${fr.practica}`;
      return;
    }
    if (d.nuevaMeta !== undefined) return formMeta();
    if (d.editarMeta) return formMeta(st.metas.find((m) => m.id === Number(d.editarMeta)));
    if (d.eliminarMeta) {
      if (!confirm('¿Eliminar la meta con sus hitos y registros? Las tareas vinculadas se conservan.')) return;
      await api(`/api/metas/${d.eliminarMeta}`, { method: 'DELETE' });
      toast('Meta eliminada'); await cargarMetas(); return render();
    }
    if (d.practica) return formPractica(st.metas.find((m) => m.id === Number(d.practica)));
    if (d.registros) return verRegistros(st.metas.find((m) => m.id === Number(d.registros)));
    if (d.borrarRegistro) {
      await api(`/api/registros/${d.borrarRegistro}`, { method: 'DELETE' });
      cerrarModal(); toast('Registro borrado'); return render();
    }
    if (d.borrarHito) { await api(`/api/hitos/${d.borrarHito}`, { method: 'DELETE' }); return render(); }
    if (d.tabCatalogo) return gestionarCatalogos(d.tabCatalogo);
    if (d.omitirNota !== undefined) {
      const volver = el.closest('form').dataset.volver;
      return volver ? verDetalle(Number(volver)) : cerrarModal();
    }
    if (d.editarNovedadSub) {
      const txt = prompt('Editar la novedad:', d.texto || '');
      if (txt === null) return;
      const t = await api(`/api/subtareas/${d.editarNovedadSub}`, { method: 'PUT', body: { novedad: txt.trim() } });
      toast(txt.trim() ? 'Novedad actualizada' : 'Novedad resuelta');
      if (el.closest('[data-detalle-subs]')) await verDetalle(t.id);
      return render();
    }
    if (d.subAccion) return accionSubtarea(Number(d.sub), Number(d.tarea), d.subAccion);
    if (d.duplicar) {
      const pre = await api(`/api/tareas/${d.duplicar}/duplicado`);
      return formTarea({ ...pre, _duplicado: pre });
    }
    if (d.histTab) { st.hist.tab = d.histTab; return render(); }
    if (d.semanaIr) {
      if (d.semanaIr === 'hoy') { st.hist.anio = null; st.hist.semana = null; }
      else { const [a, w] = d.semanaIr.split('-').map(Number); st.hist.anio = a; st.hist.semana = w; }
      return render();
    }
    if (d.festivosActualizar) {
      const r = await api(`/api/festivos/${d.festivosActualizar}/actualizar`, { method: 'POST' });
      toast(r.fuente === 'api' ? `🎉 Festivos ${r.anio} actualizados desde la API` : 'No se pudo conectar con la API de festivos; se siguen usando los calculados.', r.fuente === 'api' ? 'exito' : '');
      return render();
    }
    if (d.fechaCompletado) {
      const id = Number(d.fechaCompletado);
      const t = st.tareas.find((x) => x.id === id) || await api(`/api/tareas/${id}`);
      return formFechaCompletado(t, d.desdeDetalle !== undefined);
    }
    if (d.editarComentario) {
      const li = el.closest('li');
      const texto = li.querySelector('.coment-texto').textContent;
      li.innerHTML = `<form class="f-editar-coment f-comentario" data-id="${d.editarComentario}" data-tarea="${d.tarea}">
        <textarea name="texto" rows="3" maxlength="5000">${esc(texto)}</textarea>
        <div class="botones" style="margin:0"><button type="button" class="secundario" data-cancelar-coment="${d.tarea}">Cancelar</button><button class="primario">Guardar</button></div></form>`;
      const ta = li.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }
    if (d.cancelarComent) return verDetalle(Number(d.cancelarComent), true);
    if (d.borrarAdjunto) {
      if (!confirm('¿Quitar este soporte? Si es un archivo, se borra de la carpeta de adjuntos.')) return;
      await api(`/api/adjuntos/${d.borrarAdjunto}`, { method: 'DELETE' });
      await verDetalle(Number(d.tarea), 'soporte');
      return render();
    }
    if (d.borrarComentario) {
      if (!confirm('¿Borrar este comentario?')) return;
      await api(`/api/comentarios/${d.borrarComentario}`, { method: 'DELETE' });
      await verDetalle(Number(d.tarea), true);
      return render();
    }
    if (d.fechaSubtarea) {
      const t = await api(`/api/tareas/${d.tarea}`);
      const sub = t.subtareas.find((x) => x.id === Number(d.fechaSubtarea));
      return formFechaCompletado(t, !!el.closest('[data-detalle-subs]'), sub);
    }
    if (d.fijarFecha) { el.closest('form').completada_en.value = d.fijarFecha; return; }
    if (d.editarIcono) return formIconoCategoria(st.catalogos.categorias.find((c) => c.id === Number(d.editarIcono)));
    if (d.ponerIcono) return guardarIcono(Number(d.cat), { icono: d.ponerIcono }, `Ícono ${d.ponerIcono} asignado`);
    if (d.quitarIcono) return guardarIcono(Number(d.quitarIcono), { quitar_icono: true }, 'Ícono quitado');
    if (d.volverCatalogos !== undefined) return gestionarCatalogos('categorias');
    if (d.quitarDep !== undefined) {
      const chip = el.closest('.dep-chip');
      const sel = chip.closest('.dep-editor').querySelector('[data-dep-select]');
      const opcion = sel && [...sel.options].find((o) => o.value === chip.dataset.depValor);
      if (opcion) opcion.disabled = false;
      chip.remove();
      return;
    }
    if (d.borrarDep) {
      if (!confirm('¿Quitar esta dependencia?')) return;
      await api(`/api/dependencias/${d.borrarDep}`, { method: 'DELETE' });
      toast('Dependencia quitada');
      await verDetalle(Number(d.tarea));
      return render();
    }
    if (d.agregarSub !== undefined) { $('.sub-input', agregarFilaSub()).focus(); return; }
    if (d.quitarSub !== undefined) {
      const fila = el.closest('.sub-fila');
      if (fila.dataset.subId && fila.querySelector('.sub-estado').textContent === '✓'
          && !confirm('Esta subtarea ya está completada. ¿Quitarla de todas formas?')) return;
      fila.remove();
      return;
    }
    if (d.expandir) {
      const id = Number(d.expandir);
      const conjunto = d.compacta !== undefined ? st.subHoy : st.subInvertidas;
      if (conjunto.has(id)) conjunto.delete(id); else conjunto.add(id);
      return render();
    }
    if (d.renombrarCat) {
      const nuevo = prompt(`Nuevo nombre para «${d.nombre}» (se actualizará en todas sus tareas):`, d.nombre);
      if (!nuevo || nuevo.trim() === d.nombre) return;
      await api(`/api/categorias/${d.renombrarCat}`, { method: 'PUT', body: { nombre: nuevo } });
      toast('Categoría renombrada'); await gestionarCatalogos('categorias'); return render();
    }
    if (d.borrarCat) {
      const aviso = Number(d.tareas) ? ` Sus ${d.tareas} tarea(s) pasarán a «General».` : '';
      if (!confirm(`¿Eliminar la categoría «${d.nombre}»?${aviso}`)) return;
      await api(`/api/categorias/${d.borrarCat}`, { method: 'DELETE' });
      toast('Categoría eliminada'); await gestionarCatalogos('categorias'); return render();
    }
    if (d.borrarDesc) {
      await api(`/api/descripciones/${d.borrarDesc}`, { method: 'DELETE' });
      return gestionarCatalogos('descripciones');
    }
  } catch (err) { toast(err.message, 'error'); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.subirAdjuntos && el.files && el.files.length) {
    subirAdjuntos(Number(el.dataset.subirAdjuntos), el.files);
    return;
  }
  if (el.dataset.subirImagen && el.files && el.files[0]) {
    try {
      const dataUrl = await imagenA96(el.files[0]);
      await guardarIcono(Number(el.dataset.subirImagen), { imagen: dataUrl }, 'Imagen guardada');
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  if (el.dataset.toggleCompletada !== undefined) {
    el.closest('.ya-completada').querySelector('.campos-completada').classList.toggle('oculto', !el.checked);
    return;
  }
  if (el.dataset.depSelect !== undefined) {
    const d = el.value && requisitoDesdeValor(el.value);
    if (d) {
      const lista = el.closest('.dep-editor').querySelector('.dep-lista');
      lista.insertAdjacentHTML('beforeend', chipDependencia(d));
      el.selectedOptions[0].disabled = true;
    }
    el.value = '';
    return;
  }
  if (el.dataset.selectorCategoria !== undefined) {
    const nueva = el.parentElement.querySelector(`input[name="${el.name}_nueva"]`);
    nueva.classList.toggle('oculto', el.value !== '__nueva__');
    if (el.value === '__nueva__') nueva.focus();
    return;
  }
  if (el.dataset.usarDescripcion !== undefined) {
    const d = st.catalogos.descripciones.find((x) => x.id === Number(el.value));
    const ta = el.form.querySelector('textarea[name="descripcion"]');
    if (d) {
      if (ta.value.trim() && ta.value.trim() !== d.texto && !confirm('¿Reemplazar la descripción que ya escribiste?')) { el.value = ''; return; }
      ta.value = d.texto;
      ta.focus();
    }
    el.value = '';
    return;
  }
  if (el.dataset.hito) {
    try { await api(`/api/hitos/${el.dataset.hito}`, { method: 'PUT', body: { completado: el.checked } }); await render(); if (el.checked) toast('Hito logrado 🎯', 'exito'); }
    catch (err) { toast(err.message, 'error'); }
    return;
  }
  const mapa = { 'f-estado': 'estado', 'f-prioridad': 'prioridad', 'f-categoria': 'categoria' };
  if (mapa[el.id]) { st.filtros[mapa[el.id]] = el.value; pintarListaTareas(); }
  if (el.id === 'h-semana' || el.id === 'h-anio') {
    const w = Number($('#h-semana').value), a = Number($('#h-anio').value);
    if (w >= 1 && w <= 53) { st.hist.anio = a; st.hist.semana = w; render().catch(() => {}); }
  }
  if (el.id === 'f-periodo') { st.periodo = Number(el.value); render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'f-q') { st.filtros.q = e.target.value; pintarListaTareas(); }
});

$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest && e.target.closest('#f-nota-sesion')) {
    e.preventDefault();
    e.target.closest('form').requestSubmit();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest && e.target.closest('.f-comentario')) {
    e.preventDefault();
    e.target.closest('form').requestSubmit();
  }
});

['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  const zona = e.target.closest && e.target.closest('.drop-adjuntos');
  if (!zona) return;
  e.preventDefault();
  zona.classList.add('encima');
}));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  const zona = e.target.closest && e.target.closest('.drop-adjuntos');
  if (!zona) return;
  e.preventDefault();
  zona.classList.remove('encima');
  if (ev === 'drop') subirAdjuntos(Number(zona.dataset.tarea), e.dataTransfer.files);
}));

/* Editor de subtareas: Enter crea la siguiente, Backspace en una vacía la borra, pegar varias líneas crea varias. */
document.addEventListener('keydown', (e) => {
  const inp = e.target;
  if (!inp.classList || !inp.classList.contains('sub-input')) return;
  const fila = inp.closest('.sub-fila');
  if (e.key === 'Enter') {
    e.preventDefault();
    if (inp.value.trim()) $('.sub-input', agregarFilaSub(fila)).focus();
  } else if (e.key === 'Backspace' && !inp.value && !fila.dataset.subId) {
    const prev = fila.previousElementSibling;
    if (prev) { e.preventDefault(); fila.remove(); $('.sub-input', prev).focus(); }
  }
}, true);
document.addEventListener('paste', (e) => {
  const inp = e.target;
  if (!inp.classList || !inp.classList.contains('sub-input')) return;
  const lineas = (e.clipboardData.getData('text') || '').split(/\r?\n/).map((l) => l.replace(/^[\s•\-*\d.)]+/, '').trim()).filter(Boolean);
  if (lineas.length < 2) return;
  e.preventDefault();
  inp.value = (inp.value + lineas[0]).trim();
  let ultima = inp.closest('.sub-fila');
  for (const l of lineas.slice(1)) ultima = agregarFilaSub(ultima, l);
  $('.sub-input', ultima).focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { cerrarModal(); $('#panel-alertas').classList.add('oculto'); }
  const enCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (!enCampo && e.key.toLowerCase() === 'n' && $('#modal').classList.contains('oculto')) {
    e.preventDefault();
    if (st.vista === 'metas') formMeta(); else formTarea();
  }
});
$('#btn-nueva').addEventListener('click', () => formTarea());

/* Modo claro / oscuro. Se recuerda en este navegador; sin elección, sigue al sistema. */
const esOscuro = () => document.documentElement.classList.contains('tema-oscuro');
function pintarBotonTema() {
  $('#btn-tema').title = esOscuro() ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
}
$('#btn-tema').addEventListener('click', () => {
  const nuevo = esOscuro() ? 'light' : 'dark';
  const raiz = document.documentElement;
  raiz.classList.add('cambiando-tema');
  raiz.setAttribute('data-theme', nuevo);
  raiz.classList.toggle('tema-oscuro', nuevo === 'dark');
  try { localStorage.setItem('mifoco-tema', nuevo); } catch { /* sin almacenamiento */ }
  pintarBotonTema();
  setTimeout(() => raiz.classList.remove('cambiando-tema'), 400);
});
// Si nunca se eligió un tema, seguir los cambios del sistema.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (document.documentElement.hasAttribute('data-theme')) return;
  document.documentElement.classList.toggle('tema-oscuro', e.matches);
  pintarBotonTema();
});
pintarBotonTema();

document.addEventListener('click', (e) => {
  const marca = e.target.closest('[data-chk-subtarea]');
  if (marca) { e.preventDefault(); clicSubtarea(marca); }
});

/* Desplegar / contraer tareas: clic en la flecha o en cualquier parte libre de la fila. */
document.addEventListener('click', (e) => {
  const fila = e.target.closest('[data-toggle-tarea]');
  if (fila) {
    const interactivo = e.target.closest('button, a, input, select, label, form');
    if (interactivo && !interactivo.hasAttribute('data-toggle-tarea')) return;
    alternarTarea(Number(fila.dataset.toggleTarea));
    return;
  }
  const todas = e.target.closest('[data-desplegar-todas]');
  if (todas) {
    const abrir = todas.dataset.desplegarTodas === '1';
    filtrarTareas().forEach((t) => alternarTarea(t.id, abrir));
    todas.dataset.desplegarTodas = abrir ? '0' : '1';
    todas.textContent = abrir ? '⌃ Contraer todas' : '⌄ Desplegar todas';
  }
});
$('#btn-catalogos').addEventListener('click', () => gestionarCatalogos());
$('#btn-reporte').addEventListener('click', () => abrirReporte());

/* Menú de herramientas plegable (engrane). Se recuerda abierto/cerrado en este navegador. */
function ponerHerramientas(abierto, animar = true) {
  const caja = $('#herramientas');
  caja.classList.toggle('sin-animacion', !animar);
  caja.classList.toggle('abierto', abierto);
  $('#btn-herramientas').setAttribute('aria-expanded', String(abierto));
  try { localStorage.setItem('mifoco-herramientas', abierto ? '1' : '0'); } catch { /* sin almacenamiento */ }
}
$('#btn-herramientas').addEventListener('click', () => ponerHerramientas(!$('#herramientas').classList.contains('abierto')));
// Al usar una opción, el menú se recoge solo.
$('#herr-panel').addEventListener('click', (e) => { if (e.target.closest('.enlace')) setTimeout(() => ponerHerramientas(false), 150); });
try { ponerHerramientas(localStorage.getItem('mifoco-herramientas') === '1', false); } catch { ponerHerramientas(false, false); }
$('#btn-respaldo').addEventListener('click', async () => {
  try { const r = await api('/api/respaldo', { method: 'POST' }); toast(`Respaldo creado: ${r.archivo}`, 'exito'); }
  catch (err) { toast(err.message, 'error'); }
});

/* ─────────── alertas ─────────── */
function pintarPanelAlertas() {
  const a = st.alertas;
  $('#panel-alertas').innerHTML = `<h4>Alertas</h4>` + (a.length
    ? a.map((x) => `<div class="alerta ${x.nivel}" ${x.tarea_id ? `data-detalle="${x.tarea_id}"` : 'data-vista="metas"'}>
        <div>${{ peligro: '⛔', aviso: '⚠️', info: 'ℹ️' }[x.nivel]}</div><div><b>${esc(x.titulo)}</b>${esc(x.mensaje)}</div></div>`).join('')
    : '<div class="vacio">Sin alertas. ¡Vas bien!</div>');
}

async function revisarAlertas() {
  try {
    st.alertas = await api('/api/alertas');
  } catch { return; }
  const n = st.alertas.filter((a) => a.nivel !== 'info').length;
  const b = $('#badge-alertas');
  b.textContent = n;
  b.classList.toggle('oculto', n === 0);
  pintarPanelAlertas();
  const primera = !st.alertasRevisadas;
  st.alertasRevisadas = true;
  for (const a of st.alertas) {
    if (st.notificadas.has(a.clave)) continue;
    st.notificadas.add(a.clave);
    if (primera) continue;  // al abrir: sin avisos emergentes; quedan en la campana 🔔
    if (a.nivel === 'info' && !a.clave.startsWith('descanso')) continue;
    if ('Notification' in window && Notification.permission === 'granted') {
      const noti = new Notification(`Mi Foco · ${a.titulo}`, { body: a.mensaje, tag: a.clave });
      noti.onclick = () => { window.focus(); if (a.tarea_id) verDetalle(a.tarea_id); };
    } else {
      toast(`${a.titulo}: ${a.mensaje}`, a.nivel === 'peligro' ? 'error' : '');
    }
  }
  try { sessionStorage.setItem('mifoco-notificadas', JSON.stringify([...st.notificadas])); } catch { /* sin almacenamiento */ }
}

$('#btn-alertas').addEventListener('click', (e) => { e.stopPropagation(); $('#panel-alertas').classList.toggle('oculto'); });
function pintarBotonNotif() {
  const b = $('#btn-notif');
  if (!('Notification' in window)) { b.classList.add('oculto'); return; }
  b.innerHTML = `<i>🔔</i>${Notification.permission === 'granted' ? 'Notificaciones activas' : 'Activar notificaciones'}`;
}
$('#btn-notif').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  await Notification.requestPermission();
  pintarBotonNotif();
  if (Notification.permission === 'granted') toast('Notificaciones activadas', 'exito');
});

/* ─────────── arranque ─────────── */
(async function iniciar() {
  try { JSON.parse(sessionStorage.getItem('mifoco-notificadas') || '[]').forEach((k) => st.notificadas.add(k)); } catch { /* nada */ }
  $('#fecha-hoy').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  pintarBotonNotif();
  try { st.ia = await api('/api/ia/estado'); } catch { st.ia = { activa: false }; }
  document.body.classList.toggle('ia-activa', !!st.ia.activa);
  refrescar();
  setInterval(revisarAlertas, 60000);
  // Refresca la vista "Hoy" cada 5 min para mantener al día vencimientos y contadores.
  setInterval(() => { if (st.vista === 'hoy' && $('#modal').classList.contains('oculto')) render(); }, 300000);
})();

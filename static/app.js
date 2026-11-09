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
  subtarea_completada: 'Subtarea completada', subtarea_reabierta: 'Subtarea desmarcada', subtareas: 'Subtareas modificadas',
};
const ABIERTOS = ['pendiente', 'en_progreso', 'pausada'];

const st = {
  vista: 'hoy',
  tareas: [],
  metas: [],
  catalogos: { categorias: [], descripciones: [] },
  subInvertidas: new Set(),   // tareas cuya lista de subtareas el usuario abrió/cerró a mano
  filtros: { estado: 'abiertas', prioridad: '', categoria: '', q: '' },
  periodo: 30,
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
  if (!r.ok) throw new Error((data && data.error) || `Error ${r.status}`);
  return data;
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
  return `${Number(d.toFixed(1))} d`;
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
  st.activa = t ? { id: t.id, titulo: t.titulo, base: t.minutos_sesion_actual, desde: Date.now() } : null;
  pintarEnCurso();
}
async function cargarMetas() { st.metas = await api('/api/metas'); }
async function cargarCatalogos() { st.catalogos = await api('/api/catalogos'); }
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

/* Subtareas: abiertas por defecto en tareas abiertas, cerradas en las terminadas. */
const subExpandida = (t) => (abierta(t) ? !st.subInvertidas.has(t.id) : st.subInvertidas.has(t.id));

function checklistSubtareas(t, conAgregar = true) {
  return `<ul class="subtareas">${t.subtareas.map((s) => `<li class="${s.completada ? 'hecha' : ''}">
      <label><input type="checkbox" data-subtarea="${s.id}" data-tarea="${t.id}" ${s.completada ? 'checked' : ''} ${t.estado === 'cancelada' ? 'disabled' : ''}>
      <span>${esc(s.titulo)}</span></label>
      ${s.completada && s.completada_en ? `<small>${fmtFecha(s.completada_en)}</small>` : ''}</li>`).join('')}</ul>
    ${conAgregar && abierta(t) ? `<form class="f-subtarea" data-tarea="${t.id}"><input name="titulo" placeholder="+ Agregar subtarea y Enter" autocomplete="off"></form>` : ''}`;
}

function barraAvance(t, conBoton = true) {
  if (!t.subtareas_total) return '';
  return `<div class="avance">
    <div class="progreso ${t.progreso_pct === 100 ? 'lleno' : ''}"><div style="width:${t.progreso_pct}%"></div></div>
    <span>${t.subtareas_hechas}/${t.subtareas_total} · <b>${t.progreso_pct}%</b></span>
    ${conBoton ? `<button class="ico" data-expandir="${t.id}">${subExpandida(t) ? '▾' : '▸'} subtareas</button>` : ''}
  </div>`;
}

function tarjetaTarea(t) {
  const acc = [];
  if (['pendiente', 'pausada'].includes(t.estado)) acc.push(`<button class="mini" data-accion="iniciar" data-id="${t.id}">▶ ${t.estado === 'pausada' ? 'Reanudar' : 'Iniciar'}</button>`);
  if (t.estado === 'en_progreso') acc.push(`<button class="mini" data-accion="pausar" data-id="${t.id}">⏸ Pausar</button>`);
  if (abierta(t)) acc.push(`<button class="mini ok" data-accion="completar" data-id="${t.id}">✓ Completar</button>`);
  if (['completada', 'cancelada'].includes(t.estado)) acc.push(`<button class="mini" data-accion="reabrir" data-id="${t.id}">↺ Reabrir</button>`);

  const chips = [`<span class="chip">${esc(t.categoria)}</span>`];
  if (t.estado !== 'pendiente') chips.push(`<span class="chip ${t.estado === 'en_progreso' ? 'azul' : ''}">${ESTADOS[t.estado]}</span>`);
  if (t.meta_nombre) chips.push(`<span class="chip azul">◆ ${esc(t.meta_nombre)}</span>`);
  chips.push(etiquetaLimite(t));
  if (t.tiempo_real_min > 0 || t.estimado_min) {
    const real = fmtMin(t.tiempo_real_min);
    const est = t.estimado_min ? ` / ${fmtMin(t.estimado_min)}` : '';
    const exceso = t.estimado_min && t.tiempo_real_min > t.estimado_min;
    chips.push(`<span class="chip ${exceso ? 'ambar' : ''}">⏱ ${real}${est}</span>`);
  }
  return `<article class="tarea est-${t.estado} ${t.vencida ? 'vencida' : ''}">
    <div class="prio prio-${t.prioridad}" title="${esc(PRIORIDADES[t.prioridad])}">${t.prioridad}</div>
    <div class="t-cuerpo">
      <div class="t-titulo" data-detalle="${t.id}">${t.es_rana ? '🐸 ' : ''}${esc(t.titulo)}</div>
      <div class="t-meta">${chips.join('')}</div>
      ${barraAvance(t)}
      ${t.subtareas_total && subExpandida(t) ? checklistSubtareas(t) : ''}
    </div>
    <div class="t-acciones">${acc.join('')}
      <button class="ico" data-editar="${t.id}" title="Editar">✎</button>
      ${abierta(t) ? `<button class="ico" data-accion="cancelar" data-id="${t.id}" title="Cancelar">⊘</button>` : ''}
      <button class="ico" data-eliminar="${t.id}" title="Eliminar">🗑</button>
    </div>
  </article>`;
}

function listaTareas(tareas, vacio = 'Nada por aquí.') {
  if (!tareas.length) return `<div class="vacio">${vacio}</div>`;
  return `<div class="lista">${tareas.map(tarjetaTarea).join('')}</div>`;
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
  return datos.map((d) => `<div class="hbar"><span title="${esc(d.etiqueta)}">${esc(d.etiqueta)}</span>
    <div class="hbar-pista"><div style="width:${(d.valor / max * 100).toFixed(1)}%;${d.color ? 'background:' + d.color : ''}"></div></div>
    <b>${esc(formato(d.valor))}</b></div>`).join('');
}

const kpi = (valor, etiqueta, detalle = '', clase = '') =>
  `<div class="kpi ${clase}"><div class="v">${valor}</div><div class="l">${etiqueta}</div>${detalle ? `<div class="d">${detalle}</div>` : ''}</div>`;

/* ─────────── vistas ─────────── */
async function vistaHoy() {
  const [frase, stats] = await Promise.all([api('/api/frase'), api('/api/estadisticas?dias=1'), cargarTareas(), cargarCatalogos()]);
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

  const bloqueRana = rana ? `
    <div class="tarjeta rana">
      <div class="emoji">🐸</div>
      <div class="cuerpo"><span class="sutil">${rana.es_rana ? 'Tu rana de hoy' : 'Tu tarea A más importante'}</span>
        <b>${esc(rana.titulo)}</b>${etiquetaLimite(rana)}${barraAvance(rana, false)}</div>
      ${rana.estado === 'en_progreso'
        ? `<button class="exito" data-accion="completar" data-id="${rana.id}">✓ Terminé</button>`
        : `<button class="primario" data-accion="iniciar" data-id="${rana.id}">Comer la rana ▶</button>`}
    </div>`
    : `<div class="tarjeta rana"><div class="emoji">🐸</div><div class="cuerpo"><b>No tienes una “rana” definida</b>
      <span class="sutil">Marca como rana la tarea más importante y difícil del día y hazla primero.</span></div></div>`;

  return `
    <div class="tarjeta frase">
      <div class="etiqueta">Frase del día · ${esc(frase.principio)}</div>
      <blockquote>${esc(frase.texto)}</blockquote>
      <div class="practica">💡 ${esc(frase.practica)}</div>
      <button class="otra" data-otra-frase>Otra ↻</button>
    </div>

    <div class="rejilla r4 mt">
      ${kpi(abiertas.length, 'Pendientes')}
      ${kpi(vencidas.length, 'Vencidas', '', vencidas.length ? 'rojo' : '')}
      ${kpi(completadasHoy.length, 'Completadas hoy', '', 'verde')}
      ${kpi(fmtMin(stats.minutos_foco), 'Foco hoy', `Racha: ${stats.racha_dias} día(s)`, 'azul')}
    </div>

    <div class="mt">${bloqueRana}</div>

    <div class="tarjeta mt">
      <form id="f-rapida" class="rapida">
        <input name="titulo" placeholder="Anota un pendiente y presiona Enter…" autocomplete="off">
        ${selectorCategoria(st.ultimaCategoria || 'General')}
        <select name="prioridad">${Object.keys(PRIORIDADES).map((p) => `<option ${p === 'B' ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <button class="primario">Agregar</button>
      </form>
    </div>

    <div class="rejilla r2 mt">
      <div class="tarjeta"><h3>En curso <small>${enCurso.length}</small></h3>${listaTareas(enCurso, 'Nada en curso. Empieza por tu rana.')}</div>
      <div class="tarjeta"><h3>Vencidas y por vencer (24 h) <small>${vencidas.length + pronto.length}</small></h3>${listaTareas([...vencidas, ...pronto], '<span class="grande">✨</span>Nada vencido ni por vencer (fuera de lo que está en curso).')}</div>
    </div>
    <div class="tarjeta mt"><h3>Otras tareas A <small>${prioA.length}</small></h3>${listaTareas(prioA, 'No hay más tareas A pendientes.')}</div>`;
}

function filtrarTareas() {
  const f = st.filtros;
  const q = f.q.trim().toLowerCase();
  return st.tareas.filter((t) => {
    if (f.estado === 'abiertas' && !abierta(t)) return false;
    if (f.estado === 'vencidas' && !t.vencida) return false;
    if (!['abiertas', 'vencidas', 'todas'].includes(f.estado) && t.estado !== f.estado) return false;
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

function pintarListaTareas() {
  const lista = filtrarTareas();
  const el = $('#lista-tareas');
  if (el) el.innerHTML = `<p class="sutil" style="margin-bottom:10px">${lista.length} tarea(s)</p>` + listaTareas(lista, '<span class="grande">🔍</span>No hay tareas con esos filtros.');
}

async function vistaTareas() {
  await Promise.all([cargarTareas(), cargarMetas(), cargarCatalogos()]);
  const f = st.filtros;
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${sel === v ? 'selected' : ''}>${esc(l)}</option>`;
  setTimeout(pintarListaTareas, 0);
  return `
    <div class="filtros">
      <input id="f-q" placeholder="Buscar…" value="${esc(f.q)}">
      <select id="f-estado">
        ${opt('abiertas', 'Abiertas', f.estado)}${opt('vencidas', 'Vencidas', f.estado)}
        ${Object.entries(ESTADOS).map(([k, v]) => opt(k, v, f.estado)).join('')}${opt('todas', 'Todas', f.estado)}
      </select>
      <select id="f-prioridad">${opt('', 'Toda prioridad', f.prioridad)}${Object.keys(PRIORIDADES).map((p) => opt(p, 'Prioridad ' + p, f.prioridad)).join('')}</select>
      <select id="f-categoria">${opt('', 'Toda categoría', f.categoria)}${categorias().map((c) => opt(c, c, f.categoria)).join('')}</select>
    </div>
    <div id="lista-tareas"></div>`;
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
  await Promise.all([cargarMetas(), cargarTareas()]);
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
  const s = await api(`/api/estadisticas?dias=${st.periodo}`);
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
        ${barrasH(s.por_categoria.map((c) => ({ etiqueta: c.categoria, valor: c.completadas })))}</div>
    </div>`;
}

async function vistaHistorial() {
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
  try {
    $('#vista').innerHTML = await fn();
  } catch (e) {
    $('#vista').innerHTML = `<div class="tarjeta vacio">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}

async function refrescar() { await render(); revisarAlertas(); }

/* ─────────── modales y formularios ─────────── */
function abrirModal(html) { $('#modal-caja').innerHTML = html; $('#modal').classList.remove('oculto'); const f = $('#modal-caja input, #modal-caja textarea'); if (f) f.focus(); }
function cerrarModal() { $('#modal').classList.add('oculto'); $('#modal-caja').innerHTML = ''; }

function selectorCategoria(actual = 'General', nombre = 'categoria') {
  const lista = categorias();
  if (actual && !lista.some((c) => c.toLowerCase() === actual.toLowerCase())) lista.unshift(actual);
  return `<select name="${nombre}" data-selector-categoria>
      ${lista.map((c) => `<option value="${esc(c)}" ${c.toLowerCase() === (actual || '').toLowerCase() ? 'selected' : ''}>${esc(c)}</option>`).join('')}
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
  await Promise.all([st.metas.length ? null : cargarMetas().catch(() => {}), cargarCatalogos().catch(() => {})]);
  const metas = st.metas.filter((m) => m.estado !== 'lograda' || m.id === t.meta_id);
  abrirModal(`<h2>${t.id ? 'Editar' : 'Nueva'} tarea</h2>
    <form id="f-tarea" data-id="${t.id || ''}">
      <label>Título<input name="titulo" required maxlength="200" value="${esc(t.titulo || '')}"></label>
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
      ${editorSubtareas(t.subtareas || [])}
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
       ${cats.map((c) => `<tr><td><b>${esc(c.nombre)}</b></td><td>${c.tareas}</td><td>${c.usos}</td>
         <td style="text-align:right;white-space:nowrap">
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

async function verDetalle(id) {
  const t = await api(`/api/tareas/${id}`);
  const filas = [
    ['Estado', ESTADOS[t.estado]], ['Prioridad', PRIORIDADES[t.prioridad].split(' (')[0]], ['Categoría', esc(t.categoria)],
    ['Creada', fmtFecha(t.creada_en)], ['Iniciada', fmtFecha(t.iniciada_en)], ['Completada', fmtFecha(t.completada_en)],
    ['Fecha límite', fmtFecha(t.fecha_limite)], ['Tiempo real', fmtMin(t.tiempo_real_min)],
    ['Estimado', t.estimado_min ? fmtMin(t.estimado_min) : '—'],
    ['Ciclo total', t.ciclo_horas != null ? fmtDias(t.ciclo_horas / 24) : '—'],
    ['Atraso', t.dias_atraso > 0 ? fmtDias(t.dias_atraso) : 'Ninguno'],
    ['Sesiones de trabajo', t.sesiones.length],
  ];
  abrirModal(`<h2>${t.es_rana ? '🐸 ' : ''}${esc(t.titulo)}</h2>
    ${t.descripcion ? `<p style="white-space:pre-wrap">${esc(t.descripcion)}</p>` : ''}
    <div class="datos" style="grid-template-columns:repeat(3,1fr)">${filas.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    ${t.subtareas_total || abierta(t) ? `<h3 style="margin:18px 0 8px">Subtareas</h3><div data-detalle-subs="${t.id}">${barraAvance(t, false)}${checklistSubtareas(t)}</div>` : ''}
    <h3 style="margin:18px 0 12px">Línea de tiempo</h3>
    <ul class="timeline">${t.eventos.map((e) => `<li class="ev-${e.tipo}"><b>${EVENTOS[e.tipo] || esc(e.tipo)}</b>
      <div class="cuando">${fmtFecha(e.momento)}</div>${e.detalle ? `<div class="sutil">${esc(e.detalle)}</div>` : ''}</li>`).join('')}</ul>
    <div class="botones"><button class="secundario" data-editar="${t.id}">✎ Editar</button><button class="primario" data-cerrar>Cerrar</button></div>`);
}

/* ─────────── acciones ─────────── */
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
  if (accion === 'cancelar') {
    const motivo = prompt('¿Por qué la cancelas? (opcional)');
    if (motivo === null) return;
    cuerpo.motivo = motivo;
  }
  try {
    const r = await api(`/api/tareas/${id}/accion`, { method: 'POST', body: cuerpo });
    const msgs = {
      iniciar: '▶ En marcha. Una sola cosa a la vez.',
      pausar: '⏸ Pausada.',
      completar: r.es_rana ? '🐸 ¡Te comiste la rana! Lo demás será más fácil.' : r.completada_a_tiempo === false ? '✓ Completada (con atraso).' : '✓ ¡Completada!',
      reabrir: '↺ Reabierta.',
      cancelar: '⊘ Cancelada.',
    };
    toast(msgs[accion], accion === 'completar' ? 'exito' : '');
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
      if (f.dataset.id) await api(`/api/tareas/${f.dataset.id}`, { method: 'PUT', body: d });
      else await api('/api/tareas', { method: 'POST', body: d });
      cerrarModal(); toast('Tarea guardada'); await cargarCatalogos(); await refrescar();
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
    if (d.accion) return accionTarea(Number(d.id), d.accion);
    if (d.detalle) { e.preventDefault(); $('#panel-alertas').classList.add('oculto'); return verDetalle(Number(d.detalle)); }
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
    if (d.otraFrase !== undefined) {
      const fr = await api('/api/frase?aleatoria=1');
      const caja = el.closest('.frase');
      caja.querySelector('.etiqueta').textContent = `Frase · ${fr.principio}`;
      caja.querySelector('blockquote').textContent = fr.texto;
      caja.querySelector('.practica').textContent = `💡 ${fr.practica}`;
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
      if (st.subInvertidas.has(id)) st.subInvertidas.delete(id); else st.subInvertidas.add(id);
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
  if (el.dataset.subtarea) {
    try {
      const t = await api(`/api/subtareas/${el.dataset.subtarea}`, { method: 'PUT', body: { completada: el.checked } });
      const enModal = !!el.closest('[data-detalle-subs]');
      if (el.checked) toast(`✓ Avance ${t.progreso_pct}% (${t.subtareas_hechas}/${t.subtareas_total})`, 'exito');
      if (enModal) await verDetalle(t.id);
      await render();
      if (el.checked && t.subtareas_total && t.subtareas_hechas === t.subtareas_total && abierta(t)
          && confirm('¡Todas las subtareas listas! 🎉 ¿Marcar la tarea como completada?')) {
        if (enModal) cerrarModal();
        await accionTarea(t.id, 'completar');
      }
    } catch (err) { toast(err.message, 'error'); el.checked = !el.checked; }
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
  if (el.id === 'f-periodo') { st.periodo = Number(el.value); render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'f-q') { st.filtros.q = e.target.value; pintarListaTareas(); }
});

$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') cerrarModal(); });
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
  if (!enCampo && e.key.toLowerCase() === 'n' && $('#modal').classList.contains('oculto')) { e.preventDefault(); formTarea(); }
});
$('#btn-nueva').addEventListener('click', () => formTarea());
$('#btn-catalogos').addEventListener('click', () => gestionarCatalogos());
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
  for (const a of st.alertas) {
    if (st.notificadas.has(a.clave)) continue;
    st.notificadas.add(a.clave);
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
  b.textContent = Notification.permission === 'granted' ? '🔔 Notificaciones activas' : '🔔 Activar notificaciones';
}
$('#btn-notif').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  await Notification.requestPermission();
  pintarBotonNotif();
  if (Notification.permission === 'granted') toast('Notificaciones activadas', 'exito');
});

/* ─────────── arranque ─────────── */
(function iniciar() {
  try { JSON.parse(sessionStorage.getItem('mifoco-notificadas') || '[]').forEach((k) => st.notificadas.add(k)); } catch { /* nada */ }
  $('#fecha-hoy').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  pintarBotonNotif();
  refrescar();
  setInterval(revisarAlertas, 60000);
  // Refresca la vista "Hoy" cada 5 min para mantener al día vencimientos y contadores.
  setInterval(() => { if (st.vista === 'hoy' && $('#modal').classList.contains('oculto')) render(); }, 300000);
})();

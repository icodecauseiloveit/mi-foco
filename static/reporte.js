'use strict';
/* Mi Foco — Reporte de cumplimiento como imagen (PNG) para pegar en un correo.
   Se dibuja con Canvas 2D: no usa librerías externas y funciona sin internet. */

const RPT = {
  ancho: 1100, escala: 2, margen: 40,
  fuente: '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif',
  c: { // colores fijos (claro), porque el correo se lee sobre fondo blanco
    fondo: '#ffffff', texto: '#1d2033', sutil: '#6b7085', borde: '#e4e6ef', zebra: '#f8f9fc', acento: '#4f46e5',
    pista: '#eceef5',
  },
  estados: {
    a_tiempo: ['#15803d', '#dcfce7'], sin_fecha: ['#166534', '#ecfdf3'], atrasada: ['#b45309', '#fef3c7'],
    vencida: ['#b91c1c', '#fee2e2'], con_novedad: ['#c2410c', '#ffedd5'], bloqueada: ['#334155', '#e2e8f0'], en_curso: ['#4338ca', '#e0e7ff'], pendiente: ['#475569', '#f1f5f9'],
  },
  prioridad: { A: ['#c81e1e', '#fff'], B: ['#ea580c', '#fff'], C: ['#f59e0b', '#3b2304'], D: ['#fcd34d', '#3b2f04'], E: ['#cbd5e1', '#334155'] },
  maxFilas: 28,
};

const rptState = { periodo: 'semana_pasada', desde: '', hasta: '', categoria: '', autor: '', sinFecha: true, datos: null, lienzo: null };
try { rptState.autor = localStorage.getItem('mifoco-reporte-autor') || ''; } catch { /* sin almacenamiento */ }

function isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function rangoRapido(clave) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const dia = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (clave) {
    case 'semana': return [lunes, hoy];
    case 'semana_pasada': return [dia(lunes, -7), dia(lunes, -1)];
    case 'mes': return [new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy];
    case 'mes_pasado': return [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 0)];
    default: return null;
  }
}

const fechaLarga = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
function textoPeriodo(desde, hasta) {
  if (desde === hasta) return fechaLarga(desde);
  const a = new Date(desde + 'T00:00:00'), b = new Date(hasta + 'T00:00:00');
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} al ${b.getDate()} de ${b.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}`;
  }
  return `${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
}
const fechaCorta = (iso, hora = false) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  const dia = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ');
  if (!hora || iso.length <= 10) return dia;
  return `${dia} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ── utilidades de dibujo ── */
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function fuente(ctx, peso, px) { ctx.font = `${peso} ${px}px ${RPT.fuente}`; }
function recortar(ctx, texto, max) {
  if (ctx.measureText(texto).width <= max) return texto;
  let t = texto;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}
function colorPorcentaje(p) { return p == null ? RPT.c.sutil : p >= 85 ? '#15803d' : p >= 60 ? '#b45309' : '#b91c1c'; }
function pastilla(ctx, x, yCentro, texto, [color, fondo], px = 12) {
  fuente(ctx, 700, px);
  const w = ctx.measureText(texto).width + 18, h = px + 10;
  ctx.fillStyle = fondo; rr(ctx, x, yCentro - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(texto, x + 9, yCentro + 0.5);
  return w;
}
function barra(ctx, x, y, w, h, pct, color) {
  ctx.fillStyle = RPT.c.pista; rr(ctx, x, y, w, h, h / 2); ctx.fill();
  if (pct > 0) { ctx.fillStyle = color; rr(ctx, x, y, Math.max(h, w * Math.min(100, pct) / 100), h, h / 2); ctx.fill(); }
}

/** Parte un texto en líneas que caben en `ancho` (máximo `max` líneas; la última termina en «…» si sobra). */
function partirLineas(ctx, texto, ancho, max = 2) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (let i = 0; i < palabras.length; i++) {
    const prueba = actual ? `${actual} ${palabras[i]}` : palabras[i];
    if (ctx.measureText(prueba).width <= ancho) { actual = prueba; continue; }
    if (actual) lineas.push(actual);
    actual = palabras[i];
    if (lineas.length === max) { actual = ''; break; }
  }
  if (actual && lineas.length < max) lineas.push(actual);
  const usadas = lineas.join(' ').split(/\s+/).length;
  if (usadas < palabras.length && lineas.length) lineas[lineas.length - 1] = recortar(ctx, lineas[lineas.length - 1] + ' ' + palabras.slice(usadas).join(' '), ancho);
  return lineas.map((l) => recortar(ctx, l, ancho));
}

/** Dibuja el reporte completo y devuelve el <canvas>. */
function dibujarReporte(datos, { autor = '' } = {}) {
  const { ancho, escala, margen: M, c } = RPT;
  const k = datos.kpis;
  const filas = datos.actividades.slice(0, RPT.maxFilas);
  const resto = datos.actividades.length - filas.length;
  const altoFila = 50, altoLineaComent = 17;
  // Se calculan antes las líneas del último comentario de cada fila para saber el alto total.
  const medidor = document.createElement('canvas').getContext('2d');
  fuente(medidor, 'italic 400', 12);
  const anchoComent = ancho - 2 * M - 34 - 12;
  const plano = (txt) => txt.replace(/\s*\n+\s*/g, ' · ');
  filas.forEach((a) => {
    const nov = [];
    if (a.novedad) nov.push(`Novedad (${fechaCorta(a.novedad.fecha)}): ${plano(a.novedad.texto)}`);
    (a.novedades_sub || []).forEach((n) => nov.push(`${n.titulo}: ${plano(n.texto)}`));
    a._nov = nov.length ? partirLineas(medidor, nov.join('  ·  '), anchoComent - 22, 2) : [];
    a._coment = a.ultimo_comentario
      ? partirLineas(medidor, `${fechaCorta(a.ultimo_comentario.fecha)}: ${plano(a.ultimo_comentario.texto)}`, anchoComent - 22, 2)
      : [];
    const banda = (n) => (n ? 6 + n * altoLineaComent : 0);
    a._alto = altoFila + banda(a._nov.length) + banda(a._coment.length) + (a._nov.length && a._coment.length ? 4 : 0);
  });
  const altoFilas = filas.length ? filas.reduce((n, a) => n + a._alto, 0) : altoFila;
  // Alto exacto: encabezado+indicadores (268) + avance (44) + cabecera de tabla (40) + filas + "más" + pie
  const alto = 268 + 44 + 40 + altoFilas + (resto ? 34 : 0) + 58;

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho * escala; lienzo.height = alto * escala;
  const ctx = lienzo.getContext('2d');
  ctx.scale(escala, escala);
  ctx.fillStyle = c.fondo; ctx.fillRect(0, 0, ancho, alto);
  ctx.textBaseline = 'alphabetic';

  // ── Encabezado
  ctx.fillStyle = c.acento; ctx.fillRect(0, 0, ancho, 6);
  fuente(ctx, 700, 26); ctx.fillStyle = c.texto; ctx.fillText('Reporte de cumplimiento de actividades', M, 58);
  fuente(ctx, 500, 15); ctx.fillStyle = c.sutil;
  const sub = `Periodo: ${textoPeriodo(datos.desde, datos.hasta)}${datos.categoria ? `  ·  Categoría: ${datos.categoria}` : ''}`;
  ctx.fillText(sub, M, 86);
  ctx.textAlign = 'right';
  if (autor) { fuente(ctx, 600, 14); ctx.fillStyle = c.texto; ctx.fillText(`Preparado por: ${autor}`, ancho - M, 58); }
  fuente(ctx, 400, 13); ctx.fillStyle = c.sutil;
  ctx.fillText(`Generado: ${new Date(datos.generado).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, ancho - M, autor ? 80 : 58);
  ctx.textAlign = 'left';
  ctx.strokeStyle = c.borde; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, 118); ctx.lineTo(ancho - M, 118); ctx.stroke();

  // ── Indicadores
  let y = 138;
  const tarjetas = [
    { t: 'Cumplimiento del plan', v: k.cumplimiento_plan_pct, pct: true, d: k.plan_total ? `${k.plan_cumplido} de ${k.plan_total} a tiempo` : 'Nada vencía en el periodo' },
    { t: 'Entregas a tiempo', v: k.entregas_a_tiempo_pct, pct: true, d: k.a_tiempo + k.tarde ? `${k.a_tiempo} de ${k.a_tiempo + k.tarde} entregas` : 'Sin entregas con fecha' },
    { t: 'Completadas', v: k.completadas, d: `de ${k.actividades} actividades del reporte`, color: '#15803d' },
    { t: 'En curso / pendientes', v: `${k.en_curso} / ${k.pendientes}`, d: k.con_novedad ? `● ${k.con_novedad} con novedad` : 'trabajo abierto', color: '#4338ca' },
    { t: 'Vencidas', v: k.vencidas, d: k.vencidas ? 'requieren atención' : 'nada vencido', color: k.vencidas ? '#b91c1c' : '#15803d' },
  ];
  const gap = 14, wT = (ancho - 2 * M - gap * (tarjetas.length - 1)) / tarjetas.length, hT = 108;
  tarjetas.forEach((tj, i) => {
    const x = M + i * (wT + gap);
    ctx.fillStyle = c.zebra; rr(ctx, x, y, wT, hT, 12); ctx.fill();
    ctx.strokeStyle = c.borde; ctx.stroke();
    fuente(ctx, 600, 12.5); ctx.fillStyle = c.sutil; ctx.fillText(recortar(ctx, tj.t, wT - 28), x + 14, y + 26);
    fuente(ctx, 800, 30);
    const color = tj.pct ? colorPorcentaje(tj.v) : (tj.color || c.texto);
    ctx.fillStyle = color; ctx.fillText(tj.v == null ? '—' : tj.pct ? `${tj.v}%` : String(tj.v), x + 14, y + 62);
    if (tj.pct) barra(ctx, x + 14, y + 72, wT - 28, 6, tj.v || 0, color);
    fuente(ctx, 400, 11.5); ctx.fillStyle = c.sutil; ctx.fillText(recortar(ctx, tj.d, wT - 28), x + 14, y + (tj.pct ? 97 : 90));
  });
  y += hT + 22;

  // ── Avance general
  fuente(ctx, 700, 14); ctx.fillStyle = c.texto; ctx.fillText('Avance general de las actividades', M, y + 14);
  const av = k.avance_pct ?? 0;
  fuente(ctx, 800, 16); ctx.textAlign = 'right'; ctx.fillStyle = c.acento; ctx.fillText(`${k.avance_pct == null ? '—' : av + '%'}`, ancho - M, y + 15); ctx.textAlign = 'left';
  barra(ctx, M + 270, y + 5, ancho - 2 * M - 270 - 60, 12, av, c.acento);
  y += 44;

  // ── Tabla
  // Columnas (ancho útil 1020 px): la última termina dentro del margen derecho
  const col = { n: M, act: M + 34, prio: M + 430, est: M + 474, av: M + 696, lim: M + 822, fin: M + 912 };
  ctx.fillStyle = '#f1f2f7'; rr(ctx, M, y, ancho - 2 * M, 34, 8); ctx.fill();
  fuente(ctx, 700, 11.5); ctx.fillStyle = c.sutil;
  [['#', col.n + 10], ['ACTIVIDAD', col.act], ['PRIO.', col.prio], ['ESTADO', col.est], ['AVANCE', col.av], ['LÍMITE', col.lim], ['COMPLETADA', col.fin]]
    .forEach(([t, x]) => ctx.fillText(t, x, y + 22));
  y += 40;

  if (!filas.length) {
    fuente(ctx, 400, 14); ctx.fillStyle = c.sutil; ctx.fillText('No hay actividades en este periodo.', col.act, y + 30);
    y += altoFila;
  }
  filas.forEach((a, i) => {
    const yc = y + altoFila / 2;
    if (i % 2 === 1) { ctx.fillStyle = c.zebra; ctx.fillRect(M, y, ancho - 2 * M, a._alto); }
    fuente(ctx, 600, 12); ctx.fillStyle = c.sutil; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), col.n + 10, yc);
    // actividad: título + línea de detalle
    fuente(ctx, 600, 14); ctx.fillStyle = c.texto; ctx.textBaseline = 'alphabetic';
    ctx.fillText(recortar(ctx, a.titulo, col.prio - col.act - 16), col.act, yc - 3);
    const det = [a.categoria, a.subtareas ? `subtareas ${a.subtareas}` : '', a.entregable ? `entregable: ${a.entregable}` : ''].filter(Boolean).join('  ·  ');
    fuente(ctx, 400, 11.5); ctx.fillStyle = c.sutil; ctx.fillText(recortar(ctx, det, col.prio - col.act - 16), col.act, yc + 14);
    // prioridad
    const [pf, pt] = RPT.prioridad[a.prioridad];
    ctx.fillStyle = pf; rr(ctx, col.prio + 4, yc - 12, 24, 24, 6); ctx.fill();
    fuente(ctx, 800, 12.5); ctx.fillStyle = pt; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.prioridad, col.prio + 16, yc + 0.5);
    ctx.textAlign = 'left';
    // estado (pastilla con texto: nunca solo color)
    fuente(ctx, 700, 11.5);
    pastilla(ctx, col.est, yc, recortar(ctx, a.estado_texto, col.av - col.est - 32), RPT.estados[a.estado], 11.5);
    // avance
    barra(ctx, col.av, yc - 4, 70, 8, a.progreso, a.progreso >= 100 ? '#16a34a' : c.acento);
    fuente(ctx, 600, 11.5); ctx.fillStyle = c.texto; ctx.fillText(`${a.progreso}%`, col.av + 78, yc);
    // fechas
    fuente(ctx, 400, 12); ctx.fillStyle = a.estado === 'vencida' ? '#b91c1c' : c.texto;
    ctx.fillText(fechaCorta(a.fecha_limite), col.lim, yc);
    ctx.fillStyle = c.texto; ctx.fillText(fechaCorta(a.completada_en, true), col.fin, yc);
    ctx.textBaseline = 'alphabetic';
    // franjas a todo lo ancho bajo la fila: ● novedad (rojo) y 💬 último comentario (azul)
    let yB = y + altoFila + 2;
    const franja = (lineas, fondo, borde, colorTxt, icono, italica) => {
      if (!lineas.length) return;
      ctx.fillStyle = fondo; rr(ctx, col.act - 6, yB - 2, anchoComent + 12, lineas.length * altoLineaComent + 8, 7); ctx.fill();
      ctx.fillStyle = borde; ctx.fillRect(col.act - 6, yB - 2, 3, lineas.length * altoLineaComent + 8);
      if (icono === '●') { ctx.beginPath(); ctx.arc(col.act + 8, yB + 9, 4.5, 0, Math.PI * 2); ctx.fill(); }
      else { fuente(ctx, 400, 12); ctx.fillText(icono, col.act + 2, yB + 13); }
      fuente(ctx, italica ? 'italic 400' : '600', 12); ctx.fillStyle = colorTxt;
      lineas.forEach((linea, j) => ctx.fillText(linea, col.act + 22, yB + 13 + j * altoLineaComent));
      yB += lineas.length * altoLineaComent + 10;
    };
    franja(a._nov, '#fef2f2', '#dc2626', '#991b1b', '●', false);
    franja(a._coment, '#eef6fc', '#0284c7', '#0c4a6e', '💬', true);
    ctx.strokeStyle = c.borde; ctx.beginPath(); ctx.moveTo(M, y + a._alto); ctx.lineTo(ancho - M, y + a._alto); ctx.stroke();
    y += a._alto;
  });
  if (resto) {
    fuente(ctx, 500, 12.5); ctx.fillStyle = c.sutil;
    ctx.fillText(`+ ${resto} actividad(es) más en el periodo.`, col.act, y + 22);
    y += 34;
  }

  // ── Pie
  fuente(ctx, 400, 11.5); ctx.fillStyle = c.sutil;
  ctx.fillText('Cumplimiento del plan: lo que vencía en el periodo y se cerró a tiempo  ·  ● novedad que impide terminar  ·  💬 último comentario  ·  Estado al generar.', M, alto - 24);
  ctx.textAlign = 'right'; ctx.fillText('Mi Foco', ancho - M, alto - 24); ctx.textAlign = 'left';
  return lienzo;
}

/* ── correo HTML gerencial ──
   Tablas y estilos en línea: es lo que Outlook y Gmail conservan al pegar. Colores fijos (fondo blanco). */
const MAIL = {
  f: "'Segoe UI', Calibri, Arial, sans-serif", texto: '#1d2033', sutil: '#6b7085', borde: '#e4e6ef', fondo: '#f4f5f9',
  acento: '#4f46e5', zebra: '#f8f9fc', pista: '#e8eaf2',
};
const mailEsc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colorPct = (p) => (p == null ? MAIL.sutil : p >= 85 ? '#15803d' : p >= 60 ? '#b45309' : '#b91c1c');

/** Actividades vencidas, con novedad o bloqueadas (cada una una sola vez). */
const requierenAtencion = (d) => d.actividades.filter((a) => ['vencida', 'con_novedad', 'bloqueada'].includes(a.estado)
  || a.novedad || a.novedades_sub.length);

/** Resumen automático (sin IA) a partir de los indicadores. */
function resumenAutomatico(d) {
  const k = d.kpis;
  const s = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const partes = [`En el periodo se gestionaron ${s(k.actividades, 'actividad', 'actividades')}: ${s(k.completadas, 'completada', 'completadas')}`
    + (k.tarde ? ` (${k.a_tiempo} a tiempo y ${k.tarde} con atraso)` : k.completadas ? ' a tiempo' : '')
    + `, ${k.en_curso} en curso y ${s(k.pendientes, 'pendiente', 'pendientes')}.`];
  if (k.cumplimiento_plan_pct != null) {
    partes.push(`El cumplimiento del plan es de ${k.cumplimiento_plan_pct} % (${k.plan_cumplido} de ${k.plan_total} entregas programadas) y el avance general de ${k.avance_pct ?? 0} %.`);
  }
  const n = requierenAtencion(d).length;
  const motivos = [k.vencidas && s(k.vencidas, 'vencida', 'vencidas'), k.con_novedad && `${k.con_novedad} con novedad`].filter(Boolean).join(' y ');
  partes.push(n ? `${n === 1 ? 'Requiere' : 'Requieren'} atención ${s(n, 'actividad', 'actividades')}${motivos ? ` (${motivos})` : ''}.`
    : 'No hay actividades vencidas ni con novedad.');
  return partes.join(' ');
}
const asuntoAutomatico = (d) => `Reporte de cumplimiento · ${textoPeriodo(d.desde, d.hasta)}${d.categoria ? ` · ${d.categoria}` : ''}`
  + (d.kpis.cumplimiento_plan_pct != null ? ` · ${d.kpis.cumplimiento_plan_pct} % del plan` : '');

function correoHTML(d, { autor = '', resumen = '', acciones = [] } = {}) {
  const k = d.kpis;
  const M = MAIL;
  const celda = 'style="padding:0"';
  const kpi = (valor, etiqueta, detalle, color) => `<td width="25%" valign="top" style="padding:0 5px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${M.borde};border-radius:10px;background:#ffffff">
        <tr><td style="padding:14px 14px 12px;font-family:${M.f}">
          <div style="font-size:26px;line-height:30px;font-weight:700;color:${color}">${valor}</div>
          <div style="font-size:12px;line-height:16px;color:${M.texto};font-weight:600;margin-top:4px">${etiqueta}</div>
          <div style="font-size:11px;line-height:15px;color:${M.sutil};margin-top:2px">${detalle}</div>
        </td></tr></table></td>`;
  const pct = (v) => (v == null ? '—' : `${v}&nbsp;%`);
  const atencion = requierenAtencion(d);
  const pill = (a) => { const [c, bg] = RPT.estados[a.estado] || RPT.estados.pendiente;
    return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${c};font-size:11px;font-weight:600;white-space:nowrap">${mailEsc(a.estado_texto)}</span>`; };
  const prio = (p) => { const [bg, c] = RPT.prioridad[p] || RPT.prioridad.E;
    return `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:5px;background:${bg};color:${c};font-size:11px;font-weight:700">${p}</span>`; };
  const barra = (p) => { const c = p >= 100 ? '#16a34a' : M.acento;
    return `<table role="presentation" width="90" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
      ${p > 0 ? `<td width="${Math.round(0.9 * p)}" height="6" bgcolor="${c}" style="background:${c};font-size:0;line-height:0;border-radius:3px">&nbsp;</td>` : ''}
      ${p < 100 ? `<td width="${90 - Math.round(0.9 * p)}" height="6" bgcolor="${M.pista}" style="background:${M.pista};font-size:0;line-height:0;border-radius:3px">&nbsp;</td>` : ''}
      </tr></table><div style="font-size:11px;color:${M.sutil};margin-top:3px">${p}&nbsp;%</div>`; };
  const MAX = 40;
  const filas = d.actividades.slice(0, MAX).map((a, i) => {
    const extra = [];
    if (a.entregable) extra.push(`📦 ${mailEsc(a.entregable)}`);
    if (a.subtareas) extra.push(`subtareas ${a.subtareas}`);
    const nov = [a.novedad && `● ${mailEsc(a.novedad.texto)}`, ...a.novedades_sub.map((x) => `● ${mailEsc(x.titulo)}: ${mailEsc(x.texto)}`)].filter(Boolean);
    return `<tr style="background:${i % 2 ? M.zebra : '#ffffff'}">
      <td valign="top" style="padding:10px 8px;border-bottom:1px solid ${M.borde};font-family:${M.f};font-size:13px;color:${M.texto}">
        <div style="font-weight:600">${mailEsc(a.titulo)}</div>
        <div style="font-size:11px;color:${M.sutil};margin-top:2px">${mailEsc(a.categoria)}${extra.length ? ' · ' + extra.join(' · ') : ''}</div>
        ${nov.length ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px">${nov.join('<br>')}</div>` : ''}
        ${a.ultimo_comentario ? `<div style="font-size:11px;color:#1d4ed8;margin-top:4px">💬 ${mailEsc(a.ultimo_comentario.texto.slice(0, 180))}</div>` : ''}
      </td>
      <td valign="top" align="center" style="padding:10px 6px;border-bottom:1px solid ${M.borde}">${prio(a.prioridad)}</td>
      <td valign="top" style="padding:10px 6px;border-bottom:1px solid ${M.borde};font-family:${M.f}">${pill(a)}</td>
      <td valign="top" style="padding:12px 6px 10px;border-bottom:1px solid ${M.borde};font-family:${M.f}">${barra(a.progreso)}</td>
      <td valign="top" style="padding:10px 8px;border-bottom:1px solid ${M.borde};font-family:${M.f};font-size:12px;color:${M.texto};white-space:nowrap">
        ${a.completada_en ? `✓ ${fechaCorta(a.completada_en)}` : fechaCorta(a.fecha_limite)}</td>
    </tr>`; }).join('');
  const titulo = (t) => `<div style="font-family:${M.f};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${M.sutil};margin:0 0 8px">${t}</div>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${mailEsc(asuntoAutomatico(d))}</title></head>
<body style="margin:0;padding:0;background:${M.fondo}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${M.fondo}" style="background:${M.fondo}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:680px;max-width:100%;background:#ffffff;border:1px solid ${M.borde};border-radius:14px;border-collapse:separate">
  <tr><td bgcolor="${M.acento}" style="background:${M.acento};padding:22px 26px;border-radius:14px 14px 0 0;font-family:${M.f}">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c7d2fe;font-weight:700">Reporte de cumplimiento</div>
    <div style="font-size:22px;line-height:28px;color:#ffffff;font-weight:700;margin-top:4px">${mailEsc(textoPeriodo(d.desde, d.hasta))}</div>
    <div style="font-size:13px;color:#e0e7ff;margin-top:4px">${d.categoria ? `Categoría: ${mailEsc(d.categoria)} · ` : ''}${autor ? `Preparado por ${mailEsc(autor)} · ` : ''}Corte: ${fechaCorta(d.generado, true)}</div>
  </td></tr>
  <tr><td style="padding:22px 26px 6px;font-family:${M.f};font-size:14px;line-height:21px;color:${M.texto}">
    ${titulo('Resumen ejecutivo')}
    <div>${mailEsc(resumen || resumenAutomatico(d))}</div>
  </td></tr>
  <tr><td style="padding:16px 21px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${kpi(pct(k.cumplimiento_plan_pct), 'Cumplimiento del plan', k.plan_total ? `${k.plan_cumplido} de ${k.plan_total} entregas programadas` : 'sin entregas programadas', colorPct(k.cumplimiento_plan_pct))}
      ${kpi(pct(k.entregas_a_tiempo_pct), 'Entregas a tiempo', `${k.a_tiempo} a tiempo · ${k.tarde} con atraso`, colorPct(k.entregas_a_tiempo_pct))}
      ${kpi(pct(k.avance_pct), 'Avance general', `${k.completadas} de ${k.actividades} completadas`, M.acento)}
      ${kpi(String(atencion.length), 'Requieren atención', `${k.vencidas} vencida(s) · ${k.con_novedad} con novedad`, atencion.length ? '#b91c1c' : '#15803d')}
    </tr></table>
  </td></tr>
  ${acciones.length ? `<tr><td style="padding:18px 26px 0;font-family:${M.f}">
    ${titulo('Decisiones o apoyo requerido')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid ${M.acento};background:#eef0ff">
      ${acciones.map((x) => `<tr><td style="padding:8px 12px;font-size:13px;line-height:19px;color:${M.texto}">▸ ${mailEsc(x)}</td></tr>`).join('')}
    </table></td></tr>` : ''}
  ${atencion.length ? `<tr><td style="padding:18px 26px 0;font-family:${M.f}">
    ${titulo('Requiere atención')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid #dc2626;background:#fef2f2">
      ${atencion.map((a) => `<tr><td style="padding:8px 12px;font-size:13px;line-height:19px;color:${M.texto}">
        <b>${mailEsc(a.titulo)}</b> — <span style="color:#b91c1c">${mailEsc(a.estado_texto)}</span>
        ${a.novedad ? `<br><span style="color:${M.sutil}">${mailEsc(a.novedad.texto)}</span>` : ''}
        ${a.novedades_sub.map((x) => `<br><span style="color:${M.sutil}">${mailEsc(x.titulo)}: ${mailEsc(x.texto)}</span>`).join('')}
      </td></tr>`).join('')}
    </table></td></tr>` : ''}
  <tr><td style="padding:20px 26px 6px;font-family:${M.f}">
    ${titulo(`Detalle de actividades (${d.actividades.length})`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${M.borde}">
      <tr bgcolor="#f1f2f8" style="background:#f1f2f8">
        <th align="left" style="padding:8px;font-family:${M.f};font-size:11px;color:${M.sutil};text-transform:uppercase;letter-spacing:.05em">Actividad</th>
        <th style="padding:8px 6px;font-family:${M.f};font-size:11px;color:${M.sutil};text-transform:uppercase">Prio.</th>
        <th align="left" style="padding:8px 6px;font-family:${M.f};font-size:11px;color:${M.sutil};text-transform:uppercase">Estado</th>
        <th align="left" style="padding:8px 6px;font-family:${M.f};font-size:11px;color:${M.sutil};text-transform:uppercase">Avance</th>
        <th align="left" style="padding:8px;font-family:${M.f};font-size:11px;color:${M.sutil};text-transform:uppercase">Límite / fin</th>
      </tr>
      ${filas}
    </table>
    ${d.actividades.length > MAX ? `<div style="font-family:${M.f};font-size:12px;color:${M.sutil};margin-top:6px">… y ${d.actividades.length - MAX} actividad(es) más.</div>` : ''}
  </td></tr>
  <tr><td ${celda}><div style="padding:16px 26px 22px;font-family:${M.f};font-size:11px;line-height:16px;color:${M.sutil}">
    Atrasos medidos en días hábiles (sin sábados, domingos ni festivos de Colombia). Generado con Mi Foco el ${fechaCorta(d.generado, true)}.
  </div></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Texto plano equivalente (para clientes que no aceptan HTML al pegar). */
function correoTexto(d, { resumen = '', acciones = [] } = {}) {
  const k = d.kpis;
  return [`REPORTE DE CUMPLIMIENTO · ${textoPeriodo(d.desde, d.hasta)}`, '', resumen || resumenAutomatico(d), '',
    `Cumplimiento del plan: ${k.cumplimiento_plan_pct ?? '—'} % · Entregas a tiempo: ${k.entregas_a_tiempo_pct ?? '—'} % · Avance: ${k.avance_pct ?? 0} %`,
    ...(acciones.length ? ['', 'Decisiones o apoyo requerido:', ...acciones.map((x) => `• ${x}`)] : []),
    '', 'Actividades:', ...d.actividades.map((a) => `• [${a.prioridad}] ${a.titulo} — ${a.estado_texto} · ${a.progreso} %`)].join('\n');
}

const correoState = { resumen: '', acciones: [], asunto: '' };

function pintarCorreoHTML() {
  const d = rptState.datos;
  const caja = $('#rpt-correo');
  if (!d || !caja) return;
  const html = correoHTML(d, { autor: rptState.autor.trim(), resumen: correoState.resumen, acciones: correoState.acciones });
  rptState.correo = html;
  const asunto = correoState.asunto || asuntoAutomatico(d);
  const ya = !!$('#rpt-correo-vista');
  if (!ya) {
    caja.innerHTML = `<div class="rpt-correo">
      <h3>✉ Correo HTML <small class="sutil">se abre como correo nuevo en Outlook, listo para enviar</small></h3>
      <div class="correo-dest">
        <label>Para <input id="rpt-para" value="${esc(correoDest('para'))}" placeholder="correo@empresa.com; otro@empresa.com" autocomplete="email"></label>
        <label>CC <input id="rpt-cc" value="${esc(correoDest('cc'))}" placeholder="Opcional" autocomplete="email"></label>
      </div>
      <label>Asunto<div class="fila-copiar"><input id="rpt-asunto" value="${esc(asunto)}">
        <button type="button" class="mini" data-ia-copiar="#rpt-asunto" data-ia-msg="📋 Asunto copiado">📋</button></div></label>
      <iframe id="rpt-correo-vista" title="Vista previa del correo" class="correo-vista"></iframe>
      <div class="botones">
        <span class="ayuda" style="margin-right:auto">«Abrir en el correo» crea un correo nuevo en HTML en Outlook (con tu firma) para que lo revises y lo envíes. ${st.ia.activa ? '' : 'El resumen se arma con los indicadores.'}</span>
        ${st.ia.activa ? '<button type="button" class="ia-btn" data-rpt-correo-ia title="La IA escribe el asunto, el resumen ejecutivo y las decisiones requeridas">✨ Resumen ejecutivo</button>' : ''}
        <button type="button" class="secundario" data-rpt-correo-copiar title="Copiar con formato para pegar con Ctrl + V">📋 Copiar</button>
        <button type="button" class="primario" data-rpt-correo-abrir>✉ Abrir en el correo</button>
      </div>
    </div>`;
    caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    $('#rpt-asunto').value = asunto;
  }
  const vista = $('#rpt-correo-vista');
  vista.srcdoc = html;
  vista.onload = () => { try { vista.style.height = (vista.contentDocument.body.scrollHeight + 8) + 'px'; } catch { /* sin acceso */ } };
}

async function copiarCorreoHTML() {
  const html = rptState.correo;
  if (!html) return;
  const texto = correoTexto(rptState.datos, correoState);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([texto], { type: 'text/plain' }) })]);
    toast('📋 Correo copiado: pégalo en un correo nuevo con Ctrl + V', 'exito');
  } catch {
    // Respaldo: seleccionar el contenido de la vista previa y copiarlo como lo haría el usuario.
    try {
      const doc = $('#rpt-correo-vista').contentDocument;
      const rango = doc.createRange(); rango.selectNodeContents(doc.body);
      const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(rango);
      doc.execCommand('copy'); sel.removeAllRanges();
      toast('📋 Correo copiado: pégalo en un correo nuevo con Ctrl + V', 'exito');
    } catch { toast('El navegador no permitió copiar. Usa «Descargar .html».', 'error'); }
  }
}

/* Destinatarios recordados en este navegador */
function correoDest(campo) { try { return localStorage.getItem(`mifoco-correo-${campo}`) || ''; } catch { return ''; } }
function guardarDest(campo, valor) { try { localStorage.setItem(`mifoco-correo-${campo}`, valor); } catch { /* sin almacenamiento */ } }

async function abrirCorreoHTML(boton) {
  if (!rptState.correo) return;
  const para = $('#rpt-para').value.trim(), cc = $('#rpt-cc').value.trim();
  const antes = boton.innerHTML;
  boton.disabled = true; boton.innerHTML = '<span class="giro"></span> Abriendo…';
  try {
    const r = await api('/api/correo/abrir', { method: 'POST', body: {
      asunto: $('#rpt-asunto').value.trim(), html: rptState.correo, texto: correoTexto(rptState.datos, correoState), para, cc } });
    guardarDest('para', para); guardarDest('cc', cc);
    toast(r.metodo === 'outlook' ? '✉ Correo nuevo abierto en Outlook: revísalo y envíalo'
      : '✉ Borrador abierto en tu programa de correo: revísalo y envíalo', 'exito');
  } catch (err) { toast(err.message, 'error'); }
  finally { if (boton.isConnected) { boton.disabled = false; boton.innerHTML = antes; } }
}

function descargarCorreoHTML() {
  if (!rptState.correo) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rptState.correo], { type: 'text/html' }));
  a.download = nombreArchivoReporte().replace(/\.png$/, '.html');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function resumenEjecutivoIA(boton) {
  const r = await conIA(boton, () => api('/api/ia/correo-reporte', { method: 'POST', body: {
    desde: rptState.desde, hasta: rptState.hasta, categoria: rptState.categoria, sin_fecha: rptState.sinFecha,
    autor: rptState.autor.trim(), formato: 'html' } }));
  Object.assign(correoState, { resumen: r.resumen || '', acciones: r.acciones || [], asunto: r.asunto || '' });
  pintarCorreoHTML();
  toast('✨ Resumen ejecutivo listo: revísalo en la vista previa', 'exito');
}

/* ── ventana del reporte ── */
async function abrirReporte() {
  if (!rptState.desde) { const [a, b] = rangoRapido(rptState.periodo); rptState.desde = isoLocal(a); rptState.hasta = isoLocal(b); }
  try { await cargarCatalogos(); } catch { /* sigue con lo que haya */ }
  const opciones = [['semana', 'Esta semana'], ['semana_pasada', 'Semana pasada'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado']];
  abrirModal(`<h2>📤 Reporte de cumplimiento</h2>
    <form id="f-reporte" class="reporte-opciones">
      <div class="rpt-rapidos">${opciones.map(([v, t]) => `<button type="button" class="mini ${rptState.periodo === v ? 'ok' : ''}" data-rpt-rango="${v}">${t}</button>`).join('')}</div>
      <div class="rpt-campos">
        <label>Desde<input type="date" name="desde" value="${rptState.desde}" required></label>
        <label>Hasta<input type="date" name="hasta" value="${rptState.hasta}" required></label>
        <label>Categoría<select name="categoria"><option value="">Todas</option>${categorias().map((cat) => `<option ${rptState.categoria === cat ? 'selected' : ''}>${esc(cat)}</option>`).join('')}</select></label>
        <label>Preparado por<input name="autor" value="${esc(rptState.autor)}" placeholder="Tu nombre (opcional)" maxlength="60"></label>
      </div>
      <label class="check"><input type="checkbox" name="sin_fecha" ${rptState.sinFecha ? 'checked' : ''}> Incluir pendientes sin fecha límite</label>
    </form>
    <div class="rpt-vista" id="rpt-vista"><div class="vacio">Generando…</div></div>
    <div id="rpt-correo"></div>
    <div class="botones">
      <span class="ayuda" style="margin-right:auto">Copia la imagen y pégala en el cuerpo del correo con <b>Ctrl + V</b>.</span>
      <button type="button" class="secundario" data-rpt-correo title="Correo con indicadores, alertas y tabla de actividades, listo para pegar">✉ Correo HTML</button>
      <button type="button" class="secundario" data-rpt-descargar>⬇ Descargar PNG</button>
      <button type="button" class="primario" data-rpt-copiar>📋 Copiar imagen</button>
    </div>`);
  $('#modal-caja').classList.add('modal-ancho');
  await generarReporte();
}

async function generarReporte() {
  const vista = $('#rpt-vista');
  if (!vista) return;
  const p = new URLSearchParams({ desde: rptState.desde, hasta: rptState.hasta, sin_fecha: rptState.sinFecha ? '1' : '0' });
  if (rptState.categoria) p.set('categoria', rptState.categoria);
  try {
    rptState.datos = await api(`/api/reporte?${p}`);
    rptState.lienzo = dibujarReporte(rptState.datos, { autor: rptState.autor.trim() });
    vista.innerHTML = '';
    const img = new Image();
    img.src = rptState.lienzo.toDataURL('image/png');
    img.alt = 'Vista previa del reporte';
    vista.appendChild(img);
    if ($('#rpt-correo-vista')) { Object.assign(correoState, { resumen: '', acciones: [], asunto: '' }); pintarCorreoHTML(); }
  } catch (err) {
    vista.innerHTML = `<div class="vacio">${esc(err.message)}</div>`;
  }
}

const nombreArchivoReporte = () => `reporte-cumplimiento_${rptState.desde}_a_${rptState.hasta}${rptState.categoria ? '_' + rptState.categoria.replace(/\W+/g, '-') : ''}.png`;

async function copiarReporte() {
  if (!rptState.lienzo) return;
  try {
    const blob = await new Promise((ok) => rptState.lienzo.toBlob(ok, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('📋 Imagen copiada. Pégala en el correo con Ctrl + V', 'exito');
  } catch {
    toast('El navegador no permitió copiar la imagen. Usa «Descargar PNG» y adjúntala.', 'error');
  }
}

function descargarReporte() {
  if (!rptState.lienzo) return;
  const a = document.createElement('a');
  a.href = rptState.lienzo.toDataURL('image/png');
  a.download = nombreArchivoReporte();
  document.body.appendChild(a); a.click(); a.remove();
}

let rptTemporizador;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rpt-rango], [data-rpt-copiar], [data-rpt-descargar], [data-rpt-correo], [data-rpt-correo-copiar], [data-rpt-correo-descargar], [data-rpt-correo-ia], [data-rpt-correo-abrir]');
  if (!b) return;
  if (b.dataset.rptCorreo !== undefined) { Object.assign(correoState, { resumen: '', acciones: [], asunto: '' }); pintarCorreoHTML(); return; }
  if (b.dataset.rptCorreoCopiar !== undefined) { copiarCorreoHTML(); return; }
  if (b.dataset.rptCorreoAbrir !== undefined) { abrirCorreoHTML(b); return; }
  if (b.dataset.rptCorreoDescargar !== undefined) { descargarCorreoHTML(); return; }
  if (b.dataset.rptCorreoIa !== undefined) { resumenEjecutivoIA(b).catch((err) => toast(err.message, 'error')); return; }
  if (b.dataset.rptRango) {
    rptState.periodo = b.dataset.rptRango;
    const [a, z] = rangoRapido(rptState.periodo);
    rptState.desde = isoLocal(a); rptState.hasta = isoLocal(z);
    const f = $('#f-reporte'); f.desde.value = rptState.desde; f.hasta.value = rptState.hasta;
    $$('[data-rpt-rango]').forEach((x) => x.classList.toggle('ok', x === b));
    generarReporte();
  } else if (b.dataset.rptCopiar !== undefined) copiarReporte();
  else if (b.dataset.rptDescargar !== undefined) descargarReporte();
});
document.addEventListener('input', (e) => {
  const f = e.target.form;
  if (!f || f.id !== 'f-reporte') return;
  rptState.desde = f.desde.value; rptState.hasta = f.hasta.value;
  rptState.categoria = f.categoria.value; rptState.autor = f.autor.value; rptState.sinFecha = f.sin_fecha.checked;
  if (['desde', 'hasta'].includes(e.target.name)) { rptState.periodo = ''; $$('[data-rpt-rango]').forEach((x) => x.classList.remove('ok')); }
  try { localStorage.setItem('mifoco-reporte-autor', rptState.autor); } catch { /* sin almacenamiento */ }
  clearTimeout(rptTemporizador);
  rptTemporizador = setTimeout(generarReporte, 350);
});

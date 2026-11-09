"""Mi Foco — gestor local de tareas, tiempo y metas de aprendizaje.

Ejecutar:  python app.py            (abre el navegador en http://127.0.0.1:5050)
           python app.py --sin-navegador --puerto 8080
"""
import argparse
import base64
import binascii
import csv
import io
import os
import mimetypes
import re
import sqlite3
import uuid
import threading
import webbrowser
from datetime import date, datetime, timedelta

from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory
from werkzeug.exceptions import HTTPException

import db
import festivos as festivos_co
from frases import frase_aleatoria, frase_del_dia

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.json.ensure_ascii = False
MAX_ADJUNTO_MB = 50
app.config["MAX_CONTENT_LENGTH"] = MAX_ADJUNTO_MB * 1024 * 1024

ABIERTOS = ("pendiente", "en_progreso", "pausada")
PRIORIDADES = "ABCDE"


# ───────────────────────── utilidades ─────────────────────────
def parse_dt(valor):
    if not valor:
        return None
    try:
        return datetime.fromisoformat(str(valor))
    except ValueError:
        return None


def limite_dt(valor):
    """Fecha límite como datetime. Si solo trae fecha, se toma el final del día."""
    d = parse_dt(valor)
    if d is not None and len(str(valor)) == 10:
        d = d.replace(hour=23, minute=59, second=59)
    return d


def fmt_dur_dias(dias):
    if dias < 1:
        return f"{max(1, round(dias * 24))} h"
    v = round(dias, 1)
    return f"{v:g}".replace(".", ",") + (" día" if v == 1 else " días")


def cap(texto):
    """Mayúscula inicial sin tocar el resto (str.capitalize pondría en minúscula los títulos citados)."""
    return texto[:1].upper() + texto[1:] if texto else texto


def body():
    return request.get_json(silent=True) or {}


@app.errorhandler(ValueError)
def _err_valor(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(sqlite3.IntegrityError)
def _err_integridad(e):
    return jsonify(error=f"Dato inválido: {e}"), 400


@app.errorhandler(413)
def _err_muy_grande(e):
    return jsonify(error=f"El archivo supera el máximo de {MAX_ADJUNTO_MB} MB."), 413


@app.errorhandler(HTTPException)
def _err_http(e):
    if request.path.startswith("/api/"):
        return jsonify(error=e.description or e.name), e.code
    return e


# ───────────────────────── tareas: helpers ─────────────────────────
def registrar_evento(conn, tarea_id, tipo, antes=None, despues=None, detalle=None, momento=None):
    conn.execute(
        "INSERT INTO eventos (tarea_id, tipo, estado_anterior, estado_nuevo, detalle, momento) "
        "VALUES (?,?,?,?,?,?)",
        (tarea_id, tipo, antes, despues, detalle, momento or db.ahora()),
    )


def fecha_completado(valor):
    """Valida la fecha de completado que indica el usuario: no puede ser futura. Devuelve ISO con segundos."""
    d = parse_dt((valor or "").strip())
    if d is None:
        raise ValueError("Indica una fecha y hora de completado válida.")
    if d > datetime.now() + timedelta(minutes=1):
        raise ValueError("La fecha de completado no puede estar en el futuro.")
    return d.replace(microsecond=0).isoformat(timespec="seconds")


def detalle_entrega(fecha_limite, completada_en):
    lim, fin = limite_dt(fecha_limite), parse_dt(completada_en)
    if not lim:
        return "Sin fecha límite"
    if fin <= lim:
        return "A tiempo"
    return f"Con {fmt_dur_dias((fin - lim).total_seconds() / 86400)} de atraso"


def guardar_en_catalogos(conn, categoria=None, descripcion=None):
    """Registra (o suma un uso a) la categoría y la descripción para reutilizarlas después."""
    ahora = db.ahora()
    categoria = (categoria or "").strip()
    if categoria:
        conn.execute("INSERT INTO categorias (nombre, usos, creada_en, usada_en) VALUES (?,1,?,?) "
                     "ON CONFLICT(nombre) DO UPDATE SET usos = usos + 1, usada_en = excluded.usada_en",
                     (categoria, ahora, ahora))
    descripcion = (descripcion or "").strip()
    if descripcion:
        conn.execute("INSERT INTO descripciones (texto, usos, creada_en, usada_en) VALUES (?,1,?,?) "
                     "ON CONFLICT(texto) DO UPDATE SET usos = usos + 1, usada_en = excluded.usada_en",
                     (descripcion, ahora, ahora))


def nombre_categoria(conn, nombre):
    """Devuelve la categoría con la escritura ya guardada (evita 'trabajo' vs 'Trabajo')."""
    r = conn.execute("SELECT nombre FROM categorias WHERE nombre = ? COLLATE NOCASE", (nombre,)).fetchone()
    return r["nombre"] if r else nombre


def tiempos_por_tarea(conn):
    """Minutos totales trabajados por tarea y minutos de la sesión abierta (si hay)."""
    ahora = datetime.now()
    totales, abiertas = {}, {}
    for s in conn.execute("SELECT tarea_id, inicio, fin, minutos FROM sesiones"):
        if s["fin"]:
            m = s["minutos"] or 0
        else:
            m = max(0.0, (ahora - parse_dt(s["inicio"])).total_seconds() / 60)
            abiertas[s["tarea_id"]] = m
        totales[s["tarea_id"]] = totales.get(s["tarea_id"], 0) + m
    return totales, abiertas


def subtareas_por_tarea(conn, tid=None):
    q = "SELECT * FROM subtareas" + (" WHERE tarea_id=?" if tid else "") + " ORDER BY orden, id"
    res = {}
    for s in conn.execute(q, (tid,) if tid else ()):
        d = dict(s)
        d["completada"] = bool(d["completada"])
        d["es_entregable"] = bool(d.get("es_entregable"))
        res.setdefault(d["tarea_id"], []).append(d)
    return res


# ───────────────────────── dependencias ─────────────────────────
SQL_DEPENDENCIAS = """
SELECT d.id, d.tarea_id, d.depende_tarea_id, d.depende_subtarea_id,
       td.titulo AS dep_titulo, td.estado AS dep_estado, td.eliminada AS dep_eliminada,
       t.titulo  AS t_titulo,  t.estado  AS t_estado,  t.eliminada  AS t_eliminada,
       s.titulo  AS s_titulo,  s.completada AS s_completada, s.tarea_id AS s_padre,
       tp.titulo AS p_titulo,  tp.estado AS p_estado, tp.eliminada AS p_eliminada
FROM dependencias d
JOIN tareas td ON td.id = d.tarea_id
LEFT JOIN tareas t ON t.id = d.depende_tarea_id
LEFT JOIN subtareas s ON s.id = d.depende_subtarea_id
LEFT JOIN tareas tp ON tp.id = s.tarea_id
"""
CERRADOS = ("completada", "cancelada")


def info_dependencias(conn):
    """Devuelve ({tarea: [requisitos]}, {tarea requisito: [tareas abiertas que frena]})."""
    requisitos, frena = {}, {}
    for r in conn.execute(SQL_DEPENDENCIAS):
        if r["dep_eliminada"]:
            continue
        if r["depende_tarea_id"]:
            completa = bool(r["t_eliminada"]) or r["t_estado"] in CERRADOS
            item = {"id": r["id"], "tipo": "tarea", "ref_id": r["depende_tarea_id"], "tarea_id": r["depende_tarea_id"],
                    "titulo": r["t_titulo"], "tarea_titulo": r["t_titulo"],
                    "estado": "eliminada" if r["t_eliminada"] else r["t_estado"]}
        else:
            padre_cerrado = bool(r["p_eliminada"]) or r["p_estado"] in CERRADOS
            completa = bool(r["s_completada"]) or padre_cerrado
            item = {"id": r["id"], "tipo": "subtarea", "ref_id": r["depende_subtarea_id"], "tarea_id": r["s_padre"],
                    "titulo": r["s_titulo"], "tarea_titulo": r["p_titulo"],
                    "estado": "completada" if r["s_completada"] else ("eliminada" if r["p_eliminada"] else r["p_estado"])}
        item["completa"] = completa
        requisitos.setdefault(r["tarea_id"], []).append(item)
        if not completa and r["dep_estado"] in ABIERTOS:
            lista = frena.setdefault(item["tarea_id"], [])
            if not any(x["id"] == r["tarea_id"] for x in lista):
                lista.append({"id": r["tarea_id"], "titulo": r["dep_titulo"]})
    return requisitos, frena


def ids_bloqueadas(conn):
    requisitos, _ = info_dependencias(conn)
    abiertas = {r["id"] for r in conn.execute(
        "SELECT id FROM tareas WHERE eliminada=0 AND estado IN ('pendiente','en_progreso','pausada')")}
    return {tid for tid, reqs in requisitos.items() if tid in abiertas and any(not x["completa"] for x in reqs)}


def registrar_cambios_bloqueo(conn, antes, motivo):
    """Compara el conjunto de tareas bloqueadas antes/después de un cambio y lo deja en la bitácora."""
    despues = ids_bloqueadas(conn)
    desbloqueadas = []
    for tid in sorted(antes - despues):
        r = conn.execute("SELECT titulo, estado FROM tareas WHERE id=? AND eliminada=0", (tid,)).fetchone()
        if r and r["estado"] in ABIERTOS:
            registrar_evento(conn, tid, "desbloqueada", r["estado"], r["estado"], f"Ya puede empezar: {motivo}")
            desbloqueadas.append({"id": tid, "titulo": r["titulo"]})
    for tid in sorted(despues - antes):
        r = conn.execute("SELECT estado FROM tareas WHERE id=?", (tid,)).fetchone()
        registrar_evento(conn, tid, "bloqueada", r["estado"], r["estado"], f"Vuelve a esperar: {motivo}")
    return desbloqueadas


def tarea_de_requisito(conn, tipo, ref_id):
    """Valida el requisito y devuelve (id de la tarea a la que pertenece, texto para mostrar)."""
    if tipo == "tarea":
        r = conn.execute("SELECT id, titulo FROM tareas WHERE id=? AND eliminada=0", (ref_id,)).fetchone()
        if not r:
            raise ValueError("La tarea de la que quieres depender no existe.")
        return r["id"], f"«{r['titulo']}»"
    r = conn.execute("SELECT s.titulo, s.tarea_id, t.titulo AS padre FROM subtareas s JOIN tareas t ON t.id=s.tarea_id "
                     "WHERE s.id=? AND t.eliminada=0", (ref_id,)).fetchone()
    if not r:
        raise ValueError("La subtarea de la que quieres depender no existe.")
    return r["tarea_id"], f"«{r['titulo']}» (de «{r['padre']}»)"


def crearia_ciclo(conn, tid, requisito_tid):
    """True si `requisito_tid` ya depende (directa o indirectamente) de `tid`."""
    aristas = {}
    for r in conn.execute("SELECT d.tarea_id, COALESCE(d.depende_tarea_id, s.tarea_id) AS req FROM dependencias d "
                          "LEFT JOIN subtareas s ON s.id = d.depende_subtarea_id"):
        aristas.setdefault(r["tarea_id"], set()).add(r["req"])
    pila, vistos = [requisito_tid], set()
    while pila:
        actual = pila.pop()
        if actual == tid:
            return True
        if actual in vistos:
            continue
        vistos.add(actual)
        pila.extend(aristas.get(actual, ()))
    return False


def limpiar_dependencias(valor):
    if valor is None:
        return None
    if not isinstance(valor, list):
        raise ValueError("Las dependencias deben enviarse como lista.")
    out = []
    for item in valor:
        tipo = (item or {}).get("tipo")
        if tipo not in ("tarea", "subtarea"):
            raise ValueError("Tipo de dependencia inválido.")
        clave = (tipo, int(item.get("id")))
        if clave not in out:
            out.append(clave)
    return out


def sincronizar_dependencias(conn, tid, lista):
    actuales = {}
    for r in conn.execute("SELECT * FROM dependencias WHERE tarea_id=?", (tid,)):
        clave = ("tarea", r["depende_tarea_id"]) if r["depende_tarea_id"] else ("subtarea", r["depende_subtarea_id"])
        actuales[clave] = r
    agregadas, quitadas = [], []
    for clave in lista:
        if clave in actuales:
            continue
        tipo, ref = clave
        req_tid, texto = tarea_de_requisito(conn, tipo, ref)
        if req_tid == tid:
            raise ValueError("Una tarea no puede depender de sí misma ni de sus propias subtareas.")
        if crearia_ciclo(conn, tid, req_tid):
            raise ValueError(f"No se puede: {texto} ya depende de esta tarea (se formaría un ciclo).")
        conn.execute("INSERT INTO dependencias (tarea_id, depende_tarea_id, depende_subtarea_id, creada_en) VALUES (?,?,?,?)",
                     (tid, ref if tipo == "tarea" else None, ref if tipo == "subtarea" else None, db.ahora()))
        agregadas.append(texto)
    for clave, r in actuales.items():
        if clave not in lista:
            try:
                quitadas.append(tarea_de_requisito(conn, *clave)[1])
            except ValueError:
                quitadas.append("(elemento eliminado)")
            conn.execute("DELETE FROM dependencias WHERE id=?", (r["id"],))
    return agregadas, quitadas


def conteo_comentarios(conn, tid=None):
    q = "SELECT tarea_id, COUNT(*) AS n, MAX(creado_en) AS ultimo FROM comentarios"
    q += " WHERE tarea_id=? GROUP BY tarea_id" if tid else " GROUP BY tarea_id"
    return {r["tarea_id"]: (r["n"], r["ultimo"]) for r in conn.execute(q, (tid,) if tid else ())}


def conteo_adjuntos(conn, tid=None):
    q = "SELECT tarea_id, COUNT(*) AS n FROM adjuntos" + (" WHERE tarea_id=?" if tid else "") + " GROUP BY tarea_id"
    return {r["tarea_id"]: r["n"] for r in conn.execute(q, (tid,) if tid else ())}


def serializar(row, totales, abiertas, subs=None, deps=None, coment=None, adj=None):
    t = dict(row)
    t["comentarios_total"], t["ultimo_comentario"] = (coment or {}).get(t["id"], (0, None))
    t["adjuntos_total"] = (adj or {}).get(t["id"], 0)
    ahora = datetime.now()
    requisitos, frena = deps or ({}, {})
    t["dependencias"] = requisitos.get(t["id"], [])
    t["bloqueada"] = t["estado"] in ABIERTOS and any(not x["completa"] for x in t["dependencias"])
    t["frena_a"] = frena.get(t["id"], []) if t["estado"] in ABIERTOS else []
    lista = (subs or {}).get(t["id"], [])
    hechas = sum(1 for s in lista if s["completada"])
    t["subtareas"] = lista
    ent = next((x for x in lista if x["es_entregable"]), None)
    t["entregable"] = ent["titulo"] if ent else None
    t["entregable_listo"] = bool(ent and ent["completada"]) if ent else None
    t["subtareas_total"] = len(lista)
    t["subtareas_hechas"] = hechas
    if t["estado"] == "completada":
        t["progreso_pct"] = 100
    elif lista:
        t["progreso_pct"] = round(100 * hechas / len(lista))
    else:
        t["progreso_pct"] = None
    t["es_rana"] = bool(t["es_rana"])
    t["tiempo_real_min"] = round(totales.get(t["id"], 0), 1)
    t["sesion_abierta"] = t["id"] in abiertas
    t["minutos_sesion_actual"] = round(abiertas.get(t["id"], 0), 1)
    lim = limite_dt(t["fecha_limite"])
    fin = parse_dt(t["completada_en"])
    t["dias_atraso"], t["vencida"], t["horas_restantes"] = 0, False, None
    if lim and t["estado"] != "cancelada":
        ref = fin if t["estado"] == "completada" and fin else ahora
        if ref > lim:
            t["dias_atraso"] = round((ref - lim).total_seconds() / 86400, 2)
            t["vencida"] = t["estado"] in ABIERTOS
        if t["estado"] in ABIERTOS:
            t["horas_restantes"] = round((lim - ahora).total_seconds() / 3600, 1)
    creada = parse_dt(t["creada_en"])
    t["ciclo_horas"] = round((fin - creada).total_seconds() / 3600, 2) if (creada and fin) else None
    t["completada_a_tiempo"] = (fin <= lim) if (fin and lim and t["estado"] == "completada") else None
    for k in ("alerta_vencida", "eliminada", "eliminada_en"):
        t.pop(k, None)
    return t


SQL_TAREAS = (
    "SELECT t.*, m.herramienta AS meta_nombre FROM tareas t "
    "LEFT JOIN metas m ON m.id = t.meta_id WHERE t.eliminada = 0"
)


def listar_tareas(conn, incluir_cerradas=False):
    q = SQL_TAREAS
    if not incluir_cerradas:
        q += " AND t.estado IN ('pendiente','en_progreso','pausada')"
    totales, abiertas = tiempos_por_tarea(conn)
    subs = subtareas_por_tarea(conn)
    deps = info_dependencias(conn)
    coment, adj = conteo_comentarios(conn), conteo_adjuntos(conn)
    return [serializar(r, totales, abiertas, subs, deps, coment, adj) for r in conn.execute(q + " ORDER BY t.id DESC")]


def fila_tarea(conn, tid):
    r = conn.execute("SELECT * FROM tareas WHERE id=? AND eliminada=0", (tid,)).fetchone()
    if not r:
        abort(404, "Tarea no encontrada.")
    return r


def obtener_tarea(conn, tid):
    r = conn.execute(SQL_TAREAS + " AND t.id=?", (tid,)).fetchone()
    if not r:
        abort(404, "Tarea no encontrada.")
    totales, abiertas = tiempos_por_tarea(conn)
    return serializar(r, totales, abiertas, subtareas_por_tarea(conn, tid), info_dependencias(conn),
                      conteo_comentarios(conn, tid), conteo_adjuntos(conn, tid))


def limpiar_subtareas(valor):
    """Acepta ["texto", ...] o [{"id": 3, "titulo": "texto"}, ...]. Ignora vacías."""
    if valor is None:
        return None
    if not isinstance(valor, list):
        raise ValueError("Las subtareas deben enviarse como lista.")
    out = []
    for item in valor:
        if isinstance(item, str):
            item = {"titulo": item}
        titulo = (item.get("titulo") or "").strip()[:200]
        if titulo:
            sid = item.get("id")
            out.append({"id": int(sid) if sid not in (None, "") else None, "titulo": titulo})
    return out


def sincronizar_subtareas(conn, tid, lista):
    """Deja la tarea con exactamente esas subtareas (en ese orden), conservando su estado.
    No toca la subtarea de entregable: esa se maneja con `definir_entregable` y siempre va de última."""
    ahora = db.ahora()
    actuales = {s["id"]: s for s in conn.execute("SELECT * FROM subtareas WHERE tarea_id=? AND es_entregable=0", (tid,))}
    vistos, nuevas, quitadas = set(), [], []
    for orden, s in enumerate(lista, start=1):
        if s["id"] in actuales:
            vistos.add(s["id"])
            conn.execute("UPDATE subtareas SET titulo=?, orden=? WHERE id=?", (s["titulo"], orden, s["id"]))
        else:
            conn.execute("INSERT INTO subtareas (tarea_id, titulo, orden, creada_en) VALUES (?,?,?,?)",
                         (tid, s["titulo"], orden, ahora))
            nuevas.append(s["titulo"])
    for sid, s in actuales.items():
        if sid not in vistos:
            conn.execute("DELETE FROM subtareas WHERE id=?", (sid,))
            quitadas.append(s["titulo"])
    conn.execute("UPDATE subtareas SET orden=? WHERE tarea_id=? AND es_entregable=1", (len(lista) + 1, tid))
    return nuevas, quitadas


def definir_entregable(conn, tid, texto):
    """Crea, renombra o quita la subtarea de entregable. Devuelve el texto para la bitácora (o None)."""
    texto = (texto or "").strip()[:200]
    actual = conn.execute("SELECT * FROM subtareas WHERE tarea_id=? AND es_entregable=1", (tid,)).fetchone()
    if not texto:
        if actual:
            conn.execute("DELETE FROM subtareas WHERE id=?", (actual["id"],))
            return f"Quitó el entregable «{actual['titulo']}»"
        return None
    if actual:
        if actual["titulo"] == texto:
            return None
        conn.execute("UPDATE subtareas SET titulo=? WHERE id=?", (texto, actual["id"]))
        return f"Entregable: «{actual['titulo']}» → «{texto}»"
    orden = conn.execute("SELECT COALESCE(MAX(orden),0)+1 FROM subtareas WHERE tarea_id=?", (tid,)).fetchone()[0]
    conn.execute("INSERT INTO subtareas (tarea_id, titulo, orden, creada_en, es_entregable) VALUES (?,?,?,?,1)",
                 (tid, texto, orden, db.ahora()))
    return f"Entregable: «{texto}»"


def avance_texto(conn, tid):
    total, hechas = conn.execute("SELECT COUNT(*), COALESCE(SUM(completada),0) FROM subtareas WHERE tarea_id=?",
                                 (tid,)).fetchone()
    return f"{hechas}/{total} · {round(100 * hechas / total) if total else 0}%"


def marcar_vencidas(conn):
    """Deja en la bitácora el momento en que cada tarea abierta superó su fecha límite."""
    ahora = datetime.now()
    filas = conn.execute(
        "SELECT id, estado, fecha_limite FROM tareas WHERE eliminada=0 AND alerta_vencida=0 "
        "AND fecha_limite IS NOT NULL AND estado IN ('pendiente','en_progreso','pausada')"
    ).fetchall()
    for r in filas:
        lim = limite_dt(r["fecha_limite"])
        if lim and lim < ahora:
            # Actualización condicional: si otra petición simultánea ya la marcó, no se duplica el evento.
            cur = conn.execute("UPDATE tareas SET alerta_vencida=1 WHERE id=? AND alerta_vencida=0", (r["id"],))
            if cur.rowcount == 1:
                registrar_evento(conn, r["id"], "vencida", r["estado"], r["estado"],
                                 f"Superó su fecha límite ({r['fecha_limite'].replace('T', ' ')})")


def cerrar_sesion(conn, tid, momento):
    total = 0.0
    fin = parse_dt(momento)
    for s in conn.execute("SELECT id, inicio FROM sesiones WHERE tarea_id=? AND fin IS NULL", (tid,)).fetchall():
        m = max(0.0, (fin - parse_dt(s["inicio"])).total_seconds() / 60)
        conn.execute("UPDATE sesiones SET fin=?, minutos=? WHERE id=?", (momento, round(m, 2), s["id"]))
        total += m
    return total


def limpiar_tarea(d, parcial=False):
    out = {}
    if "titulo" in d or not parcial:
        titulo = (d.get("titulo") or "").strip()
        if not titulo:
            raise ValueError("El título es obligatorio.")
        out["titulo"] = titulo[:200]
    if "descripcion" in d:
        out["descripcion"] = (d.get("descripcion") or "").strip()
    if "prioridad" in d or not parcial:
        p = (d.get("prioridad") or "B").strip().upper()
        if p not in PRIORIDADES:
            raise ValueError("Prioridad inválida: usa A, B, C, D o E.")
        out["prioridad"] = p
    if "categoria" in d or not parcial:
        out["categoria"] = (d.get("categoria") or "").strip() or "General"
    if "es_rana" in d:
        out["es_rana"] = 1 if d.get("es_rana") in (True, 1, "1", "true", "on") else 0
    if "estimado_min" in d:
        v = d.get("estimado_min")
        if v in (None, ""):
            out["estimado_min"] = None
        else:
            v = int(float(v))
            if v < 0:
                raise ValueError("El tiempo estimado no puede ser negativo.")
            out["estimado_min"] = v
    if "fecha_limite" in d:
        v = (d.get("fecha_limite") or "").strip()
        if v and parse_dt(v) is None:
            raise ValueError("Fecha límite inválida.")
        out["fecha_limite"] = v or None
    if "meta_id" in d:
        v = d.get("meta_id")
        out["meta_id"] = int(v) if v not in (None, "") else None
    return out


# ───────────────────────── tareas: API ─────────────────────────
@app.get("/api/tareas")
def api_listar_tareas():
    incluir = request.args.get("incluir_cerradas") in ("1", "true")
    with db.conexion() as conn:
        marcar_vencidas(conn)
        return jsonify(listar_tareas(conn, incluir))


@app.post("/api/tareas")
def api_crear_tarea():
    d = body()
    campos = limpiar_tarea(d)
    subtareas = limpiar_subtareas(d.get("subtareas")) or []
    dependencias = limpiar_dependencias(d.get("dependencias")) or []
    campos.setdefault("es_rana", 0)
    ahora = db.ahora()
    ya_completada = d.get("ya_completada") in (True, 1, "1", "true", "on")
    fin = fecha_completado(d.get("completada_en") or ahora) if ya_completada else None
    minutos = float(d.get("minutos_dedicados") or 0) if ya_completada else 0
    if minutos < 0:
        raise ValueError("El tiempo dedicado no puede ser negativo.")
    campos.update(estado="pendiente", creada_en=ahora, actualizada_en=ahora)
    if ya_completada:
        # Registro retroactivo: la tarea "nace" cuando se terminó, para que periodos y ciclos cuadren.
        inicio = (parse_dt(fin) - timedelta(minutes=minutos)).isoformat(timespec="seconds") if minutos else fin
        campos.update(estado="completada", creada_en=inicio, iniciada_en=inicio, completada_en=fin)
    with db.conexion() as conn:
        campos["categoria"] = nombre_categoria(conn, campos["categoria"])
        guardar_en_catalogos(conn, campos["categoria"], campos.get("descripcion"))
        cols = ", ".join(campos)
        cur = conn.execute(f"INSERT INTO tareas ({cols}) VALUES ({', '.join('?' * len(campos))})",
                           tuple(campos.values()))
        tid = cur.lastrowid
        detalle = f"Prioridad {campos['prioridad']}"
        if campos.get("fecha_limite"):
            detalle += f" · fecha límite {campos['fecha_limite'].replace('T', ' ')}"
        if subtareas:
            sincronizar_subtareas(conn, tid, subtareas)
            detalle += f" · {len(subtareas)} subtarea(s)"
        if (d.get("entregable") or "").strip():
            definir_entregable(conn, tid, d["entregable"])
            detalle += f" · entregable: «{d['entregable'].strip()[:200]}»"
        if ya_completada:
            registrar_evento(conn, tid, "creada", None, "completada",
                             f"Registrada como ya completada · {detalle}", momento=campos["creada_en"])
            conn.execute("UPDATE subtareas SET completada=1, completada_en=? WHERE tarea_id=?", (fin, tid))
            if minutos:
                conn.execute("INSERT INTO sesiones (tarea_id, inicio, fin, minutos, manual) VALUES (?,?,?,?,1)",
                             (tid, campos["creada_en"], fin, minutos))
            extra = f" · {minutos:.0f} min dedicados" if minutos else ""
            registrar_evento(conn, tid, "completada", None, "completada",
                             detalle_entrega(campos.get("fecha_limite"), fin) + extra + f" · registrada el {ahora.replace('T', ' ')}",
                             momento=fin)
        else:
            registrar_evento(conn, tid, "creada", None, "pendiente", detalle)
        if dependencias:
            agregadas, _ = sincronizar_dependencias(conn, tid, dependencias)
            registrar_evento(conn, tid, "dependencias", None, None, "Depende de " + ", ".join(agregadas))
        return jsonify(obtener_tarea(conn, tid)), 201


@app.get("/api/tareas/<int:tid>")
def api_detalle_tarea(tid):
    with db.conexion() as conn:
        t = obtener_tarea(conn, tid)
        t["eventos"] = [dict(e) for e in conn.execute(
            "SELECT * FROM eventos WHERE tarea_id=? ORDER BY momento, id", (tid,))]
        t["sesiones"] = [dict(s) for s in conn.execute(
            "SELECT * FROM sesiones WHERE tarea_id=? ORDER BY inicio", (tid,))]
        t["comentarios"] = [dict(c) for c in conn.execute(
            "SELECT * FROM comentarios WHERE tarea_id=? ORDER BY creado_en, id", (tid,))]
        t["adjuntos"] = [adjunto_dict(a) for a in conn.execute(
            "SELECT * FROM adjuntos WHERE tarea_id=? ORDER BY creado_en, id", (tid,))]
        return jsonify(t)


@app.put("/api/tareas/<int:tid>")
def api_editar_tarea(tid):
    d = body()
    campos = limpiar_tarea(d, parcial=True)
    subtareas = limpiar_subtareas(d.get("subtareas"))
    dependencias = limpiar_dependencias(d.get("dependencias"))
    with db.conexion() as conn:
        actual = fila_tarea(conn, tid)
        antes = ids_bloqueadas(conn)
        if d.get("completada_en") and actual["estado"] == "completada":
            nueva = fecha_completado(d["completada_en"])
            if nueva[:16] != (actual["completada_en"] or "")[:16]:
                conn.execute("UPDATE tareas SET completada_en=?, creada_en=MIN(creada_en, ?), "
                             "iniciada_en=CASE WHEN iniciada_en > ? THEN ? ELSE iniciada_en END, actualizada_en=? WHERE id=?",
                             (nueva, nueva, nueva, nueva, db.ahora(), tid))
                registrar_evento(conn, tid, "editada", None, None,
                                 f"Fecha de completado: {(actual['completada_en'] or '—').replace('T', ' ')[:16]} → "
                                 f"{nueva.replace('T', ' ')[:16]} · {detalle_entrega(actual['fecha_limite'], nueva)}")
        if dependencias is not None:
            agregadas, quitadas = sincronizar_dependencias(conn, tid, dependencias)
            partes = []
            if agregadas:
                partes.append("ahora depende de " + ", ".join(agregadas))
            if quitadas:
                partes.append("ya no depende de " + ", ".join(quitadas))
            if partes:
                registrar_evento(conn, tid, "dependencias", None, None, cap("; ".join(partes)))
        if "entregable" in d:
            cambio = definir_entregable(conn, tid, d.get("entregable"))
            if cambio:
                registrar_evento(conn, tid, "subtareas", None, None, f"{cambio} · avance {avance_texto(conn, tid)}")
        if subtareas is not None:
            nuevas, quitadas = sincronizar_subtareas(conn, tid, subtareas)
            if nuevas or quitadas:
                partes = []
                if nuevas:
                    partes.append("agregó " + ", ".join(f"«{x}»" for x in nuevas))
                if quitadas:
                    partes.append("quitó " + ", ".join(f"«{x}»" for x in quitadas))
                registrar_evento(conn, tid, "subtareas", None, None,
                                 f"Subtareas: {'; '.join(partes)} · avance {avance_texto(conn, tid)}")
                conn.execute("UPDATE tareas SET actualizada_en=? WHERE id=?", (db.ahora(), tid))
        if "categoria" in campos:
            campos["categoria"] = nombre_categoria(conn, campos["categoria"])
        cambios = {k: v for k, v in campos.items() if actual[k] != v}
        if cambios:
            guardar_en_catalogos(conn, cambios.get("categoria"), cambios.get("descripcion"))
            sets = ", ".join(f"{k}=?" for k in cambios)
            extra = ", alerta_vencida=0" if "fecha_limite" in cambios else ""
            conn.execute(f"UPDATE tareas SET {sets}, actualizada_en=?{extra} WHERE id=?",
                         (*cambios.values(), db.ahora(), tid))
            if "fecha_limite" in cambios:
                registrar_evento(conn, tid, "reprogramada", actual["estado"], actual["estado"],
                                 f"Fecha límite: {actual['fecha_limite'] or 'sin fecha'} → "
                                 f"{cambios['fecha_limite'] or 'sin fecha'}")
            if "prioridad" in cambios:
                registrar_evento(conn, tid, "editada", None, None,
                                 f"Prioridad {actual['prioridad']} → {cambios['prioridad']}")
            otros = [k for k in cambios if k not in ("fecha_limite", "prioridad")]
            if otros:
                registrar_evento(conn, tid, "editada", None, None, "Cambió: " + ", ".join(otros))
        if dependencias is not None:
            # El cambio de bloqueo de esta misma tarea ya quedó explicado en el evento «dependencias».
            if tid in ids_bloqueadas(conn):
                antes.add(tid)
            else:
                antes.discard(tid)
        res = obtener_tarea(conn, tid)
        res["desbloqueadas"] = registrar_cambios_bloqueo(conn, antes, f"se modificó «{actual['titulo']}»")
        return jsonify(res)


@app.delete("/api/tareas/<int:tid>")
def api_eliminar_tarea(tid):
    """Borrado lógico: la tarea desaparece de las vistas pero su historial se conserva."""
    ahora = db.ahora()
    with db.conexion() as conn:
        t = fila_tarea(conn, tid)
        antes = ids_bloqueadas(conn)
        cerrar_sesion(conn, tid, ahora)
        conn.execute("UPDATE tareas SET eliminada=1, eliminada_en=?, actualizada_en=? WHERE id=?",
                     (ahora, ahora, tid))
        registrar_evento(conn, tid, "eliminada", t["estado"], None)
        desbloqueadas = registrar_cambios_bloqueo(conn, antes - {tid}, f"se eliminó «{t['titulo']}»")
    return jsonify(ok=True, desbloqueadas=desbloqueadas)


@app.post("/api/tareas/<int:tid>/accion")
def api_accion_tarea(tid):
    d = body()
    accion = d.get("accion")
    ahora = db.ahora()
    with db.conexion() as conn:
        t = fila_tarea(conn, tid)
        est = t["estado"]
        antes = ids_bloqueadas(conn)
        ignorando = ""
        if accion in ("iniciar", "completar") and tid in antes:
            pendientes_dep = [x for x in info_dependencias(conn)[0].get(tid, []) if not x["completa"]]
            nombres = [f"«{x['titulo']}»" + (f" (de «{x['tarea_titulo']}»)" if x["tipo"] == "subtarea" else "")
                       for x in pendientes_dep]
            if not d.get("forzar"):
                return jsonify(error="Esta tarea está bloqueada: espera " + ", ".join(nombres) + ".",
                               bloqueada=True, pendientes=nombres), 409
            ignorando = " · sin esperar " + ", ".join(nombres)

        if accion == "iniciar":
            if est not in ("pendiente", "pausada"):
                raise ValueError("Solo se puede iniciar una tarea pendiente o pausada.")
            # Una tarea a la vez: se pausa cualquier otra en curso.
            for o in conn.execute("SELECT id FROM tareas WHERE estado='en_progreso' AND id<>? AND eliminada=0",
                                  (tid,)).fetchall():
                mins = cerrar_sesion(conn, o["id"], ahora)
                conn.execute("UPDATE tareas SET estado='pausada', actualizada_en=? WHERE id=?", (ahora, o["id"]))
                registrar_evento(conn, o["id"], "pausada", "en_progreso", "pausada",
                                 f"Pausa automática al iniciar otra tarea · sesión de {mins:.0f} min")
            tipo = "reanudada" if t["iniciada_en"] else "iniciada"
            conn.execute("UPDATE tareas SET estado='en_progreso', iniciada_en=COALESCE(iniciada_en, ?), "
                         "actualizada_en=? WHERE id=?", (ahora, ahora, tid))
            conn.execute("INSERT INTO sesiones (tarea_id, inicio) VALUES (?,?)", (tid, ahora))
            registrar_evento(conn, tid, tipo, est, "en_progreso", cap(ignorando.lstrip(" ·")) or None)

        elif accion == "pausar":
            if est != "en_progreso":
                raise ValueError("La tarea no está en progreso.")
            mins = cerrar_sesion(conn, tid, ahora)
            conn.execute("UPDATE tareas SET estado='pausada', actualizada_en=? WHERE id=?", (ahora, tid))
            registrar_evento(conn, tid, "pausada", est, "pausada", f"Sesión de {mins:.0f} min")

        elif accion == "completar":
            if est not in ABIERTOS:
                raise ValueError("La tarea ya está cerrada.")
            mins = cerrar_sesion(conn, tid, ahora)
            pendientes = conn.execute("SELECT COUNT(*) FROM subtareas WHERE tarea_id=? AND completada=0",
                                      (tid,)).fetchone()[0]
            if pendientes:
                if not d.get("completar_subtareas"):
                    raise ValueError(f"Quedan {pendientes} subtarea(s) sin completar.")
                conn.execute("UPDATE subtareas SET completada=1, completada_en=? WHERE tarea_id=? AND completada=0",
                             (ahora, tid))
            manual = d.get("minutos_manual")
            if manual not in (None, "") and float(manual) > 0:
                m = float(manual)
                ini = (parse_dt(ahora) - timedelta(minutes=m)).isoformat(timespec="seconds")
                conn.execute("INSERT INTO sesiones (tarea_id, inicio, fin, minutos, manual) VALUES (?,?,?,?,1)",
                             (tid, ini, ahora, m))
                mins += m
            conn.execute("UPDATE tareas SET estado='completada', completada_en=?, "
                         "iniciada_en=COALESCE(iniciada_en, ?), actualizada_en=? WHERE id=?",
                         (ahora, ahora, ahora, tid))
            lim = limite_dt(t["fecha_limite"])
            if not lim:
                detalle = "Sin fecha límite"
            elif parse_dt(ahora) <= lim:
                detalle = "A tiempo"
            else:
                detalle = f"Con {fmt_dur_dias((parse_dt(ahora) - lim).total_seconds() / 86400)} de atraso"
            if mins:
                detalle += f" · última sesión {mins:.0f} min"
            if pendientes:
                detalle += f" · se cerraron {pendientes} subtarea(s) pendiente(s)"
            registrar_evento(conn, tid, "completada", est, "completada", detalle + ignorando)

        elif accion == "reabrir":
            if est not in ("completada", "cancelada"):
                raise ValueError("Solo se reabren tareas completadas o canceladas.")
            conn.execute("UPDATE tareas SET estado='pendiente', completada_en=NULL, alerta_vencida=0, "
                         "actualizada_en=? WHERE id=?", (ahora, tid))
            registrar_evento(conn, tid, "reabierta", est, "pendiente")

        elif accion == "cancelar":
            if est not in ABIERTOS:
                raise ValueError("La tarea ya está cerrada.")
            cerrar_sesion(conn, tid, ahora)
            conn.execute("UPDATE tareas SET estado='cancelada', actualizada_en=? WHERE id=?", (ahora, tid))
            registrar_evento(conn, tid, "cancelada", est, "cancelada", d.get("motivo") or None)
        else:
            raise ValueError("Acción no válida.")

        verbo = {"completar": "se completó", "cancelar": "se canceló", "reabrir": "se reabrió"}.get(accion, "cambió")
        res = obtener_tarea(conn, tid)
        res["desbloqueadas"] = registrar_cambios_bloqueo(conn, antes, f"{verbo} «{t['titulo']}»")
        return jsonify(res)


# ───────────────────────── soporte: archivos y enlaces ─────────────────────────
# Tipos que el navegador puede mostrar sin riesgo; el resto (HTML, SVG, etc.) siempre se descarga.
VISIBLES_EN_NAVEGADOR = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"}


def fmt_tamano(n):
    if n is None:
        return ""
    for unidad in ("B", "KB", "MB", "GB"):
        if n < 1024 or unidad == "GB":
            return (f"{n:.0f} {unidad}" if unidad == "B" else f"{n:.1f} {unidad}").replace(".", ",")
        n /= 1024


def adjunto_dict(a):
    d = dict(a)
    d.pop("archivo", None)  # el nombre interno en disco no se expone
    if d["tipo"] == "archivo":
        d["url"] = f"/api/adjuntos/{d['id']}/archivo"
        d["tamano_texto"] = fmt_tamano(d["tamano"])
        d["visible"] = d["mime"] in VISIBLES_EN_NAVEGADOR
    return d


def normalizar_enlace(url):
    url = (url or "").strip().replace(" ", "%20")  # enlaces de SharePoint copiados con espacios
    if not url:
        raise ValueError("Escribe el enlace.")
    esquema = re.match(r"^([a-z][a-z0-9+.-]*):(?!\d)", url, re.I)  # «javascript:», «file:», «mailto:»…
    if esquema and esquema.group(1).lower() not in ("http", "https"):
        raise ValueError("Solo se admiten enlaces web (http o https).")
    if not esquema:
        url = "https://" + url  # «sharepoint.com/...» → https://sharepoint.com/...
    if not re.match(r"^https?://[^\s/$.?#][^\s]*$", url, re.I):
        raise ValueError("El enlace debe empezar por http:// o https://")
    return url[:2000]


@app.post("/api/tareas/<int:tid>/adjuntos")
def api_crear_adjunto(tid):
    ahora = db.ahora()
    with db.conexion() as conn:
        fila_tarea(conn, tid)
        archivos = request.files.getlist("archivo")
        creados = []
        if archivos and any(f.filename for f in archivos):
            os.makedirs(db.ADJUNTOS_DIR, exist_ok=True)
            for f in archivos:
                if not f.filename:
                    continue
                nombre = os.path.basename(f.filename.replace("\\", "/"))[:200] or "archivo"
                ext = os.path.splitext(nombre)[1].lower()[:12]
                interno = f"{tid}_{uuid.uuid4().hex}{ext}"
                ruta = os.path.join(db.ADJUNTOS_DIR, interno)
                f.save(ruta)
                tamano = os.path.getsize(ruta)
                mime = f.mimetype if f.mimetype and f.mimetype != "application/octet-stream" else (
                    mimetypes.guess_type(nombre)[0] or "application/octet-stream")
                cur = conn.execute("INSERT INTO adjuntos (tarea_id, tipo, nombre, archivo, tamano, mime, creado_en) "
                                   "VALUES (?,?,?,?,?,?,?)", (tid, "archivo", nombre, interno, tamano, mime, ahora))
                creados.append(cur.lastrowid)
                registrar_evento(conn, tid, "adjunto", None, None, f"Adjuntó «{nombre}» ({fmt_tamano(tamano)})")
        else:
            d = request.get_json(silent=True) or request.form.to_dict()
            url = normalizar_enlace(d.get("url"))
            nombre = (d.get("nombre") or "").strip()[:200] or re.sub(r"^https?://(www\.)?", "", url)[:80]
            cur = conn.execute("INSERT INTO adjuntos (tarea_id, tipo, nombre, url, creado_en) VALUES (?,?,?,?,?)",
                               (tid, "enlace", nombre, url, ahora))
            creados.append(cur.lastrowid)
            registrar_evento(conn, tid, "adjunto", None, None, f"Agregó el enlace «{nombre}»")
        if not creados:
            raise ValueError("Elige un archivo o escribe un enlace.")
        filas = conn.execute(f"SELECT * FROM adjuntos WHERE id IN ({','.join('?' * len(creados))})", creados).fetchall()
        return jsonify([adjunto_dict(a) for a in filas]), 201


@app.get("/api/adjuntos/<int:aid>/archivo")
def api_ver_adjunto(aid):
    with db.conexion() as conn:
        a = conn.execute("SELECT * FROM adjuntos WHERE id=? AND tipo='archivo'", (aid,)).fetchone()
    if not a:
        abort(404, "Archivo no encontrado.")
    ruta = os.path.join(db.ADJUNTOS_DIR, a["archivo"])
    if not os.path.isfile(ruta):
        abort(404, "El archivo ya no está en la carpeta de adjuntos.")
    ver = request.args.get("descargar") != "1" and a["mime"] in VISIBLES_EN_NAVEGADOR
    resp = send_file(ruta, mimetype=a["mime"] if ver else "application/octet-stream",
                     as_attachment=not ver, download_name=a["nombre"], max_age=0)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@app.delete("/api/adjuntos/<int:aid>")
def api_eliminar_adjunto(aid):
    with db.conexion() as conn:
        a = conn.execute("SELECT * FROM adjuntos WHERE id=?", (aid,)).fetchone()
        if not a:
            abort(404, "Adjunto no encontrado.")
        conn.execute("DELETE FROM adjuntos WHERE id=?", (aid,))
        registrar_evento(conn, a["tarea_id"], "adjunto", None, None,
                         f"Quitó {'el archivo' if a['tipo'] == 'archivo' else 'el enlace'} «{a['nombre']}»")
    if a["archivo"]:
        try:
            os.remove(os.path.join(db.ADJUNTOS_DIR, a["archivo"]))
        except OSError:
            pass
    return jsonify(ok=True)


# ───────────────────────── comentarios ─────────────────────────
def texto_comentario(d):
    texto = (d.get("texto") or "").strip()
    if not texto:
        raise ValueError("Escribe el comentario.")
    if len(texto) > 5000:
        raise ValueError("El comentario es muy largo (máx. 5000 caracteres).")
    return texto


@app.post("/api/tareas/<int:tid>/comentarios")
def api_crear_comentario(tid):
    texto = texto_comentario(body())
    with db.conexion() as conn:
        conn.execute("SELECT 1 FROM tareas WHERE id=? AND eliminada=0", (tid,)).fetchone() or abort(404, "Tarea no encontrada.")
        cur = conn.execute("INSERT INTO comentarios (tarea_id, texto, creado_en) VALUES (?,?,?)", (tid, texto, db.ahora()))
        return jsonify(dict(conn.execute("SELECT * FROM comentarios WHERE id=?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/comentarios/<int:cid>")
def api_editar_comentario(cid):
    texto = texto_comentario(body())
    with db.conexion() as conn:
        c = conn.execute("SELECT * FROM comentarios WHERE id=?", (cid,)).fetchone()
        if not c:
            abort(404, "Comentario no encontrado.")
        if c["texto"] != texto:
            conn.execute("UPDATE comentarios SET texto=?, editado_en=? WHERE id=?", (texto, db.ahora(), cid))
        return jsonify(dict(conn.execute("SELECT * FROM comentarios WHERE id=?", (cid,)).fetchone()))


@app.delete("/api/comentarios/<int:cid>")
def api_eliminar_comentario(cid):
    with db.conexion() as conn:
        conn.execute("DELETE FROM comentarios WHERE id=?", (cid,))
    return jsonify(ok=True)


# ───────────────────────── subtareas ─────────────────────────
def fila_subtarea(conn, sid):
    s = conn.execute("SELECT s.*, t.estado AS estado_tarea FROM subtareas s JOIN tareas t ON t.id = s.tarea_id "
                     "WHERE s.id=? AND t.eliminada=0", (sid,)).fetchone()
    if not s:
        abort(404, "Subtarea no encontrada.")
    return s


@app.post("/api/tareas/<int:tid>/subtareas")
def api_crear_subtarea(tid):
    titulo = (body().get("titulo") or "").strip()[:200]
    if not titulo:
        raise ValueError("Escribe la subtarea.")
    with db.conexion() as conn:
        fila_tarea(conn, tid)
        orden = conn.execute("SELECT COALESCE(MAX(orden),0)+1 FROM subtareas WHERE tarea_id=? AND es_entregable=0",
                             (tid,)).fetchone()[0]
        conn.execute("INSERT INTO subtareas (tarea_id, titulo, orden, creada_en) VALUES (?,?,?,?)",
                     (tid, titulo, orden, db.ahora()))
        conn.execute("UPDATE subtareas SET orden=? WHERE tarea_id=? AND es_entregable=1", (orden + 1, tid))
        registrar_evento(conn, tid, "subtareas", None, None, f"Agregó «{titulo}» · avance {avance_texto(conn, tid)}")
        return jsonify(obtener_tarea(conn, tid)), 201


@app.put("/api/subtareas/<int:sid>")
def api_editar_subtarea(sid):
    d = body()
    ahora = db.ahora()
    with db.conexion() as conn:
        s = fila_subtarea(conn, sid)
        tid = s["tarea_id"]
        antes = ids_bloqueadas(conn)
        if (d.get("titulo") or "").strip():
            conn.execute("UPDATE subtareas SET titulo=? WHERE id=?", (d["titulo"].strip()[:200], sid))
        if "completada" in d and bool(d["completada"]) != bool(s["completada"]):
            hecha = bool(d["completada"])
            conn.execute("UPDATE subtareas SET completada=?, completada_en=? WHERE id=?",
                         (int(hecha), ahora if hecha else None, sid))
            if hecha:  # avanzar en una subtarea cuenta como haber empezado la tarea
                conn.execute("UPDATE tareas SET iniciada_en=COALESCE(iniciada_en, ?), actualizada_en=? WHERE id=?",
                             (ahora, ahora, tid))
            etiqueta = "📦 Entregable " if s["es_entregable"] else ""
            registrar_evento(conn, tid, "subtarea_completada" if hecha else "subtarea_reabierta", None, None,
                             f"{'✓' if hecha else '↺'} {etiqueta}«{s['titulo']}» · avance {avance_texto(conn, tid)}")
        # Corregir la fecha de completado (por si se terminó antes de marcarla)
        if d.get("completada_en"):
            fila = conn.execute("SELECT completada, completada_en FROM subtareas WHERE id=?", (sid,)).fetchone()
            if not fila["completada"]:
                raise ValueError("Solo se puede cambiar la fecha de una subtarea completada.")
            nueva = fecha_completado(d["completada_en"])
            if nueva[:16] != (fila["completada_en"] or "")[:16]:
                conn.execute("UPDATE subtareas SET completada_en=? WHERE id=?", (nueva, sid))
                conn.execute("UPDATE tareas SET iniciada_en=CASE WHEN iniciada_en IS NULL OR iniciada_en > ? THEN ? "
                             "ELSE iniciada_en END, actualizada_en=? WHERE id=?", (nueva, nueva, ahora, tid))
                registrar_evento(conn, tid, "editada", None, None,
                                 f"Fecha de la subtarea «{s['titulo']}»: "
                                 f"{(fila['completada_en'] or '—').replace('T', ' ')[:16]} → {nueva.replace('T', ' ')[:16]}")
        res = obtener_tarea(conn, tid)
        res["desbloqueadas"] = registrar_cambios_bloqueo(
            conn, antes, f"{'se completó' if d.get('completada') else 'se desmarcó'} la subtarea «{s['titulo']}»")
        return jsonify(res)


@app.delete("/api/subtareas/<int:sid>")
def api_eliminar_subtarea(sid):
    with db.conexion() as conn:
        s = fila_subtarea(conn, sid)
        antes = ids_bloqueadas(conn)
        conn.execute("DELETE FROM subtareas WHERE id=?", (sid,))
        registrar_evento(conn, s["tarea_id"], "subtareas", None, None,
                         f"Quitó «{s['titulo']}» · avance {avance_texto(conn, s['tarea_id'])}")
        res = obtener_tarea(conn, s["tarea_id"])
        res["desbloqueadas"] = registrar_cambios_bloqueo(conn, antes, f"se quitó la subtarea «{s['titulo']}»")
        return jsonify(res)


@app.delete("/api/dependencias/<int:did>")
def api_eliminar_dependencia(did):
    """Quita un requisito de una tarea (desde el detalle)."""
    with db.conexion() as conn:
        r = conn.execute("SELECT * FROM dependencias WHERE id=?", (did,)).fetchone()
        if not r:
            abort(404, "Dependencia no encontrada.")
        tipo, ref = ("tarea", r["depende_tarea_id"]) if r["depende_tarea_id"] else ("subtarea", r["depende_subtarea_id"])
        try:
            texto = tarea_de_requisito(conn, tipo, ref)[1]
        except ValueError:
            texto = "un elemento eliminado"
        conn.execute("DELETE FROM dependencias WHERE id=?", (did,))
        registrar_evento(conn, r["tarea_id"], "dependencias", None, None, f"Ya no depende de {texto}")
        return jsonify(obtener_tarea(conn, r["tarea_id"]))


# ───────────────────────── catálogos: categorías y descripciones ─────────────────────────
FIRMAS_IMAGEN = {"image/png": b"\x89PNG", "image/jpeg": b"\xff\xd8\xff", "image/gif": b"GIF8", "image/webp": b"RIFF"}
MAX_IMAGEN = 300_000  # bytes; el navegador la reduce a 96x96, normalmente pesa < 20 KB


def decodificar_imagen(data_url):
    """Valida un data URL de imagen (sin SVG) y devuelve (tipo, bytes)."""
    m = re.match(r"^data:(image/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$", str(data_url or ""))
    if not m or m.group(1) not in FIRMAS_IMAGEN:
        raise ValueError("Formato no admitido: usa PNG, JPG, WEBP o GIF.")
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except (binascii.Error, ValueError):
        raise ValueError("La imagen está dañada.")
    if len(raw) > MAX_IMAGEN:
        raise ValueError("La imagen es muy pesada (máx. 300 KB).")
    if not raw.startswith(FIRMAS_IMAGEN[m.group(1)]):
        raise ValueError("El archivo no es una imagen válida.")
    return m.group(1), raw


def catalogos(conn):
    cats = []
    for r in conn.execute(
            "SELECT c.id, c.nombre, c.usos, c.usada_en, c.icono, c.actualizada_en, "
            "(c.imagen IS NOT NULL) AS tiene_imagen, "
            "(SELECT COUNT(*) FROM tareas t WHERE t.eliminada=0 AND t.categoria = c.nombre COLLATE NOCASE) AS tareas "
            "FROM categorias c ORDER BY c.usos DESC, c.nombre COLLATE NOCASE"):
        c = dict(r)
        tiene = c.pop("tiene_imagen")
        version = re.sub(r"\D", "", c.get("actualizada_en") or "") or "0"
        c["imagen_url"] = f"/api/categorias/{c['id']}/imagen?v={version}" if tiene else None
        cats.append(c)
    descs = [dict(r) for r in conn.execute(
        "SELECT id, texto, usos, usada_en FROM descripciones ORDER BY usada_en DESC, usos DESC")]
    return {"categorias": cats, "descripciones": descs}


@app.get("/api/catalogos")
def api_catalogos():
    with db.conexion() as conn:
        return jsonify(catalogos(conn))


@app.post("/api/categorias")
def api_crear_categoria():
    nombre = (body().get("nombre") or "").strip()[:60]
    if not nombre:
        raise ValueError("Escribe el nombre de la categoría.")
    with db.conexion() as conn:
        conn.execute("INSERT OR IGNORE INTO categorias (nombre, creada_en) VALUES (?,?)", (nombre, db.ahora()))
        return jsonify(catalogos(conn)), 201


@app.put("/api/categorias/<int:cid>")
def api_editar_categoria(cid):
    """Cambia el ícono/imagen y/o renombra la categoría (actualizando todas sus tareas).

    Cuerpo: {"icono": "🛠️"} · {"imagen": "data:image/png;base64,..."} · {"quitar_icono": true} · {"nombre": "..."}
    """
    d = body()
    ahora = db.ahora()
    with db.conexion() as conn:
        c = conn.execute("SELECT * FROM categorias WHERE id=?", (cid,)).fetchone()
        if not c:
            abort(404, "Categoría no encontrada.")

        if d.get("quitar_icono"):
            conn.execute("UPDATE categorias SET icono=NULL, imagen=NULL, imagen_tipo=NULL, actualizada_en=? WHERE id=?",
                         (ahora, cid))
        elif d.get("imagen"):
            tipo, raw = decodificar_imagen(d["imagen"])
            conn.execute("UPDATE categorias SET imagen=?, imagen_tipo=?, actualizada_en=? WHERE id=?",
                         (raw, tipo, ahora, cid))
        elif "icono" in d:
            icono = (d.get("icono") or "").strip()[:16] or None
            # Elegir un emoji reemplaza la imagen, para que se vea lo que se acaba de elegir.
            conn.execute("UPDATE categorias SET icono=?, imagen=NULL, imagen_tipo=NULL, actualizada_en=? WHERE id=?",
                         (icono, ahora, cid))

        if "nombre" in d:
            nuevo = (d.get("nombre") or "").strip()[:60]
            if not nuevo:
                raise ValueError("Escribe el nuevo nombre.")
            if nuevo != c["nombre"]:
                otra = conn.execute("SELECT * FROM categorias WHERE nombre=? COLLATE NOCASE AND id<>?",
                                    (nuevo, cid)).fetchone()
                if otra:  # fusionar con la existente (hereda el ícono si la otra no tiene)
                    actual = conn.execute("SELECT * FROM categorias WHERE id=?", (cid,)).fetchone()
                    if not otra["icono"] and otra["imagen"] is None:
                        conn.execute("UPDATE categorias SET icono=?, imagen=?, imagen_tipo=?, actualizada_en=? WHERE id=?",
                                     (actual["icono"], actual["imagen"], actual["imagen_tipo"], ahora, otra["id"]))
                    conn.execute("UPDATE categorias SET usos = usos + ? WHERE id=?", (c["usos"], otra["id"]))
                    conn.execute("DELETE FROM categorias WHERE id=?", (cid,))
                    nuevo = otra["nombre"]
                else:
                    conn.execute("UPDATE categorias SET nombre=?, actualizada_en=? WHERE id=?", (nuevo, ahora, cid))
                conn.execute("UPDATE tareas SET categoria=? WHERE categoria=? COLLATE NOCASE", (nuevo, c["nombre"]))
        return jsonify(catalogos(conn))


@app.get("/api/categorias/<int:cid>/imagen")
def api_imagen_categoria(cid):
    with db.conexion() as conn:
        r = conn.execute("SELECT imagen, imagen_tipo FROM categorias WHERE id=?", (cid,)).fetchone()
    if not r or r["imagen"] is None:
        abort(404, "La categoría no tiene imagen.")
    return Response(bytes(r["imagen"]), mimetype=r["imagen_tipo"] or "image/png", headers={
        "Cache-Control": "public, max-age=31536000, immutable",  # la URL cambia (?v=) al reemplazarla
        "X-Content-Type-Options": "nosniff",
    })


@app.delete("/api/categorias/<int:cid>")
def api_eliminar_categoria(cid):
    """Quita la categoría de la lista. Las tareas que la usaban pasan a 'General'."""
    with db.conexion() as conn:
        c = conn.execute("SELECT * FROM categorias WHERE id=?", (cid,)).fetchone()
        if not c:
            abort(404, "Categoría no encontrada.")
        if c["nombre"].lower() == "general":
            raise ValueError("La categoría General no se puede eliminar.")
        conn.execute("DELETE FROM categorias WHERE id=?", (cid,))
        conn.execute("UPDATE tareas SET categoria='General' WHERE categoria=? COLLATE NOCASE", (c["nombre"],))
        conn.execute("INSERT OR IGNORE INTO categorias (nombre, creada_en) VALUES ('General', ?)", (db.ahora(),))
        return jsonify(catalogos(conn))


@app.post("/api/descripciones")
def api_crear_descripcion():
    texto = (body().get("texto") or "").strip()
    if not texto:
        raise ValueError("Escribe la descripción.")
    with db.conexion() as conn:
        conn.execute("INSERT OR IGNORE INTO descripciones (texto, creada_en) VALUES (?,?)", (texto, db.ahora()))
        return jsonify(catalogos(conn)), 201


@app.delete("/api/descripciones/<int:did>")
def api_eliminar_descripcion(did):
    """Quita la descripción de las sugerencias (las tareas conservan su texto)."""
    with db.conexion() as conn:
        conn.execute("DELETE FROM descripciones WHERE id=?", (did,))
        return jsonify(catalogos(conn))


# ───────────────────────── metas de aprendizaje ─────────────────────────
def limpiar_meta(d, parcial=False):
    out = {}
    if "herramienta" in d or not parcial:
        h = (d.get("herramienta") or "").strip()
        if not h:
            raise ValueError("Indica la herramienta o tema a aprender.")
        out["herramienta"] = h[:120]
    for k in ("descripcion", "categoria"):
        if k in d:
            out[k] = (d.get(k) or "").strip()
    for k in ("nivel_actual", "nivel_objetivo"):
        if k in d:
            v = int(d.get(k) or 1)
            if not 1 <= v <= 5:
                raise ValueError("Los niveles van de 1 a 5.")
            out[k] = v
    if "horas_objetivo" in d:
        v = float(d.get("horas_objetivo") or 0)
        if v < 0:
            raise ValueError("Las horas objetivo no pueden ser negativas.")
        out["horas_objetivo"] = v
    for k in ("fecha_inicio", "fecha_objetivo"):
        if k in d:
            v = (d.get(k) or "").strip() or None
            if v:
                date.fromisoformat(v[:10])
                v = v[:10]
            out[k] = v
    if "estado" in d:
        if d["estado"] not in ("activa", "pausada", "lograda"):
            raise ValueError("Estado de meta inválido.")
        out["estado"] = d["estado"]
    return out


def listar_metas(conn, meta_id=None):
    q = "SELECT * FROM metas"
    params = ()
    if meta_id:
        q += " WHERE id=?"
        params = (meta_id,)
    q += " ORDER BY estado='lograda', estado='pausada', fecha_objetivo IS NULL, fecha_objetivo, id"
    totales, _ = tiempos_por_tarea(conn)
    hoy = date.today()
    salida = []
    for r in conn.execute(q, params).fetchall():
        m = dict(r)
        reg = conn.execute("SELECT COALESCE(SUM(minutos),0) AS mins, MAX(fecha) AS ultima "
                           "FROM registros_aprendizaje WHERE meta_id=?", (m["id"],)).fetchone()
        tareas = conn.execute("SELECT id, estado FROM tareas WHERE meta_id=? AND eliminada=0",
                              (m["id"],)).fetchall()
        min_tareas = sum(totales.get(t["id"], 0) for t in tareas)
        horas = (reg["mins"] + min_tareas) / 60
        hitos = [dict(h) for h in conn.execute(
            "SELECT * FROM hitos_meta WHERE meta_id=? ORDER BY orden, id", (m["id"],))]
        hechos = sum(1 for h in hitos if h["completado"])
        comps = []
        if m["horas_objetivo"]:
            comps.append(min(1.0, horas / m["horas_objetivo"]))
        if hitos:
            comps.append(hechos / len(hitos))
        progreso = round(100 * sum(comps) / len(comps)) if comps else 0
        if m["estado"] == "lograda":
            progreso = 100
        dias_rest = (date.fromisoformat(m["fecha_objetivo"]) - hoy).days if m["fecha_objetivo"] else None
        faltan = max(0.0, (m["horas_objetivo"] or 0) - horas)
        ritmo = round(faltan / max(1.0, dias_rest / 7), 1) if (dias_rest is not None and dias_rest > 0) else None
        m.update(
            horas_acumuladas=round(horas, 1),
            horas_tareas=round(min_tareas / 60, 1),
            horas_faltantes=round(faltan, 1),
            hitos=hitos,
            hitos_completados=hechos,
            progreso_pct=progreso,
            dias_restantes=dias_rest,
            ritmo_semanal_necesario=ritmo,
            ultima_practica=reg["ultima"],
            tareas_vinculadas=len(tareas),
            tareas_abiertas=sum(1 for t in tareas if t["estado"] in ABIERTOS),
            registros=[dict(x) for x in conn.execute(
                "SELECT * FROM registros_aprendizaje WHERE meta_id=? ORDER BY fecha DESC, id DESC LIMIT 15",
                (m["id"],))],
        )
        salida.append(m)
    return salida


def meta_o_404(conn, mid):
    if not conn.execute("SELECT 1 FROM metas WHERE id=?", (mid,)).fetchone():
        abort(404, "Meta no encontrada.")


@app.get("/api/metas")
def api_listar_metas():
    with db.conexion() as conn:
        return jsonify(listar_metas(conn))


@app.post("/api/metas")
def api_crear_meta():
    campos = limpiar_meta(body())
    ahora = db.ahora()
    campos.setdefault("fecha_inicio", date.today().isoformat())
    campos.update(creada_en=ahora, actualizada_en=ahora)
    with db.conexion() as conn:
        cur = conn.execute(f"INSERT INTO metas ({', '.join(campos)}) VALUES ({', '.join('?' * len(campos))})",
                           tuple(campos.values()))
        return jsonify(listar_metas(conn, cur.lastrowid)[0]), 201


@app.put("/api/metas/<int:mid>")
def api_editar_meta(mid):
    campos = limpiar_meta(body(), parcial=True)
    with db.conexion() as conn:
        meta_o_404(conn, mid)
        if campos:
            if campos.get("estado") == "lograda":
                campos["lograda_en"] = db.ahora()
            elif "estado" in campos:
                campos["lograda_en"] = None
            campos["actualizada_en"] = db.ahora()
            conn.execute(f"UPDATE metas SET {', '.join(f'{k}=?' for k in campos)} WHERE id=?",
                         (*campos.values(), mid))
        return jsonify(listar_metas(conn, mid)[0])


@app.delete("/api/metas/<int:mid>")
def api_eliminar_meta(mid):
    with db.conexion() as conn:
        meta_o_404(conn, mid)
        conn.execute("DELETE FROM metas WHERE id=?", (mid,))
    return jsonify(ok=True)


@app.post("/api/metas/<int:mid>/hitos")
def api_crear_hito(mid):
    titulo = (body().get("titulo") or "").strip()
    if not titulo:
        raise ValueError("Escribe el hito.")
    with db.conexion() as conn:
        meta_o_404(conn, mid)
        orden = conn.execute("SELECT COALESCE(MAX(orden),0)+1 FROM hitos_meta WHERE meta_id=?", (mid,)).fetchone()[0]
        conn.execute("INSERT INTO hitos_meta (meta_id, titulo, orden, creado_en) VALUES (?,?,?,?)",
                     (mid, titulo[:200], orden, db.ahora()))
        return jsonify(listar_metas(conn, mid)[0]), 201


@app.put("/api/hitos/<int:hid>")
def api_editar_hito(hid):
    d = body()
    with db.conexion() as conn:
        h = conn.execute("SELECT * FROM hitos_meta WHERE id=?", (hid,)).fetchone()
        if not h:
            abort(404, "Hito no encontrado.")
        if "completado" in d:
            hecho = 1 if d["completado"] else 0
            conn.execute("UPDATE hitos_meta SET completado=?, completado_en=? WHERE id=?",
                         (hecho, db.ahora() if hecho else None, hid))
        if (d.get("titulo") or "").strip():
            conn.execute("UPDATE hitos_meta SET titulo=? WHERE id=?", (d["titulo"].strip()[:200], hid))
        return jsonify(listar_metas(conn, h["meta_id"])[0])


@app.delete("/api/hitos/<int:hid>")
def api_eliminar_hito(hid):
    with db.conexion() as conn:
        conn.execute("DELETE FROM hitos_meta WHERE id=?", (hid,))
    return jsonify(ok=True)


@app.post("/api/metas/<int:mid>/registros")
def api_registrar_practica(mid):
    d = body()
    minutos = int(float(d.get("minutos") or 0))
    if minutos <= 0:
        raise ValueError("Indica los minutos practicados.")
    fecha = (d.get("fecha") or date.today().isoformat())[:10]
    date.fromisoformat(fecha)
    with db.conexion() as conn:
        meta_o_404(conn, mid)
        conn.execute("INSERT INTO registros_aprendizaje (meta_id, fecha, minutos, nota, creado_en) VALUES (?,?,?,?,?)",
                     (mid, fecha, minutos, (d.get("nota") or "").strip(), db.ahora()))
        return jsonify(listar_metas(conn, mid)[0]), 201


@app.delete("/api/registros/<int:rid>")
def api_eliminar_registro(rid):
    with db.conexion() as conn:
        conn.execute("DELETE FROM registros_aprendizaje WHERE id=?", (rid,))
    return jsonify(ok=True)


# ───────────────────────── rendimiento ─────────────────────────
@app.get("/api/estadisticas")
def api_estadisticas():
    dias = max(1, min(365, int(request.args.get("dias", 30))))
    ahora = datetime.now()
    desde = (ahora - timedelta(days=dias - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    with db.conexion() as conn:
        marcar_vencidas(conn)
        tareas = listar_tareas(conn, incluir_cerradas=True)
        sesiones = conn.execute(
            "SELECT s.inicio, s.fin, s.minutos, t.categoria FROM sesiones s "
            "JOIN tareas t ON t.id = s.tarea_id WHERE t.eliminada = 0").fetchall()
        reprogramaciones = conn.execute(
            "SELECT COUNT(*) FROM eventos WHERE tipo='reprogramada' AND momento >= ?",
            (desde.isoformat(timespec="seconds"),)).fetchone()[0]
        practica = conn.execute(
            "SELECT fecha, minutos FROM registros_aprendizaje WHERE fecha >= ?",
            (desde.date().isoformat(),)).fetchall()
        subs_hechas = conn.execute(
            "SELECT COUNT(*) FROM subtareas s JOIN tareas t ON t.id=s.tarea_id "
            "WHERE t.eliminada=0 AND s.completada=1 AND s.completada_en >= ?",
            (desde.isoformat(timespec="seconds"),)).fetchone()[0]

    def en_periodo(iso):
        d = parse_dt(iso)
        return d is not None and d >= desde

    creadas = [t for t in tareas if en_periodo(t["creada_en"])]
    completadas = [t for t in tareas if t["estado"] == "completada" and en_periodo(t["completada_en"])]
    con_limite = [t for t in completadas if t["completada_a_tiempo"] is not None]
    a_tiempo = [t for t in con_limite if t["completada_a_tiempo"]]
    tarde = [t for t in con_limite if not t["completada_a_tiempo"]]
    ciclos = [t["ciclo_horas"] for t in completadas if t["ciclo_horas"] is not None]
    estimadas = [t for t in completadas if t["estimado_min"] and t["tiempo_real_min"] > 0]
    abiertas = [t for t in tareas if t["estado"] in ABIERTOS]

    serie = [(desde + timedelta(days=i)).date().isoformat() for i in range(dias)]
    comp_dia = dict.fromkeys(serie, 0)
    foco_dia = dict.fromkeys(serie, 0.0)
    apr_dia = dict.fromkeys(serie, 0.0)
    for t in completadas:
        k = t["completada_en"][:10]
        if k in comp_dia:
            comp_dia[k] += 1
    foco_cat = {}
    for s in sesiones:
        ini = parse_dt(s["inicio"])
        fin = parse_dt(s["fin"]) or ahora
        m = s["minutos"] if s["minutos"] is not None else max(0, (fin - ini).total_seconds() / 60)
        k = ini.date().isoformat()
        if k in foco_dia:
            foco_dia[k] += m
            foco_cat[s["categoria"] or "General"] = foco_cat.get(s["categoria"] or "General", 0) + m
    for p in practica:
        if p["fecha"] in apr_dia:
            apr_dia[p["fecha"]] += p["minutos"]

    # Racha: días consecutivos (hasta hoy o ayer) con al menos una tarea completada.
    dias_con_logro = {t["completada_en"][:10] for t in tareas if t["estado"] == "completada" and t["completada_en"]}
    racha, cursor = 0, date.today()
    if cursor.isoformat() not in dias_con_logro:
        cursor -= timedelta(days=1)
    while cursor.isoformat() in dias_con_logro:
        racha += 1
        cursor -= timedelta(days=1)

    por_prioridad = [{
        "prioridad": p,
        "completadas": sum(1 for t in completadas if t["prioridad"] == p),
        "abiertas": sum(1 for t in abiertas if t["prioridad"] == p),
    } for p in PRIORIDADES]
    cats = {}
    for t in completadas:
        cats[t["categoria"]] = cats.get(t["categoria"], 0) + 1

    tasa_a_tiempo = len(a_tiempo) / len(con_limite) if con_limite else None
    cumplimiento = min(1.0, len(completadas) / len(creadas)) if creadas else None
    foco_vital = (sum(1 for t in completadas if t["prioridad"] in "AB") / len(completadas)) if completadas else None
    ratio_est = (sum(t["tiempo_real_min"] for t in estimadas) / sum(t["estimado_min"] for t in estimadas)
                 if estimadas else None)
    precision = (1 - min(1.0, abs(ratio_est - 1))) if ratio_est is not None else None

    componentes = [(tasa_a_tiempo, 0.4), (cumplimiento, 0.3), (foco_vital, 0.2), (precision, 0.1)]
    disp = [(v, w) for v, w in componentes if v is not None]
    puntaje = round(100 * sum(v * w for v, w in disp) / sum(w for _, w in disp)) if disp else None

    def pct(x):
        return round(100 * x, 1) if x is not None else None

    return jsonify({
        "dias": dias,
        "desde": desde.date().isoformat(),
        "creadas": len(creadas),
        "completadas": len(completadas),
        "canceladas": sum(1 for t in tareas if t["estado"] == "cancelada" and en_periodo(t["actualizada_en"])),
        "abiertas": len(abiertas),
        "vencidas_abiertas": sum(1 for t in abiertas if t["vencida"]),
        "a_tiempo": len(a_tiempo),
        "tarde": len(tarde),
        "tasa_a_tiempo_pct": pct(tasa_a_tiempo),
        "tasa_cumplimiento_pct": pct(cumplimiento),
        "foco_vital_pct": pct(foco_vital),
        "promedio_ciclo_horas": round(sum(ciclos) / len(ciclos), 1) if ciclos else None,
        "promedio_atraso_dias": round(sum(t["dias_atraso"] for t in tarde) / len(tarde), 2) if tarde else None,
        "ratio_real_vs_estimado": round(ratio_est, 2) if ratio_est is not None else None,
        "minutos_foco": round(sum(foco_dia.values())),
        "minutos_aprendizaje": round(sum(apr_dia.values())),
        "reprogramaciones": reprogramaciones,
        "subtareas_completadas": subs_hechas,
        "ranas_completadas": sum(1 for t in completadas if t["es_rana"]),
        "racha_dias": racha,
        "puntaje": puntaje,
        "serie": [{"fecha": k, "completadas": comp_dia[k], "minutos_foco": round(foco_dia[k]),
                   "minutos_aprendizaje": round(apr_dia[k])} for k in serie],
        "por_prioridad": por_prioridad,
        "por_categoria": sorted(({"categoria": k, "completadas": v, "minutos_foco": round(foco_cat.get(k, 0))}
                                 for k, v in cats.items()), key=lambda x: -x["completadas"]),
    })


# ───────────────────────── reporte de cumplimiento ─────────────────────────
ORDEN_REPORTE = {"vencida": 0, "bloqueada": 1, "en_curso": 2, "pendiente": 3, "atrasada": 4, "a_tiempo": 5, "sin_fecha": 6}


def estado_reporte(t):
    """Clasifica una tarea para el reporte: (código, texto)."""
    if t["estado"] == "completada":
        if t["completada_a_tiempo"] is True:
            return "a_tiempo", "Completada a tiempo"
        if t["completada_a_tiempo"] is False:
            return "atrasada", f"Completada con {fmt_dur_dias(t['dias_atraso'])} de atraso"
        return "sin_fecha", "Completada"
    if t["vencida"]:
        return "vencida", f"Vencida hace {fmt_dur_dias(t['dias_atraso'])}"
    if t["bloqueada"]:
        return "bloqueada", "Bloqueada (en espera)"
    if t["estado"] in ("en_progreso", "pausada") or (t["progreso_pct"] or 0) > 0:
        return "en_curso", "En curso"
    return "pendiente", "Pendiente"


@app.get("/api/reporte")
def api_reporte():
    """Estatus de cumplimiento de actividades entre ?desde y ?hasta (fechas inclusivas).
    Opcional: ?categoria=Trabajo · ?sin_fecha=0 para omitir pendientes sin fecha límite."""
    try:
        desde = date.fromisoformat(request.args["desde"][:10])
        hasta = date.fromisoformat(request.args["hasta"][:10])
    except (KeyError, ValueError):
        raise ValueError("Indica las fechas desde y hasta (AAAA-MM-DD).")
    if hasta < desde:
        raise ValueError("La fecha final no puede ser anterior a la inicial.")
    categoria = (request.args.get("categoria") or "").strip().lower()
    sin_fecha = request.args.get("sin_fecha", "1") != "0"
    ahora = datetime.now()
    d0 = datetime.combine(desde, datetime.min.time())
    d1 = datetime.combine(hasta + timedelta(days=1), datetime.min.time())
    corte = min(d1, ahora)

    with db.conexion() as conn:
        marcar_vencidas(conn)
        tareas = listar_tareas(conn, incluir_cerradas=True)
        # Último comentario de cada tarea (el más reciente).
        ultimos = {r["tarea_id"]: {"texto": r["texto"], "fecha": r["creado_en"]} for r in conn.execute(
            "SELECT c.tarea_id, c.texto, c.creado_en FROM comentarios c WHERE c.id = ("
            "SELECT c2.id FROM comentarios c2 WHERE c2.tarea_id = c.tarea_id ORDER BY c2.creado_en DESC, c2.id DESC LIMIT 1)")}

    def en_rango(iso):
        d = parse_dt(iso)
        return d is not None and d0 <= d < d1

    actividades, plan = [], []
    for t in tareas:
        if categoria and (t["categoria"] or "").lower() != categoria:
            continue
        lim = limite_dt(t["fecha_limite"])
        if lim and d0 <= lim < corte and t["estado"] != "cancelada":
            plan.append(t)
        if t["estado"] == "cancelada":
            continue
        if t["estado"] == "completada":
            incluir = en_rango(t["completada_en"])
        else:  # abierta: lo que vence hasta el fin del periodo, lo que está en marcha o lo creado en él
            incluir = ((lim is not None and lim < d1) or t["estado"] in ("en_progreso", "pausada")
                       or en_rango(t["creada_en"]) or (lim is None and sin_fecha))
        if not incluir:
            continue
        codigo, texto = estado_reporte(t)
        progreso = 100 if t["estado"] == "completada" else (t["progreso_pct"] or 0)
        actividades.append({
            "id": t["id"], "titulo": t["titulo"], "prioridad": t["prioridad"], "categoria": t["categoria"],
            "estado": codigo, "estado_texto": texto, "progreso": progreso,
            "fecha_limite": t["fecha_limite"], "completada_en": t["completada_en"],
            "subtareas": f"{t['subtareas_hechas']}/{t['subtareas_total']}" if t["subtareas_total"] else None,
            "entregable": t["entregable"],
            "ultimo_comentario": ultimos.get(t["id"]),
        })
    actividades.sort(key=lambda a: (ORDEN_REPORTE[a["estado"]], a["prioridad"],
                                    a["completada_en"] or a["fecha_limite"] or "9999"))

    completadas = [a for a in actividades if a["estado"] in ("a_tiempo", "atrasada", "sin_fecha")]
    con_fecha = [a for a in completadas if a["estado"] != "sin_fecha"]
    a_tiempo = [a for a in completadas if a["estado"] == "a_tiempo"]
    cumplidas_plan = [t for t in plan if t["estado"] == "completada" and t["completada_a_tiempo"]]

    def pct(n, d):
        return round(100 * n / d) if d else None

    return jsonify({
        "desde": desde.isoformat(), "hasta": hasta.isoformat(),
        "categoria": request.args.get("categoria") or None,
        "generado": db.ahora(),
        "kpis": {
            "actividades": len(actividades),
            "completadas": len(completadas),
            "a_tiempo": len(a_tiempo),
            "tarde": len(con_fecha) - len(a_tiempo),
            "entregas_a_tiempo_pct": pct(len(a_tiempo), len(con_fecha)),
            "plan_total": len(plan), "plan_cumplido": len(cumplidas_plan),
            "cumplimiento_plan_pct": pct(len(cumplidas_plan), len(plan)),
            "en_curso": sum(1 for a in actividades if a["estado"] in ("en_curso", "bloqueada")),
            "pendientes": sum(1 for a in actividades if a["estado"] == "pendiente"),
            "vencidas": sum(1 for a in actividades if a["estado"] == "vencida"),
            "avance_pct": round(sum(a["progreso"] for a in actividades) / len(actividades)) if actividades else None,
        },
        "actividades": actividades,
    })


# ───────────────────────── reporte semanal (historial) ─────────────────────────
DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


@app.get("/api/semana")
def api_semana():
    """Actividades hechas día por día en la semana ISO ?anio=2026&semana=46 (por defecto, la actual).
    Marca festivos de Colombia (API Nager.Date, guardados; o calculados si no hay conexión)."""
    hoy = date.today()
    anio_hoy, semana_hoy, _ = hoy.isocalendar()
    try:
        anio = int(request.args.get("anio") or anio_hoy)
        semana = int(request.args.get("semana") or (semana_hoy if anio == anio_hoy else 1))
        lunes = date.fromisocalendar(anio, semana, 1)
    except ValueError:
        semanas = date(int(request.args.get("anio") or anio_hoy), 12, 28).isocalendar()[1]
        raise ValueError(f"Semana inválida: el año tiene semanas de 1 a {semanas}.")
    dias = [lunes + timedelta(days=i) for i in range(7)]
    d0 = datetime.combine(dias[0], datetime.min.time())
    d1 = datetime.combine(dias[-1] + timedelta(days=1), datetime.min.time())
    rango = (d0.isoformat(timespec="seconds"), d1.isoformat(timespec="seconds"))

    with db.conexion() as conn:
        # Una semana puede cruzar de año (p. ej. 29 dic – 4 ene): se piden los festivos de ambos.
        fest, fuentes = {}, set()
        for a in sorted({d.year for d in dias}):
            f, fuente = festivos_co.obtener(conn, a)
            fest.update(f)
            fuentes.add(fuente)
        tareas = {t["id"]: t for t in listar_tareas(conn, incluir_cerradas=True)}
        subtareas = conn.execute(
            "SELECT s.titulo, s.completada_en, s.es_entregable, s.tarea_id, t.completada_en AS t_fin "
            "FROM subtareas s JOIN tareas t ON t.id=s.tarea_id "
            "WHERE t.eliminada=0 AND s.completada=1 AND s.completada_en >= ? AND s.completada_en < ?", rango).fetchall()
        sesiones = conn.execute(
            "SELECT s.tarea_id, s.inicio, s.fin, s.minutos FROM sesiones s JOIN tareas t ON t.id=s.tarea_id "
            "WHERE t.eliminada=0 AND s.inicio >= ? AND s.inicio < ?", rango).fetchall()
        comentarios = conn.execute(
            "SELECT c.tarea_id, c.texto, c.creado_en FROM comentarios c JOIN tareas t ON t.id=c.tarea_id "
            "WHERE t.eliminada=0 AND c.creado_en >= ? AND c.creado_en < ? ORDER BY c.creado_en", rango).fetchall()
        practica = conn.execute(
            "SELECT r.fecha, r.minutos, r.nota, m.herramienta FROM registros_aprendizaje r JOIN metas m ON m.id=r.meta_id "
            "WHERE r.fecha >= ? AND r.fecha <= ?", (dias[0].isoformat(), dias[-1].isoformat())).fetchall()

    ahora = datetime.now()
    por_dia = {d.isoformat(): {"completadas": [], "subtareas": [], "trabajadas": {}, "comentarios": [], "practica": []}
               for d in dias}
    breve = lambda t: {"id": t["id"], "titulo": t["titulo"], "prioridad": t["prioridad"], "categoria": t["categoria"]}

    for t in tareas.values():
        if t["estado"] == "completada" and t["completada_en"] and t["completada_en"][:10] in por_dia:
            por_dia[t["completada_en"][:10]]["completadas"].append({
                **breve(t), "hora": t["completada_en"][11:16], "a_tiempo": t["completada_a_tiempo"],
                "dias_atraso": t["dias_atraso"], "entregable": t["entregable"]})
    for s in subtareas:
        if s["t_fin"] and s["t_fin"] == s["completada_en"]:
            continue  # se cerró junto con su tarea: ya aparece como tarea completada
        t = tareas.get(s["tarea_id"])
        if t:
            por_dia[s["completada_en"][:10]]["subtareas"].append({
                "titulo": s["titulo"], "es_entregable": bool(s["es_entregable"]), "hora": s["completada_en"][11:16],
                "tarea": breve(t)})
    for s in sesiones:
        ini = parse_dt(s["inicio"])
        m = s["minutos"] if s["minutos"] is not None else max(0, ((parse_dt(s["fin"]) or ahora) - ini).total_seconds() / 60)
        t = tareas.get(s["tarea_id"])
        if t:
            dia = por_dia[ini.date().isoformat()]["trabajadas"]
            dia.setdefault(t["id"], {**breve(t), "minutos": 0})["minutos"] += m
    for c in comentarios:
        t = tareas.get(c["tarea_id"])
        if t:
            por_dia[c["creado_en"][:10]]["comentarios"].append({"texto": c["texto"], "hora": c["creado_en"][11:16], "tarea": breve(t)})
    for r in practica:
        por_dia[r["fecha"]]["practica"].append({"meta": r["herramienta"], "minutos": r["minutos"], "nota": r["nota"]})

    salida, total = [], {"completadas": 0, "a_tiempo": 0, "subtareas": 0, "minutos_foco": 0, "minutos_practica": 0,
                         "comentarios": 0, "dias_habiles": 0, "dias_con_actividad": 0}
    for i, d in enumerate(dias):
        k = d.isoformat()
        x = por_dia[k]
        trabajadas = sorted(({**v, "minutos": round(v["minutos"])} for v in x["trabajadas"].values()),
                            key=lambda v: -v["minutos"])
        minutos_foco = sum(v["minutos"] for v in trabajadas)
        minutos_practica = sum(p["minutos"] for p in x["practica"])
        festivo = fest.get(k)
        habil = i < 5 and not festivo
        hubo = any([x["completadas"], x["subtareas"], trabajadas, x["comentarios"], x["practica"]])
        salida.append({
            "fecha": k, "dia_semana": DIAS_SEMANA[i], "festivo": festivo, "fin_de_semana": i >= 5, "habil": habil,
            "hoy": d == hoy, "futuro": d > hoy,
            "completadas": sorted(x["completadas"], key=lambda v: v["hora"]),
            "subtareas": sorted(x["subtareas"], key=lambda v: v["hora"]),
            "trabajadas": trabajadas, "comentarios": x["comentarios"], "practica": x["practica"],
            "minutos_foco": minutos_foco, "minutos_practica": minutos_practica,
        })
        total["completadas"] += len(x["completadas"])
        total["a_tiempo"] += sum(1 for v in x["completadas"] if v["a_tiempo"])
        total["subtareas"] += len(x["subtareas"])
        total["minutos_foco"] += minutos_foco
        total["minutos_practica"] += minutos_practica
        total["comentarios"] += len(x["comentarios"])
        total["dias_habiles"] += 1 if habil else 0
        total["dias_con_actividad"] += 1 if hubo else 0
    total["promedio_por_dia_habil"] = round(total["completadas"] / total["dias_habiles"], 1) if total["dias_habiles"] else None

    anterior = (lunes - timedelta(days=7)).isocalendar()
    siguiente = (lunes + timedelta(days=7)).isocalendar()
    fuente = "api" if "api" in fuentes else ("calculado" if "calculado" in fuentes else "guardado")
    return jsonify({
        "anio": anio, "semana": semana, "desde": dias[0].isoformat(), "hasta": dias[-1].isoformat(),
        "semanas_del_anio": date(anio, 12, 28).isocalendar()[1],
        "es_actual": (anio, semana) == (anio_hoy, semana_hoy),
        "anterior": {"anio": anterior[0], "semana": anterior[1]},
        "siguiente": {"anio": siguiente[0], "semana": siguiente[1]},
        "festivos_fuente": fuente,
        "festivos_semana": [{"fecha": d["fecha"], "nombre": d["festivo"]} for d in salida if d["festivo"]],
        "dias": salida, "resumen": total,
    })


@app.post("/api/festivos/<int:anio>/actualizar")
def api_actualizar_festivos(anio):
    """Vuelve a consultar la API de festivos para ese año (por si antes no había conexión)."""
    with db.conexion() as conn:
        f, fuente = festivos_co.refrescar(conn, anio)
    return jsonify(anio=anio, fuente=fuente, total=len(f))


# ───────────────────────── alertas ─────────────────────────
@app.get("/api/alertas")
def api_alertas():
    ahora = datetime.now()
    alertas = []
    with db.conexion() as conn:
        marcar_vencidas(conn)
        tareas = listar_tareas(conn)
        metas = listar_metas(conn)

    for t in tareas:
        if t["vencida"]:
            alertas.append(dict(clave=f"vencida-{t['id']}-{t['fecha_limite']}", nivel="peligro",
                                titulo="Tarea vencida", tarea_id=t["id"],
                                mensaje=f"«{t['titulo']}» lleva {fmt_dur_dias(t['dias_atraso'])} de atraso."))
        elif t["horas_restantes"] is not None and t["horas_restantes"] <= 24:
            h = t["horas_restantes"]
            cuando = f"en {round(h * 60)} min" if h < 1 else f"en {h:.0f} h"
            alertas.append(dict(clave=f"pronto-{t['id']}-{t['fecha_limite']}", nivel="aviso",
                                titulo="Vence pronto", tarea_id=t["id"],
                                mensaje=f"«{t['titulo']}» vence {cuando}."))
        if t["sesion_abierta"] and t["minutos_sesion_actual"] >= 90:
            alertas.append(dict(clave=f"descanso-{t['id']}-{int(t['minutos_sesion_actual'] // 90)}",
                                nivel="info", titulo="Toma un respiro", tarea_id=t["id"],
                                mensaje=f"Llevas {t['minutos_sesion_actual']:.0f} min seguidos en «{t['titulo']}». "
                                        "Una pausa de 10 min recarga tu foco."))
    ranas = [t for t in tareas if t["es_rana"] and t["estado"] != "en_progreso"]
    if ranas and ahora.hour >= 11:
        alertas.append(dict(clave=f"rana-{date.today()}", nivel="aviso", titulo="Tu rana sigue esperando",
                            tarea_id=ranas[0]["id"],
                            mensaje=f"«{ranas[0]['titulo']}» es tu tarea más importante. Empieza con 10 minutos."))
    # Ruta crítica: tareas bloqueadas cuya fecha límite está cerca dependen de que algo más avance.
    for t in tareas:
        if not t["bloqueada"]:
            continue
        hr = t["horas_restantes"]
        if not (t["vencida"] or (hr is not None and hr <= 48)):
            continue
        cuando = "ya venció" if t["vencida"] else f"vence en {hr:.0f} h"
        for req in t["dependencias"]:
            if req["completa"]:
                continue
            nombre = req["titulo"] + (f" (de «{req['tarea_titulo']}»)" if req["tipo"] == "subtarea" else "")
            alertas.append(dict(clave=f"critica-{t['id']}-{req['id']}-{date.today()}", nivel="aviso",
                                titulo="Dependencia en ruta crítica", tarea_id=req["tarea_id"],
                                mensaje=f"«{t['titulo']}» ({cuando}) sigue esperando «{nombre}»."))
    for m in metas:
        if m["estado"] != "activa":
            continue
        dr = m["dias_restantes"]
        if dr is not None and dr < 0 and m["progreso_pct"] < 100:
            alertas.append(dict(clave=f"meta-vencida-{m['id']}", nivel="peligro", titulo="Meta de aprendizaje vencida",
                                meta_id=m["id"],
                                mensaje=f"{m['herramienta']}: la fecha objetivo pasó con {m['progreso_pct']}% de avance."))
        elif dr is not None and dr <= 14 and m["progreso_pct"] < 70:
            alertas.append(dict(clave=f"meta-riesgo-{m['id']}-{date.today()}", nivel="aviso",
                                titulo="Meta en riesgo", meta_id=m["id"],
                                mensaje=f"{m['herramienta']}: quedan {dr} días y vas en {m['progreso_pct']}%."))
        ult = m["ultima_practica"]
        if not ult or (date.today() - date.fromisoformat(ult)).days >= 7:
            alertas.append(dict(clave=f"meta-inactiva-{m['id']}-{date.today()}", nivel="info",
                                titulo="Retoma tu aprendizaje", meta_id=m["id"],
                                mensaje=f"No registras práctica de {m['herramienta']} hace 7 días o más."))
    orden = {"peligro": 0, "aviso": 1, "info": 2}
    alertas.sort(key=lambda a: orden[a["nivel"]])
    return jsonify(alertas)


# ───────────────────────── otros ─────────────────────────
@app.get("/api/frase")
def api_frase():
    return jsonify(frase_aleatoria() if request.args.get("aleatoria") else frase_del_dia())


@app.get("/api/historial")
def api_historial():
    limite = max(1, min(2000, int(request.args.get("limite", 300))))
    with db.conexion() as conn:
        filas = conn.execute(
            "SELECT e.*, t.titulo, t.prioridad, t.categoria FROM eventos e "
            "JOIN tareas t ON t.id = e.tarea_id ORDER BY e.momento DESC, e.id DESC LIMIT ?", (limite,))
        return jsonify([dict(f) for f in filas])


def _csv(nombre, filas, columnas):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columnas, delimiter=";", extrasaction="ignore")
    w.writeheader()
    w.writerows(filas)
    return Response("\ufeff" + buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={nombre}"})


@app.get("/api/exportar/tareas.csv")
def api_exportar_tareas():
    with db.conexion() as conn:
        filas = listar_tareas(conn, incluir_cerradas=True)
    cols = ["id", "titulo", "prioridad", "categoria", "estado", "es_rana", "meta_nombre", "creada_en",
            "iniciada_en", "completada_en", "fecha_limite", "estimado_min", "tiempo_real_min", "entregable", "entregable_listo", "bloqueada", "subtareas_total", "subtareas_hechas", "progreso_pct",
            "ciclo_horas", "dias_atraso", "completada_a_tiempo"]
    return _csv("tareas.csv", filas, cols)


@app.get("/api/exportar/eventos.csv")
def api_exportar_eventos():
    with db.conexion() as conn:
        filas = [dict(r) for r in conn.execute(
            "SELECT e.*, t.titulo FROM eventos e JOIN tareas t ON t.id=e.tarea_id ORDER BY e.momento")]
    return _csv("eventos.csv", filas,
                ["id", "tarea_id", "titulo", "tipo", "estado_anterior", "estado_nuevo", "detalle", "momento"])


@app.post("/api/respaldo")
def api_respaldo():
    ruta = db.respaldar()
    return jsonify(ok=True, archivo=os.path.basename(ruta))


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


# ───────────────────────── arranque ─────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Mi Foco — gestor local de tareas")
    ap.add_argument("--puerto", type=int, default=int(os.environ.get("MIFOCO_PUERTO", 5050)))
    ap.add_argument("--sin-navegador", action="store_true", help="No abrir el navegador al iniciar")
    args = ap.parse_args()

    db.init_db()
    db.respaldo_diario()
    url = f"http://127.0.0.1:{args.puerto}"
    print(f"\n  ◎ Mi Foco corriendo en {url}\n  Base de datos: {db.DB_PATH}\n  Ctrl+C para detener.\n")
    if not args.sin_navegador:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        from waitress import serve
        serve(app, host="127.0.0.1", port=args.puerto, threads=4)
    except ImportError:
        app.run(host="127.0.0.1", port=args.puerto, debug=False)


db.init_db()

if __name__ == "__main__":
    main()

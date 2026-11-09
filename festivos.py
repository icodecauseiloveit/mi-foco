"""Festivos de Colombia.

1. Se consultan en la API pública Nager.Date (https://date.nager.at), sin clave.
2. Lo que devuelve la API se guarda en la base de datos (tabla `festivos`) para no
   volver a consultarla ese año.
3. Si no hay conexión (o la red bloquea el sitio), se calculan localmente con las
   reglas colombianas: Ley 51 de 1983 («Ley Emiliani») y las fechas de Semana Santa.
"""
import json
import urllib.request
from datetime import date, timedelta

API_URL = "https://date.nager.at/api/v3/PublicHolidays/{anio}/CO"
_calculados = {}  # caché en memoria de los años calculados sin conexión


def _pascua(anio):
    """Domingo de Pascua (algoritmo anónimo gregoriano)."""
    a, b, c = anio % 19, anio // 100, anio % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(anio, mes, dia)


def _al_lunes(d):
    """Ley Emiliani: si no cae lunes, se traslada al lunes siguiente."""
    return d + timedelta(days=(7 - d.weekday()) % 7)


def calcular(anio):
    """Festivos de Colombia calculados localmente: {fecha_iso: nombre}."""
    p = _pascua(anio)
    lista = [
        (date(anio, 1, 1), "Año Nuevo"),
        (_al_lunes(date(anio, 1, 6)), "Día de los Reyes Magos"),
        (_al_lunes(date(anio, 3, 19)), "Día de San José"),
        (p - timedelta(days=3), "Jueves Santo"),
        (p - timedelta(days=2), "Viernes Santo"),
        (date(anio, 5, 1), "Día del Trabajo"),
        (_al_lunes(p + timedelta(days=39)), "Ascensión del Señor"),
        (_al_lunes(p + timedelta(days=60)), "Corpus Christi"),
        (_al_lunes(p + timedelta(days=68)), "Sagrado Corazón de Jesús"),
        (_al_lunes(date(anio, 6, 29)), "San Pedro y San Pablo"),
        (date(anio, 7, 20), "Día de la Independencia"),
        (date(anio, 8, 7), "Batalla de Boyacá"),
        (_al_lunes(date(anio, 8, 15)), "La Asunción de la Virgen"),
        (_al_lunes(date(anio, 10, 12)), "Día de la Raza"),
        (_al_lunes(date(anio, 11, 1)), "Día de Todos los Santos"),
        (_al_lunes(date(anio, 11, 11)), "Independencia de Cartagena"),
        (date(anio, 12, 8), "Día de la Inmaculada Concepción"),
        (date(anio, 12, 25), "Navidad"),
    ]
    festivos = {}
    for d, nombre in sorted(lista):  # dos festivos el mismo lunes (p. ej. 30 jun 2025): se muestran ambos
        k = d.isoformat()
        festivos[k] = f"{festivos[k]} · {nombre}" if k in festivos else nombre
    return festivos


def _desde_api(anio, timeout=4):
    req = urllib.request.Request(API_URL.format(anio=anio),
                                 headers={"Accept": "application/json", "User-Agent": "MiFoco/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        datos = json.loads(r.read().decode("utf-8"))
    festivos = {}
    for f in datos:
        if f.get("global", True) and "Public" in (f.get("types") or ["Public"]):
            nombre = f.get("localName") or f.get("name") or "Festivo"
            festivos[f["date"]] = f"{festivos[f['date']]} · {nombre}" if f["date"] in festivos else nombre
    if not festivos:
        raise ValueError("La API no devolvió festivos")
    return festivos


def obtener(conn, anio):
    """Devuelve ({fecha_iso: nombre}, fuente). fuente: 'api', 'guardado' o 'calculado'."""
    filas = conn.execute("SELECT fecha, nombre FROM festivos WHERE anio=? ORDER BY fecha", (anio,)).fetchall()
    if filas:
        return {r["fecha"]: r["nombre"] for r in filas}, "guardado"
    if anio in _calculados:
        return _calculados[anio], "calculado"
    try:
        festivos = _desde_api(anio)
    except Exception:  # sin red, sitio bloqueado, respuesta inesperada…
        _calculados[anio] = calcular(anio)
        return _calculados[anio], "calculado"
    conn.executemany("INSERT OR REPLACE INTO festivos (anio, fecha, nombre) VALUES (?,?,?)",
                     [(anio, f, n) for f, n in festivos.items()])
    return festivos, "api"


def refrescar(conn, anio):
    """Olvida lo guardado de un año para volver a consultar la API."""
    conn.execute("DELETE FROM festivos WHERE anio=?", (anio,))
    _calculados.pop(anio, None)
    return obtener(conn, anio)

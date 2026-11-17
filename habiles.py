"""Calendario hábil de Colombia: lunes a viernes, sin festivos.

Los retrasos, el ciclo, la racha, el tiempo que queda para una fecha límite y los plazos de las metas se
miden en tiempo hábil: los sábados, domingos y festivos no cuentan. Un día hábil vale 24 horas, así que
«1 día de atraso» es un día hábil completo.

Los festivos de un año se cargan de la base (o de la API Nager.Date la primera vez) con `cargar(conn)`.
Si un año no está cargado, se calcula localmente con la Ley Emiliani, sin conexión.
"""
from datetime import date, datetime, timedelta

import festivos as festivos_co

_festivos = {}  # año → set de fechas ISO


def cargar(conn, anios=None):
    """Carga los festivos de los años indicados (por defecto, el anterior, el actual y el siguiente)."""
    hoy = date.today()
    for a in anios or (hoy.year - 1, hoy.year, hoy.year + 1):
        if a not in _festivos:
            try:
                _festivos[a] = set(festivos_co.obtener(conn, a)[0])
            except Exception:  # base ocupada o error inesperado: cálculo local
                _festivos[a] = set(festivos_co.calcular(a))


def olvidar(anio=None):
    """Descarta lo cargado (p. ej. después de actualizar los festivos de un año desde la API)."""
    if anio is None:
        _festivos.clear()
    else:
        _festivos.pop(anio, None)


def _del_anio(anio):
    if anio not in _festivos:
        _festivos[anio] = set(festivos_co.calcular(anio))
    return _festivos[anio]


def es_habil(d):
    if isinstance(d, datetime):
        d = d.date()
    return d.weekday() < 5 and d.isoformat() not in _del_anio(d.year)


def segundos_habiles(ini, fin):
    """Segundos entre dos momentos contando solo los días hábiles (0 si fin <= ini)."""
    if not ini or not fin or fin <= ini:
        return 0.0
    total, cursor = 0.0, ini
    while cursor < fin:
        manana = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time())
        tramo_fin = min(manana, fin)
        if es_habil(cursor):
            total += (tramo_fin - cursor).total_seconds()
        cursor = tramo_fin
    return total


def dias_habiles(ini, fin):
    """Días hábiles (con decimales) entre dos momentos."""
    return segundos_habiles(ini, fin) / 86400


def horas_habiles(ini, fin):
    return segundos_habiles(ini, fin) / 3600


def contar_dias_habiles(desde, hasta):
    """Cuántas fechas hábiles hay entre `desde` (excluida) y `hasta` (incluida). Negativo si hasta < desde."""
    if hasta == desde:
        return 0
    signo = 1 if hasta > desde else -1
    a, b = (desde, hasta) if signo > 0 else (hasta, desde)
    n, d = 0, a + timedelta(days=1)
    while d <= b:
        n += es_habil(d)
        d += timedelta(days=1)
    return signo * n


def habil_anterior(d):
    """El día hábil anterior a `d` (sin incluirlo)."""
    d -= timedelta(days=1)
    while not es_habil(d):
        d -= timedelta(days=1)
    return d

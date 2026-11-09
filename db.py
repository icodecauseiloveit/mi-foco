"""Capa de base de datos (SQLite local) para Mi Foco."""
import os
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("MIFOCO_DB", os.path.join(BASE_DIR, "data", "mifoco.db"))
RESPALDOS_DIR = os.path.join(os.path.dirname(DB_PATH), "respaldos")
ADJUNTOS_DIR = os.path.join(os.path.dirname(DB_PATH), "adjuntos")

SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS metas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    herramienta     TEXT NOT NULL,
    descripcion     TEXT DEFAULT '',
    categoria       TEXT DEFAULT 'Herramienta',
    nivel_actual    INTEGER DEFAULT 1 CHECK (nivel_actual BETWEEN 1 AND 5),
    nivel_objetivo  INTEGER DEFAULT 3 CHECK (nivel_objetivo BETWEEN 1 AND 5),
    horas_objetivo  REAL DEFAULT 20,
    fecha_inicio    TEXT,
    fecha_objetivo  TEXT,
    estado          TEXT DEFAULT 'activa' CHECK (estado IN ('activa','pausada','lograda')),
    creada_en       TEXT NOT NULL,
    actualizada_en  TEXT,
    lograda_en      TEXT
);

CREATE TABLE IF NOT EXISTS hitos_meta (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    meta_id        INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
    titulo         TEXT NOT NULL,
    completado     INTEGER DEFAULT 0,
    completado_en  TEXT,
    orden          INTEGER DEFAULT 0,
    creado_en      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registros_aprendizaje (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    meta_id    INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
    fecha      TEXT NOT NULL,
    minutos    INTEGER NOT NULL CHECK (minutos > 0),
    nota       TEXT DEFAULT '',
    creado_en  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tareas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo          TEXT NOT NULL,
    descripcion     TEXT DEFAULT '',
    prioridad       TEXT DEFAULT 'B' CHECK (prioridad IN ('A','B','C','D','E')),
    categoria       TEXT DEFAULT 'General',
    estado          TEXT DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','en_progreso','pausada','completada','cancelada')),
    es_rana         INTEGER DEFAULT 0,
    estimado_min    INTEGER,
    fecha_limite    TEXT,
    meta_id         INTEGER REFERENCES metas(id) ON DELETE SET NULL,
    creada_en       TEXT NOT NULL,
    iniciada_en     TEXT,
    completada_en   TEXT,
    actualizada_en  TEXT,
    alerta_vencida  INTEGER DEFAULT 0,
    eliminada       INTEGER DEFAULT 0,
    eliminada_en    TEXT
);

-- Cada vez que se trabaja en una tarea (iniciar -> pausar/completar) queda una sesión.
CREATE TABLE IF NOT EXISTS sesiones (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id  INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
    inicio    TEXT NOT NULL,
    fin       TEXT,
    minutos   REAL,
    manual    INTEGER DEFAULT 0
);

-- Bitácora histórica: todo lo que le pasa a una tarea.
CREATE TABLE IF NOT EXISTS eventos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id         INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
    tipo             TEXT NOT NULL,
    estado_anterior  TEXT,
    estado_nuevo     TEXT,
    detalle          TEXT,
    momento          TEXT NOT NULL
);

-- Pasos de una tarea que se completan por separado; definen su % de avance.
CREATE TABLE IF NOT EXISTS subtareas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id       INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
    titulo         TEXT NOT NULL,
    completada     INTEGER DEFAULT 0,
    completada_en  TEXT,
    orden          INTEGER DEFAULT 0,
    creada_en      TEXT NOT NULL,
    es_entregable  INTEGER DEFAULT 0   -- la subtarea que representa el entregable de la tarea (va al final)
);
CREATE INDEX IF NOT EXISTS ix_subtareas_tarea ON subtareas(tarea_id);

-- Una tarea puede esperar a otra tarea completa o a una subtarea específica.
CREATE TABLE IF NOT EXISTS dependencias (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id             INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
    depende_tarea_id     INTEGER REFERENCES tareas(id) ON DELETE CASCADE,
    depende_subtarea_id  INTEGER REFERENCES subtareas(id) ON DELETE CASCADE,
    creada_en            TEXT NOT NULL,
    CHECK ((depende_tarea_id IS NULL) <> (depende_subtarea_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dependencias
    ON dependencias(tarea_id, COALESCE(depende_tarea_id, 0), COALESCE(depende_subtarea_id, 0));
CREATE INDEX IF NOT EXISTS ix_dep_tarea ON dependencias(depende_tarea_id);
CREATE INDEX IF NOT EXISTS ix_dep_subtarea ON dependencias(depende_subtarea_id);

-- Notas libres sobre una tarea (avances, acuerdos, bloqueos…).
CREATE TABLE IF NOT EXISTS comentarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id    INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
    texto       TEXT NOT NULL,
    creado_en   TEXT NOT NULL,
    editado_en  TEXT
);
CREATE INDEX IF NOT EXISTS ix_comentarios_tarea ON comentarios(tarea_id);

-- Soporte de la tarea: archivos (guardados en data/adjuntos) o enlaces.
CREATE TABLE IF NOT EXISTS adjuntos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tarea_id    INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('archivo','enlace')),
    nombre      TEXT NOT NULL,      -- nombre original del archivo o título del enlace
    url         TEXT,               -- solo enlaces
    archivo     TEXT,               -- nombre interno en disco (solo archivos)
    tamano      INTEGER,
    mime        TEXT,
    creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_adjuntos_tarea ON adjuntos(tarea_id);

-- Festivos de Colombia obtenidos de la API (caché por año).
CREATE TABLE IF NOT EXISTS festivos (
    fecha   TEXT PRIMARY KEY,
    anio    INTEGER NOT NULL,
    nombre  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_festivos_anio ON festivos(anio);

-- Catálogos reutilizables al crear tareas.
CREATE TABLE IF NOT EXISTS categorias (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    usos        INTEGER DEFAULT 0,
    creada_en   TEXT NOT NULL,
    usada_en    TEXT,
    icono       TEXT,          -- emoji
    imagen      BLOB,          -- imagen propia (PNG 96x96 generada en el navegador)
    imagen_tipo TEXT,
    actualizada_en TEXT
);

CREATE TABLE IF NOT EXISTS descripciones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    texto       TEXT NOT NULL UNIQUE,
    usos        INTEGER DEFAULT 0,
    creada_en   TEXT NOT NULL,
    usada_en    TEXT
);

CREATE INDEX IF NOT EXISTS ix_tareas_estado ON tareas(estado, eliminada);
CREATE INDEX IF NOT EXISTS ix_eventos_tarea ON eventos(tarea_id);
CREATE INDEX IF NOT EXISTS ix_eventos_momento ON eventos(momento);
CREATE INDEX IF NOT EXISTS ix_sesiones_tarea ON sesiones(tarea_id);
CREATE INDEX IF NOT EXISTS ix_registros_meta ON registros_aprendizaje(meta_id);
"""


def ahora() -> str:
    """Fecha-hora local en ISO (sin zona), precisión de segundos."""
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def conexion():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _agregar_columnas(conn, tabla, columnas):
    existentes = {r["name"] for r in conn.execute(f"PRAGMA table_info({tabla})")}
    for nombre, tipo in columnas.items():
        if nombre not in existentes:
            conn.execute(f"ALTER TABLE {tabla} ADD COLUMN {nombre} {tipo}")


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with conexion() as conn:
        conn.executescript(SCHEMA)
        # Migraciones: columnas agregadas en versiones posteriores.
        _agregar_columnas(conn, "categorias", {
            "icono": "TEXT", "imagen": "BLOB", "imagen_tipo": "TEXT", "actualizada_en": "TEXT",
        })
        _agregar_columnas(conn, "subtareas", {"es_entregable": "INTEGER DEFAULT 0"})
        _agregar_columnas(conn, "tareas", {"duplicada_de": "INTEGER"})  # id de la tarea original
        _agregar_columnas(conn, "sesiones", {"subtarea_id": "INTEGER"})  # sesión cronometrada en una subtarea
        # Primera vez con catálogos: se cargan con lo que ya existe en las tareas.
        if conn.execute("SELECT COUNT(*) FROM categorias").fetchone()[0] == 0:
            conn.execute(
                "INSERT OR IGNORE INTO categorias (nombre, usos, creada_en, usada_en) "
                "SELECT TRIM(categoria), COUNT(*), MIN(creada_en), MAX(creada_en) FROM tareas "
                "WHERE TRIM(COALESCE(categoria,'')) <> '' GROUP BY TRIM(categoria) COLLATE NOCASE")
            conn.execute("INSERT OR IGNORE INTO categorias (nombre, creada_en) VALUES ('General', ?)", (ahora(),))
        if conn.execute("SELECT COUNT(*) FROM descripciones").fetchone()[0] == 0:
            conn.execute(
                "INSERT OR IGNORE INTO descripciones (texto, usos, creada_en, usada_en) "
                "SELECT TRIM(descripcion), COUNT(*), MIN(creada_en), MAX(creada_en) FROM tareas "
                "WHERE TRIM(COALESCE(descripcion,'')) <> '' GROUP BY TRIM(descripcion)")


def respaldar(conservar: int = 15) -> str:
    """Copia consistente de la base en data/respaldos. Conserva los últimos N."""
    os.makedirs(RESPALDOS_DIR, exist_ok=True)
    destino = os.path.join(RESPALDOS_DIR, f"mifoco_{datetime.now():%Y%m%d_%H%M%S}.db")
    origen = sqlite3.connect(DB_PATH)
    copia = sqlite3.connect(destino)
    with copia:
        origen.backup(copia)
    origen.close()
    copia.close()
    archivos = sorted(f for f in os.listdir(RESPALDOS_DIR) if f.endswith(".db"))
    for viejo in archivos[:-conservar]:
        try:
            os.remove(os.path.join(RESPALDOS_DIR, viejo))
        except OSError:
            pass
    return destino


def respaldo_diario():
    """Hace un respaldo al arrancar si hoy todavía no hay uno."""
    if not os.path.exists(DB_PATH):
        return
    hoy = f"mifoco_{datetime.now():%Y%m%d}_"
    if os.path.isdir(RESPALDOS_DIR) and any(f.startswith(hoy) for f in os.listdir(RESPALDOS_DIR)):
        return
    respaldar()

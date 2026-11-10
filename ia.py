"""Asistente con IA (OpenAI) para Mi Foco. Es opcional.

Se activa solo si el archivo .env (junto a app.py) tiene OPENAI_API_KEY. Sin clave, la app
funciona igual y los botones ✨ no aparecen. La clave se usa únicamente desde este servidor
local: nunca se envía al navegador.

Variables del .env:
    OPENAI_API_KEY            (obligatoria para activar la IA)
    OPENAI_MODEL              modelo a usar; por defecto gpt-5-mini
    OPENAI_REASONING_EFFORT   esfuerzo de razonamiento (low por defecto; vacío = no se envía)
    OPENAI_BASE_URL           otro endpoint compatible (por defecto https://api.openai.com/v1)
    MIFOCO_CONTEXTO           una o dos frases sobre tu trabajo, para que las respuestas usen tu contexto
    MIFOCO_FIN_JORNADA        hora en que termina tu jornada, para planear el día (por defecto 17:00)
"""
import json
import os
import socket
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.abspath(__file__))
MODELO_DEFECTO = "gpt-5-mini"
TIEMPO_ESPERA = 90  # segundos


class ErrorIA(Exception):
    """Error con un mensaje listo para mostrarle al usuario."""


def cargar_env(ruta=os.path.join(RAIZ, ".env")):
    """Lee KEY=VALOR del archivo .env. Las variables que ya existan en el sistema tienen prioridad."""
    if not os.path.exists(ruta):
        return
    with open(ruta, encoding="utf-8-sig") as f:
        for linea in f:
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            if linea.startswith("export "):
                linea = linea[7:]
            k, v = linea.split("=", 1)
            k, v = k.strip(), v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            else:
                v = v.split(" #", 1)[0].strip()
            if k:
                os.environ.setdefault(k, v)


def clave():
    return os.environ.get("OPENAI_API_KEY", "").strip()


def modelo():
    return os.environ.get("OPENAI_MODEL", "").strip() or MODELO_DEFECTO


def activa():
    return bool(clave())


def contexto_usuario():
    return os.environ.get("MIFOCO_CONTEXTO", "").strip()


def fin_jornada():
    return os.environ.get("MIFOCO_FIN_JORNADA", "").strip() or "17:00"


def _url():
    return (os.environ.get("OPENAI_BASE_URL", "").strip() or "https://api.openai.com/v1").rstrip("/")


def _mensaje_error(codigo, detalle):
    if codigo == 401:
        return "La clave de OpenAI no es válida. Revisa OPENAI_API_KEY en el archivo .env y reinicia Mi Foco."
    if codigo == 429:
        return ("OpenAI rechazó la solicitud por límite de uso o falta de saldo (429). "
                "Revisa la facturación de tu cuenta en platform.openai.com o intenta en un momento.")
    if codigo == 404 or "model" in detalle.lower() and "exist" in detalle.lower():
        return f"El modelo «{modelo()}» no está disponible para tu cuenta. Cambia OPENAI_MODEL en el archivo .env."
    if codigo == 0:
        return f"No se pudo conectar con OpenAI ({detalle}). Revisa tu conexión a internet o el proxy."
    return f"OpenAI respondió con un error ({codigo}): {detalle or 'sin detalle'}"


def _post(cuerpo):
    req = urllib.request.Request(
        _url() + "/chat/completions", data=json.dumps(cuerpo).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {clave()}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIEMPO_ESPERA) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            det = json.loads(e.read().decode("utf-8")).get("error") or {}
        except (ValueError, AttributeError):
            det = {}
        err = ErrorIA(_mensaje_error(e.code, det.get("message") or ""))
        err.codigo, err.param = e.code, det.get("param") or ""
        err.texto = det.get("message") or ""
        raise err
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
        motivo = getattr(e, "reason", e)
        if isinstance(motivo, (socket.timeout, TimeoutError)) or isinstance(e, (socket.timeout, TimeoutError)):
            raise ErrorIA("OpenAI tardó demasiado en responder. Intenta de nuevo.")
        raise ErrorIA(_mensaje_error(0, str(motivo)))


def chat(sistema, usuario, esquema=None, max_tokens=4000):
    """Envía un mensaje al modelo. Con `esquema` ({"nombre", "schema"}) devuelve un dict validado
    por OpenAI (structured outputs); sin él, devuelve texto."""
    if not activa():
        raise ErrorIA("La IA no está configurada: agrega OPENAI_API_KEY al archivo .env y reinicia Mi Foco.")
    if contexto_usuario():
        sistema += f"\n\nContexto del usuario: {contexto_usuario()}"
    cuerpo = {
        "model": modelo(),
        "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}],
        "max_completion_tokens": max_tokens,
    }
    esfuerzo = os.environ.get("OPENAI_REASONING_EFFORT", "low").strip()
    if esfuerzo:
        cuerpo["reasoning_effort"] = esfuerzo
    if esquema:
        cuerpo["response_format"] = {"type": "json_schema", "json_schema": {
            "name": esquema["nombre"], "strict": True, "schema": esquema["schema"]}}
    try:
        datos = _post(cuerpo)
    except ErrorIA as e:
        # Modelos sin razonamiento (p. ej. gpt-4.1) no aceptan reasoning_effort: se reintenta sin él.
        if getattr(e, "codigo", None) == 400 and "reasoning" in (e.param + e.texto).lower() and "reasoning_effort" in cuerpo:
            cuerpo.pop("reasoning_effort")
            datos = _post(cuerpo)
        else:
            raise
    try:
        eleccion = datos["choices"][0]
        mensaje = eleccion["message"]
    except (KeyError, IndexError, TypeError):
        raise ErrorIA("OpenAI devolvió una respuesta inesperada.")
    if mensaje.get("refusal"):
        raise ErrorIA(f"El modelo no respondió: {mensaje['refusal']}")
    contenido = (mensaje.get("content") or "").strip()
    if not contenido:
        if eleccion.get("finish_reason") == "length":
            raise ErrorIA("La respuesta se cortó por longitud. Intenta de nuevo o baja OPENAI_REASONING_EFFORT.")
        raise ErrorIA("El modelo devolvió una respuesta vacía. Intenta de nuevo.")
    if not esquema:
        return contenido
    try:
        return json.loads(contenido)
    except ValueError:
        raise ErrorIA("El modelo devolvió datos con formato inválido. Intenta de nuevo.")


def objeto(propiedades):
    """Esquema JSON estricto: todos los campos obligatorios y sin campos extra."""
    return {"type": "object", "properties": propiedades, "required": list(propiedades), "additionalProperties": False}


TEXTO = {"type": "string"}

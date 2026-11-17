"""Abrir un correo NUEVO en formato HTML en el programa de correo del PC (para revisarlo y enviarlo).

Un enlace mailto: solo admite texto plano, así que el correo se abre desde este servidor local:
  1. Outlook clásico (Windows): se crea el correo por automatización (pywin32) y se muestra, con la firma
     predeterminada del usuario debajo del contenido.
  2. Si no hay Outlook clásico o pywin32: se guarda un borrador .eml (HTML, con «X-Unsent: 1») y se abre con
     el programa de correo predeterminado. Outlook clásico lo abre como correo nuevo listo para enviar.
"""
import glob
import os
import re
import subprocess
import sys
import time
from email.message import EmailMessage
from email.policy import SMTP

import db

CARPETA = os.path.join(os.path.dirname(db.DB_PATH), "correos")


def _cuerpo(html):
    """Lo que va dentro de <body> (para insertarlo antes de la firma de Outlook)."""
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S | re.I)
    return m.group(1) if m else html


def _con_outlook(asunto, html, para, cc):
    import pythoncom  # noqa: F401  (pywin32; ImportError si no está instalado)
    import win32com.client
    pythoncom.CoInitialize()  # el servidor atiende cada petición en un hilo propio
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        item = outlook.CreateItem(0)  # 0 = olMailItem
        if para:
            item.To = para
        if cc:
            item.CC = cc
        item.Subject = asunto
        item.BodyFormat = 2  # olFormatHTML
        item.Display()  # al mostrarlo, Outlook agrega la firma predeterminada en HTMLBody
        firma = item.HTMLBody or ""
        contenido = _cuerpo(html)
        m = re.search(r"<body[^>]*>", firma, re.I)
        item.HTMLBody = (firma[:m.end()] + contenido + firma[m.end():]) if m else html
    finally:
        pythoncom.CoUninitialize()


def _guardar_eml(asunto, html, texto, para, cc):
    os.makedirs(CARPETA, exist_ok=True)
    # Limpieza: los borradores de más de 7 días ya no hacen falta.
    for viejo in glob.glob(os.path.join(CARPETA, "*.eml")):
        if time.time() - os.path.getmtime(viejo) > 7 * 86400:
            try:
                os.remove(viejo)
            except OSError:
                pass
    msg = EmailMessage(policy=SMTP)
    msg["Subject"] = asunto
    if para:
        msg["To"] = para
    if cc:
        msg["Cc"] = cc
    msg["X-Unsent"] = "1"  # Outlook lo abre como borrador para enviar, no como correo recibido
    msg.set_content(texto or "Este correo está en formato HTML.")
    msg.add_alternative(html, subtype="html")
    nombre = re.sub(r"[^\w\-]+", "_", asunto, flags=re.U).strip("_")[:60] or "correo"
    ruta = os.path.join(CARPETA, f"{time.strftime('%Y%m%d-%H%M%S')}_{nombre}.eml")
    with open(ruta, "wb") as f:
        f.write(msg.as_bytes())
    return ruta


def abrir_archivo(ruta):
    """Abre un archivo con su programa predeterminado (en el PC donde corre Mi Foco)."""
    if sys.platform.startswith("win"):
        os.startfile(ruta)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", ruta])
    else:
        subprocess.Popen(["xdg-open", ruta])


def abrir_correo(asunto, html, texto="", para="", cc=""):
    """Abre un correo nuevo en HTML. Devuelve ("outlook" | "eml", detalle)."""
    if sys.platform.startswith("win"):
        try:
            _con_outlook(asunto, html, para, cc)
            return "outlook", "Outlook"
        except Exception:  # sin pywin32, sin Outlook clásico o Outlook no responde → borrador .eml
            pass
    ruta = _guardar_eml(asunto, html, texto, para, cc)
    try:
        abrir_archivo(ruta)
    except Exception as e:
        raise ValueError(f"Se creó el borrador pero no se pudo abrir automáticamente ({e}). Está en: {ruta}")
    return "eml", ruta

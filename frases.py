"""Frases motivadoras originales, inspiradas en los principios de gestión del tiempo
popularizados por Brian Tracy (cómete la rana, método ABCDE, regla 80/20, planear
por escrito, una tarea a la vez...). Cada frase trae una práctica accionable."""
import random
from datetime import date

FRASES = [
    {"texto": "Empieza el día con la tarea que más temes; lo que venga después se sentirá liviano.",
     "principio": "Cómete la rana", "practica": "Marca una sola tarea como 🐸 y hazla antes de abrir el correo."},
    {"texto": "Cada minuto que inviertes planeando te devuelve diez cuando ejecutas.",
     "principio": "Planea por escrito", "practica": "Dedica 10 minutos a escribir la lista de mañana antes de terminar hoy."},
    {"texto": "No todo lo urgente es importante, y casi todo lo importante se ve en silencio.",
     "principio": "Urgente vs. importante", "practica": "Antes de reaccionar a algo urgente, pregúntate si es una tarea A."},
    {"texto": "El 20 % de tus tareas genera el 80 % de tus resultados. Encuéntralas y protégelas.",
     "principio": "Regla 80/20", "practica": "Revisa tu lista: ¿cuáles 2 tareas valen más que todas las demás juntas?"},
    {"texto": "Si no decides qué es lo más importante, el día lo decidirá por ti.",
     "principio": "Prioridades claras", "practica": "Asigna A, B, C, D o E a cada tarea pendiente."},
    {"texto": "Nunca hagas una tarea B mientras haya una A esperando.",
     "principio": "Método ABCDE", "practica": "Filtra tus tareas por prioridad A y empieza por la primera."},
    {"texto": "Terminar una tarea vale más que empezar cinco.",
     "principio": "Una tarea a la vez", "practica": "Cuando inicies algo, no cambies de tarea hasta completarla o pausarla a propósito."},
    {"texto": "La disciplina es elegir entre lo que quieres ahora y lo que quieres de verdad.",
     "principio": "Autodisciplina", "practica": "Identifica la distracción que más te roba tiempo y ponle una barrera hoy."},
    {"texto": "Lo que puedes delegar no debería consumir tu mejor energía.",
     "principio": "Delega (D)", "practica": "Elige una tarea D y asígnala a quien corresponda."},
    {"texto": "Eliminar una tarea inútil es tan productivo como completar una útil.",
     "principio": "Elimina (E)", "practica": "Cancela al menos una tarea E de tu lista esta semana."},
    {"texto": "Tus horas de mayor energía son para tu trabajo de mayor valor.",
     "principio": "Protege tus horas pico", "practica": "Bloquea tus primeras 2 horas productivas para tareas A."},
    {"texto": "Prepara el terreno antes de empezar: todo a la mano, nada que te frene.",
     "principio": "Prepárate antes de comenzar", "practica": "Abre solo los archivos y herramientas que necesitas para la tarea actual."},
    {"texto": "Divide lo grande en pasos tan pequeños que no puedas decir que no.",
     "principio": "Rebana la tarea", "practica": "Parte tu tarea más pesada en subtareas de menos de 45 minutos."},
    {"texto": "Un plazo claro convierte un deseo en un compromiso.",
     "principio": "Fechas límite", "practica": "Ponle fecha límite a cada tarea A que aún no la tenga."},
    {"texto": "Aprender una hora al día te pone, en pocos años, por delante de casi todos.",
     "principio": "Aprendizaje continuo", "practica": "Registra hoy al menos 30 minutos en una de tus metas de aprendizaje."},
    {"texto": "Tu habilidad más débil marca el techo de todas las demás.",
     "principio": "Mejora tus habilidades clave", "practica": "¿Qué herramienta, si la dominaras, haría más fácil todo tu trabajo? Hazla meta."},
    {"texto": "Las consecuencias a largo plazo deben guiar tus decisiones de hoy.",
     "principio": "Piensa en consecuencias", "practica": "Antes de elegir qué hacer, pregúntate qué pasa si no lo haces en 30 días."},
    {"texto": "Revisa tus metas cada mañana y tu mente buscará cómo cumplirlas todo el día.",
     "principio": "Claridad de metas", "practica": "Lee tus metas activas antes de empezar tu primera tarea."},
    {"texto": "Hacer bien lo que no hacía falta hacer sigue siendo tiempo perdido.",
     "principio": "Haz lo correcto", "practica": "Cuestiona una tarea rutinaria: ¿aporta resultado o solo costumbre?"},
    {"texto": "La sensación de terminar es adictiva; aliméntala con logros importantes.",
     "principio": "Impulso de logro", "practica": "Completa una tarea A antes del mediodía y celebra el avance."},
    {"texto": "Trabaja en bloques de tiempo sin interrupciones; la profundidad rinde más que la prisa.",
     "principio": "Bloques de concentración", "practica": "Haz una sesión de 50 minutos sin notificaciones."},
    {"texto": "Cada vez que pospones, la tarea crece en tu cabeza.",
     "principio": "Vence la procrastinación", "practica": "Inicia ya la tarea que más has reprogramado; solo 10 minutos."},
    {"texto": "El orden en tu espacio de trabajo se refleja en el orden de tus resultados.",
     "principio": "Organización", "practica": "Dedica 5 minutos a cerrar pestañas y archivos que no uses."},
    {"texto": "Mide lo que importa y mejorará solo por el hecho de mirarlo.",
     "principio": "Medición del rendimiento", "practica": "Revisa tu panel de Rendimiento y elige un indicador para mejorar esta semana."},
    {"texto": "La velocidad para actuar es una ventaja que pocos usan.",
     "principio": "Sentido de urgencia", "practica": "Si algo toma menos de 2 minutos, hazlo ahora."},
    {"texto": "Planea la semana el domingo y la semana dejará de manejarte a ti.",
     "principio": "Planificación semanal", "practica": "Define las 3 tareas A de la semana y sus fechas."},
    {"texto": "Decir no a lo secundario es decir sí a lo esencial.",
     "principio": "Aprende a decir no", "practica": "Rechaza o difiere un compromiso que no aporte a tus metas."},
    {"texto": "La energía también se gestiona: descanso hoy, rendimiento mañana.",
     "principio": "Cuida tu energía", "practica": "Toma una pausa real de 10 minutos después de 2 horas de foco."},
    {"texto": "Las personas exitosas hacen lo que otros prefieren evitar, incluso sin ganas.",
     "principio": "Hábito de acción", "practica": "Empieza tu tarea más incómoda con un primer paso de 5 minutos."},
    {"texto": "Un objetivo sin fecha ni plan es solo un buen deseo.",
     "principio": "Metas SMART", "practica": "Ponle fecha y horas objetivo a tu meta de aprendizaje más importante."},
    {"texto": "Concentra tu esfuerzo donde tienes ventaja; ahí crece tu valor.",
     "principio": "Áreas clave de resultado", "practica": "Escribe las 5 áreas en las que tu trabajo genera más valor."},
    {"texto": "Revisar lo que hiciste ayer es la mejor forma de mejorar lo que harás hoy.",
     "principio": "Revisión diaria", "practica": "Mira el historial de ayer: ¿qué se atrasó y por qué?"},
    {"texto": "La constancia vence al talento cuando el talento no es constante.",
     "principio": "Hábitos", "practica": "Mantén tu racha: completa al menos una tarea hoy."},
    {"texto": "Si una tarea vale la pena, vale la pena estimarla.",
     "principio": "Estima tus tiempos", "practica": "Pon tiempo estimado a tus tareas y compáralo con el real."},
    {"texto": "La primera hora de la mañana es el timón del día.",
     "principio": "Rutina matutina", "practica": "No revises mensajes hasta haber avanzado en tu rana."},
    {"texto": "Lo que se escribe se cumple con más frecuencia que lo que solo se piensa.",
     "principio": "Lista escrita", "practica": "Saca de tu cabeza todo pendiente y anótalo en la lista."},
]


def frase_del_dia(fecha=None) -> dict:
    fecha = fecha or date.today()
    f = dict(FRASES[fecha.toordinal() % len(FRASES)])
    f["fecha"] = fecha.isoformat()
    return f


def frase_aleatoria() -> dict:
    f = dict(random.choice(FRASES))
    f["fecha"] = date.today().isoformat()
    return f

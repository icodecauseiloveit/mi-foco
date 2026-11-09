# ◎ Mi Foco — gestor local de tareas, tiempo y metas de aprendizaje

Servicio en Python (Flask + SQLite) que corre **100 % en tu equipo** y se usa desde el navegador en
`http://127.0.0.1:5050`. Nada sale a internet: la interfaz no usa CDN ni librerías externas.

## Arranque rápido

**Windows:** doble clic en `iniciar.bat`. La primera vez crea un entorno virtual (`.venv`) e instala Flask y Waitress; luego abre el navegador.

**Manual (cualquier sistema, Python 3.9+):**
```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python app.py                   # opciones: --puerto 8080  --sin-navegador
```

### Que arranque solo al encender el PC (Windows)
1. Ejecuta `iniciar.bat` una vez (para crear `.venv`).
2. `Win + R` → `shell:startup` → crea ahí un **acceso directo** a `iniciar_oculto.vbs`.
3. Queda corriendo en segundo plano sin consola; abre `http://127.0.0.1:5050` cuando quieras
   (te sugiero guardarlo como favorito o "instalarlo" como app desde el menú de Edge/Chrome).

## Qué hace

| Módulo | Funciones |
|---|---|
| **Hoy** | Ocupa exactamente la pantalla, sin scroll de página: frase del día e indicadores arriba, rana y captura rápida en medio, y tres paneles (En curso, Vencidas/por vencer, Otras A) que se desplazan por dentro si tienen muchas tareas. Frase del día (principio + práctica accionable), tu 🐸 *rana* del día, KPIs, captura rápida, tareas en curso, vencidas/por vencer y otras A. |
| **Tareas** | CRUD completo, prioridad **ABCDE**, categoría, fecha límite, tiempo estimado, vínculo a una meta, filtros y búsqueda. Iniciar / pausar / completar / reabrir / cancelar. |
| **Categorías y descripciones** | Se guardan solas en la base cada vez que las usas. Al crear una tarea eliges la categoría de una lista (o "＋ Nueva categoría…") y puedes cargar una descripción guardada. Desde *🏷 Categorías y descripciones* (barra lateral) agregas, renombras (actualiza todas sus tareas) o quitas. Cada categoría puede llevar un **emoji o una imagen propia** (se recorta a 96×96 y se guarda en la base), que se muestra en las tareas, filtros y estadísticas. |
| **Entregable** | Al crear una tarea se pregunta qué debe existir para darla por terminada (📦). Se guarda como la última subtarea, marcada como entregable, y cuenta en el % de avance. Si creas una tarea sin entregable, te lo recuerda. Puedes cambiarlo o quitarlo al editar. |
| **Subtareas** | Al crear o editar una tarea agregas subtareas (Enter agrega otra; puedes pegar una lista). Cada una se marca por separado y la tarea muestra su avance (1 de 3 = 33 %). Cada marca queda en el historial con fecha y hora; la fecha de una subtarea completada (✅ fecha ✎) también se puede cambiar con un clic si la terminaste antes de marcarla. Al completar la última te ofrece cerrar la tarea; si cierras la tarea con subtareas pendientes, te avisa cuáles faltan. |
| **Dependencias** | Una tarea puede esperar a otra tarea completa o a una subtarea específica ("Depende de" en el formulario). Mientras falte algo queda 🔒 bloqueada: se ve rayada, el filtro *Bloqueadas / Disponibles* la separa e iniciarla o completarla pide confirmación. La tarea requisito muestra "⛓ Frena a N". Al terminar lo que faltaba se avisa 🔓 *Ya puedes empezar*. Se impiden los ciclos (A espera a B y B espera a A). Alerta de *ruta crítica* si una tarea bloqueada vence en menos de 48 h. |
| **Registrar lo ya hecho** | Al crear una tarea marca *✅ Ya está completada* e indica fecha y hora de completado (no puede ser futura) y, si quieres, el tiempo dedicado. Se calcula si fue a tiempo frente a su fecha límite y cuenta en las estadísticas de ese día. En cualquier tarea completada la fecha aparece como **✅ fecha ✎**: haz clic en ella (en la tarjeta o en el detalle) para poner otra, con atajos Ayer / Hace 2 días / Hace una semana. Queda en el historial y se recalcula si fue a tiempo. |
| **Reporte de cumplimiento** | *📤 Reporte de cumplimiento* (barra lateral) genera una imagen PNG lista para el correo: periodo (esta semana, semana pasada, este mes, mes pasado o fechas libres), categoría opcional y "Preparado por". Incluye cumplimiento del plan, entregas a tiempo, completadas, en curso/pendientes, vencidas, avance general y la tabla de actividades con prioridad, estado, avance y fechas; bajo cada actividad que tenga comentarios aparece el **último comentario** con su fecha (💬). *📋 Copiar imagen* la deja en el portapapeles para pegarla con Ctrl + V en Outlook/Gmail; también se puede descargar. Se dibuja en el navegador, sin servicios externos. |
| **Soporte (archivos y enlaces)** | En el detalle de cada tarea, sección *Soporte*: arrastra archivos (PDF, Excel, Word, imágenes, correos…; máx. 50 MB c/u) o pega enlaces (SharePoint, OneDrive, web). Los PDF e imágenes se abren en el navegador; los demás se descargan. La etiqueta **📎 N** en la tarjeta lleva directo ahí. Los archivos se guardan en `data/adjuntos/`. |
| **Comentarios** | Cada tarea tiene una sección de comentarios en su detalle (avances, acuerdos, bloqueos…), con fecha y hora; se pueden editar o borrar. El botón 💬 de la tarjeta abre directo ahí, y la etiqueta **💬 N** muestra cuántos tiene. *Ctrl + Enter* guarda. |
| **Cronómetro** | Cada *Iniciar → Pausar/Completar* crea una sesión de trabajo. **Una tarea a la vez**: al iniciar otra, la anterior se pausa sola. Si completas sin cronometrar te pregunta cuántos minutos le dedicaste. |
| **Metas de aprendizaje** | Herramienta, nivel actual → objetivo (1‑5), horas objetivo, fecha, hitos con checklist y registro de práctica. El progreso combina horas y hitos; calcula el **ritmo semanal necesario**. Las horas de tareas vinculadas también suman. |
| **Rendimiento** | Puntaje 0‑100, entregas a tiempo, atraso promedio, ciclo promedio, real vs. estimado, racha, foco en lo vital (80/20), reprogramaciones, gráficos diarios y por prioridad/categoría (7 a 365 días). |
| **Historial** | Bitácora de cada evento: creada, iniciada, pausada, reanudada, reprogramada, venció, completada (a tiempo o con atraso), reabierta, cancelada, eliminada. |
| **Alertas** | Vencidas, vencen en < 24 h, rana sin empezar después de las 11 a. m., sesión de más de 90 min (descanso), metas en riesgo o vencidas, metas sin práctica en 7 días. Notificaciones del sistema (actívalas en la barra lateral) y revisión cada minuto. |

Atajo: tecla **N** abre "Nueva tarea".

## Cómo se calculan las métricas

- **Atraso** = momento de completar (o ahora, si sigue abierta) − fecha límite. Si la fecha límite no trae hora, se toma 23:59.
- **Ciclo** = completada − creada.  **Tiempo real** = suma de sesiones cronometradas o manuales.
- **Real vs. estimado** = Σ tiempo real / Σ estimado (> 1 = subestimas).
- **Puntaje** = 40 % entregas a tiempo + 30 % cumplimiento (completadas / creadas en el periodo, máx. 100 %) + 20 % foco en lo vital (logros A o B) + 10 % precisión de estimación. Si un componente no tiene datos, se reparte su peso entre los demás.
- **Racha** = días seguidos (hasta hoy o ayer) con al menos una tarea completada.

## Datos y respaldos

- Base SQLite en `data/mifoco.db` (cambia la ruta con la variable `MIFOCO_DB`).
- Al iniciar se hace **un respaldo diario** en `data/respaldos/` (se conservan los últimos 15); también hay botón "Respaldar" en la interfaz.
- Los archivos adjuntos se guardan en `data/adjuntos/` (fuera de la base de datos): si copias tus datos a otro equipo, copia la carpeta `data/` completa.
- Eliminar una tarea es **borrado lógico**: desaparece de las vistas pero su historial queda.
- Exporta `tareas.csv` y `eventos.csv` (separador `;`, UTF‑8) desde la barra lateral, o conecta Power BI directamente al `.db` con el conector ODBC de SQLite.

Tablas: `tareas`, `sesiones`, `eventos`, `subtareas`, `dependencias`, `comentarios`, `adjuntos`, `categorias`, `descripciones`, `metas`, `hitos_meta`, `registros_aprendizaje`.
Si ya tenías datos, al arrancar la nueva versión las categorías y descripciones existentes se cargan solas en sus tablas.

## API (por si quieres automatizar)

```
GET/POST        /api/tareas                 (?incluir_cerradas=1)
GET/PUT/DELETE  /api/tareas/<id>
POST            /api/tareas/<id>/accion     {"accion": "iniciar|pausar|completar|reabrir|cancelar", "minutos_manual": 30}
GET             /api/catalogos   POST /api/categorias   PUT/DELETE /api/categorias/<id>
GET             /api/categorias/<id>/imagen   PUT /api/categorias/<id>  {"icono": "🛠️"} | {"imagen": "data:image/png;base64,…"} | {"quitar_icono": true}
POST            /api/descripciones           DELETE /api/descripciones/<id>
GET/POST        /api/metas      PUT/DELETE /api/metas/<id>
POST            /api/metas/<id>/hitos       PUT/DELETE /api/hitos/<id>
POST            /api/metas/<id>/registros   DELETE /api/registros/<id>
GET             /api/estadisticas?dias=30   /api/alertas   /api/frase   /api/historial
GET             /api/reporte?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&categoria=Trabajo&sin_fecha=0]
GET             /api/exportar/tareas.csv    /api/exportar/eventos.csv
POST            /api/tareas/<id>/subtareas   PUT/DELETE /api/subtareas/<id>   {"completada": true}
POST/PUT        /api/tareas  {"dependencias": [{"tipo": "tarea"|"subtarea", "id": 7}]}   DELETE /api/dependencias/<id>
POST            /api/tareas/<id>/adjuntos  (multipart «archivo» o JSON {url, nombre})   GET /api/adjuntos/<id>/archivo   DELETE /api/adjuntos/<id>
POST            /api/tareas/<id>/comentarios   PUT/DELETE /api/comentarios/<id>
POST            /api/respaldo
```

## Estructura

```
mi_foco/
├── app.py          servidor y API
├── db.py           esquema SQLite, conexión y respaldos
├── frases.py       frases originales inspiradas en los principios de gestión del tiempo de Brian Tracy
├── static/         index.html · style.css · app.js · reporte.js (imagen del reporte)
├── iniciar.bat · iniciar_oculto.vbs · iniciar.sh
└── data/           (se crea solo) base de datos y respaldos
```

El servidor solo escucha en `127.0.0.1`, así que no es accesible desde otros equipos de la red.

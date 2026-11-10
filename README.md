# ◎ Mi Foco — gestor local de tareas, tiempo y metas de aprendizaje

Servicio en Python (Flask + SQLite) que corre **100 % en tu equipo** y se usa desde el navegador en
`http://127.0.0.1:5050`. Tus datos no salen a internet: la interfaz no usa CDN ni librerías externas, y la única
consulta en línea es la de los festivos de Colombia (ver [Festivos](#festivos)).

**Contenido:** [Requisitos](#requisitos) · [Instalación desde cero](#instalación-desde-cero-windows) ·
[Arranque automático](#paso-5--que-arranque-solo-al-encender-el-pc) · [Actualizar (`restartmifoco`)](#actualizar-y-reiniciar-con-un-comando-restartmifoco) ·
[Primeros pasos](#primeros-pasos-en-la-app) · [Solución de problemas](#solución-de-problemas) · [Qué hace](#qué-hace)

## Requisitos

| Necesitas | Para qué | ¿Obligatorio? |
|---|---|---|
| **Windows 10 u 11** | Esta guía es para Windows (al final hay notas para macOS/Linux). | — |
| **Python 3.9 o más reciente** | Ejecutar Mi Foco. Debe estar en el **PATH** al menos para crear el entorno (paso 3). | Sí |
| **Git** | Descargar el proyecto y traer actualizaciones (`git pull`, `restartmifoco`). Debe estar en el **PATH**. | Recomendado (sin Git puedes usar el ZIP) |
| **Internet** | Solo la primera vez, para instalar Flask y Waitress con `pip`; luego, solo para festivos. | La primera vez |
| **Edge o Chrome actualizados** | Usar la interfaz. | Sí |

En esta guía la carpeta del proyecto es **`C:\mi_foco`**. Si usas otra, cámbiala en cada comando.

## Instalación desde cero (Windows)

Todos los comandos se escriben en **PowerShell**: menú Inicio → *Windows PowerShell* (o la terminal de VS Code).

### Paso 1 — Verificar Python y Git

```powershell
python --version
git --version
```

- Si muestran un número de versión (p. ej. `Python 3.12.4`, `git version 2.46.0`), sigue al paso 2.
- Si dicen *"no se reconoce como nombre de un cmdlet"* o **se abre la Microsoft Store**, no están instalados o no
  están en el PATH:
  - **Python:** descarga el instalador de <https://www.python.org/downloads/> y, en la primera pantalla, marca
    **"Add python.exe to PATH"**. Instalarlo solo para tu usuario no requiere administrador.
  - **Git:** instálalo desde <https://git-scm.com/download/win> (deja las opciones por defecto; agrega Git al PATH).
    En equipos de empresa suele pedir administrador o instalarse desde el portal de software de TI.
  - **Cierra y vuelve a abrir PowerShell** y repite la verificación.

### Paso 2 — Descargar el proyecto

**Con Git (recomendado, permite actualizar con un comando):**

```powershell
git clone https://github.com/icodecauseiloveit/mi-foco.git C:\mi_foco
cd C:\mi_foco
```

**Sin Git:** en <https://github.com/icodecauseiloveit/mi-foco> → botón **Code → Download ZIP**, descomprímelo en
`C:\mi_foco` (que dentro queden directamente `app.py`, `static\`, etc.) y en PowerShell ejecuta `cd C:\mi_foco`.

### Paso 3 — Crear el entorno e instalar dependencias (una sola vez)

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Esto crea la carpeta `.venv` con un Python propio del proyecto e instala Flask y Waitress ahí (no toca el resto de tu
equipo). No hace falta "activar" el entorno: siempre se usa `.venv\Scripts\python.exe` directamente, así que
funciona aunque tu equipo bloquee los scripts `.ps1` o los `.bat`.

> Si `python` no está en el PATH pero tienes el lanzador de Windows, usa `py -m venv .venv`.
> Si `pip` falla por el proxy de la empresa, consulta [Solución de problemas](#solución-de-problemas).

### Paso 4 — Primer arranque

```powershell
.venv\Scripts\python.exe app.py
```

Se abre el navegador en `http://127.0.0.1:5050`. La primera vez se crean solas la carpeta `data\` y la base de datos
`data\mifoco.db`. Para detenerlo, vuelve a la terminal y presiona **Ctrl + C**.

Opciones: `--puerto 8080` (otro puerto) y `--sin-navegador` (no abrir el navegador).

### Paso 5 — Que arranque solo al encender el PC

Para que Mi Foco quede corriendo **oculto** (sin ventana) cada vez que inicias sesión en Windows, crea un acceso
directo en la carpeta de Inicio. Pega esto en PowerShell (cambia `C:\mi_foco` si usas otra carpeta):

```powershell
$carpeta = 'C:\mi_foco'
$acceso = (New-Object -ComObject WScript.Shell).CreateShortcut("$([Environment]::GetFolderPath('Startup'))\Mi Foco.lnk")
$acceso.TargetPath = "$carpeta\.venv\Scripts\pythonw.exe"
$acceso.Arguments = "`"$carpeta\app.py`" --sin-navegador"
$acceso.WorkingDirectory = $carpeta
$acceso.Description = 'Mi Foco (servidor local)'
$acceso.Save()
```

`pythonw.exe` es Python sin ventana de consola. Para arrancarlo ya mismo sin reiniciar el PC:

```powershell
Start-Process C:\mi_foco\.venv\Scripts\pythonw.exe -ArgumentList '"C:\mi_foco\app.py"','--sin-navegador' -WindowStyle Hidden
```

Para **quitar** el arranque automático, borra *Mi Foco* de la carpeta de Inicio (`Win + R` → `shell:startup`).

> Alternativa: en `shell:startup` crea un acceso directo a `iniciar_oculto.vbs` (o usa `iniciar.bat` para arrancar
> con ventana). Algunos equipos de empresa bloquean `.bat` y `.vbs`; el acceso directo de arriba no los necesita.

### Paso 6 — Tenerlo a mano en el navegador

Abre `http://127.0.0.1:5050` y guárdalo como **favorito**, o instálalo como aplicación:
en **Edge** → menú `…` → *Aplicaciones* → *Instalar este sitio como una aplicación*; en **Chrome** → menú `⋮` →
*Transmitir, guardar y compartir* → *Instalar página como aplicación*. Así se abre en su propia ventana y puedes
anclarlo a la barra de tareas.

Luego, en la app: **⚙ Herramientas → 🔔 Activar notificaciones** para recibir los avisos de Windows (vencimientos,
descansos, tareas desbloqueadas).

## Actualizar y reiniciar con un comando: `restartmifoco`

Como Mi Foco corre oculto (sin ventana), para traer cambios de GitHub hay que **detenerlo, hacer `git pull` y
volver a arrancarlo**. La función de PowerShell `restartmifoco` hace las tres cosas:

1. Detiene el proceso que está usando el puerto **5050** (solo Mi Foco; no toca otros programas de Python).
2. Hace `git pull`, muestra los cambios que llegaron y, si cambió `requirements.txt`, reinstala dependencias.
3. Arranca Mi Foco **oculto** y confirma que quedó corriendo en `http://127.0.0.1:5050`.

**Instalarla (una sola vez).**

*Paso 1 — permitir que PowerShell cargue tu perfil.* Windows trae deshabilitada la ejecución de scripts, y sin esto
aparece el error *"no se puede cargar el archivo …\profile.ps1 porque la ejecución de scripts está deshabilitada"*.
Este comando la habilita **solo para tu usuario** y no requiere administrador (responde **S** si pide confirmación):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`RemoteSigned` deja correr tus scripts locales (como el perfil) y sigue bloqueando los descargados de internet sin firma.

*Paso 2 — abrir el perfil* (sirve para PowerShell, Terminal y VS Code):

```powershell
if (!(Test-Path $PROFILE.CurrentUserAllHosts)) { New-Item -ItemType File -Path $PROFILE.CurrentUserAllHosts -Force }
notepad $PROFILE.CurrentUserAllHosts
```

*Paso 3 — pegar la función*, guardar y cerrar. **Cambia `$carpeta`** por la carpeta donde instalaste Mi Foco:

```powershell
function restartmifoco {
    $carpeta = 'C:\mi_foco'
    $puerto  = 5050
    Push-Location $carpeta
    try {
        # 1. Detener lo que este usando el puerto de Mi Foco
        $pids = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ -Force }; Write-Host 'Mi Foco detenido' -ForegroundColor Yellow; Start-Sleep 1 }
        else { Write-Host 'Mi Foco no estaba corriendo' -ForegroundColor DarkGray }

        # 2. Traer cambios
        $antes = git rev-parse HEAD
        git pull
        if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR en git pull: se reinicia sin actualizar' -ForegroundColor Red }
        $despues = git rev-parse HEAD
        if ($antes -ne $despues) {
            Write-Host 'Cambios nuevos:' -ForegroundColor Cyan
            git log --oneline "$antes..$despues"
            if ((git diff --name-only $antes $despues) -contains 'requirements.txt') {
                Write-Host 'Actualizando dependencias...' -ForegroundColor Cyan
                & "$carpeta\.venv\Scripts\python.exe" -m pip install -q -r requirements.txt
            }
        }

        # 3. Arrancar oculto y confirmar
        Start-Process "$carpeta\.venv\Scripts\pythonw.exe" -ArgumentList 'app.py','--sin-navegador' -WorkingDirectory $carpeta -WindowStyle Hidden
        foreach ($i in 1..20) {
            Start-Sleep -Milliseconds 500
            if (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) {
                Write-Host "Mi Foco corriendo en http://127.0.0.1:$puerto" -ForegroundColor Green; return
            }
        }
        Write-Host 'Mi Foco no arranco. Para ver el error ejecuta: .venv\Scripts\python.exe app.py' -ForegroundColor Red
    } finally { Pop-Location }
}
```

> Los mensajes y comentarios van sin tildes a propósito: Windows PowerShell 5 lee mal los acentos de un perfil
> guardado con el Bloc de notas.

*Paso 4 — cargarla* en la terminal actual (las terminales nuevas la cargan solas):

```powershell
. $PROFILE.CurrentUserAllHosts
```

**Usarla:** en cualquier terminal, desde cualquier carpeta:

```powershell
restartmifoco
```

Verás *Mi Foco detenido*, el resultado del `git pull` y, en verde, *Mi Foco corriendo en http://127.0.0.1:5050*.
Luego recarga la página con `Ctrl + F5`.

**Si al cargar el perfil sigue saliendo el error de ejecución de scripts,** revisa:

```powershell
Get-ExecutionPolicy -List
```

- Si **CurrentUser** ya dice `RemoteSigned` pero falla, Windows pudo marcar el perfil como "descargado" (pasa cuando
  la carpeta Documentos está en OneDrive). Quítale la marca y vuelve a cargarlo:
  ```powershell
  Unblock-File $PROFILE.CurrentUserAllHosts
  . $PROFILE.CurrentUserAllHosts
  ```
- Si **MachinePolicy** o **UserPolicy** tienen un valor distinto de `Undefined`, la política la impuso la empresa y
  tiene prioridad. No la fuerces: pega la función directamente en la terminal (funciona mientras esté abierta) o pide
  a TI que habiliten `RemoteSigned` para tu usuario.

**Hacerlo a mano (sin la función):**

```powershell
cd C:\mi_foco
Get-NetTCPConnection -LocalPort 5050 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }   # detener
git pull                                                                                                     # actualizar
Start-Process .venv\Scripts\pythonw.exe -ArgumentList 'app.py','--sin-navegador' -WindowStyle Hidden        # arrancar
```

O desde el Administrador de tareas (`Ctrl + Shift + Esc`) → pestaña **Detalles** → `pythonw.exe` (el de `app.py`
en la columna *Línea de comandos*) → *Finalizar tarea*. **Sin Git**, descarga de nuevo el ZIP y copia los archivos
encima **sin tocar la carpeta `data`**.

**¿Cuándo hace falta reiniciar?** Si el cambio fue solo de la interfaz (archivos de `static/`), basta con `git pull`
y `Ctrl + F5`. Si cambió el servidor (`app.py`, `db.py`, `festivos.py`…) o la base de datos, reinicia; con
`restartmifoco` no tienes que pensarlo: siempre hace todo. Las actualizaciones nunca borran tus datos: la base se
migra sola al arrancar.

## Primeros pasos en la app

1. **⚙ Herramientas → 🏷 Categorías y descripciones:** crea tus categorías (p. ej. *Trabajo*, *Estudio*, *Personal*)
   y, si quieres, dales un emoji o una imagen.
2. **Metas de aprendizaje → + Nueva meta:** la herramienta que quieres dominar, nivel actual y objetivo, horas y fecha.
3. **+ Nueva tarea** (o la tecla **N**): título, **entregable** (qué debe existir para darla por terminada), prioridad
   **ABCDE**, fecha límite, subtareas y, si aplica, de qué otra tarea depende.
4. Marca como **🐸 rana** la tarea más importante del día y empieza el día con **Comer la rana ▶** en la vista Hoy.
5. Al final de la semana: **Historial → 📅 Reporte semanal** y **⚙ Herramientas → 📤 Reporte de cumplimiento**
   para enviarlo por correo.

## Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `python` *no se reconoce* o abre la Microsoft Store | Python no está instalado o no está en el PATH. Instálalo marcando *Add python.exe to PATH* (paso 1), o usa `py` en su lugar. Para quitar el atajo de la Store: Configuración → Aplicaciones → *Alias de ejecución de aplicaciones* → desactiva `python.exe`. |
| `git` *no se reconoce* | Git no está instalado o no está en el PATH. Instálalo (paso 1) y abre una terminal nueva. Mientras tanto, usa el ZIP. |
| `pip install` falla con errores de conexión, SSL o proxy | La red de la empresa usa proxy. Prueba `.venv\Scripts\python.exe -m pip install -r requirements.txt --proxy http://USUARIO:CLAVE@PROXY:PUERTO` (pide los datos a TI) o instala desde otra red. |
| No deja ejecutar `.bat`, `.vbs` o `.ps1` | Usa los comandos de esta guía: llaman a `.venv\Scripts\python.exe` directamente y no necesitan scripts. Para el perfil de `restartmifoco`, ver la política de ejecución en su sección. |
| La página no carga en `http://127.0.0.1:5050` | Mi Foco no está corriendo. Ejecuta `restartmifoco`, o `.venv\Scripts\python.exe app.py` para ver el error en pantalla. |
| *Address already in use* / el puerto 5050 está ocupado | Ya hay un Mi Foco corriendo (oculto) u otro programa usa el puerto. Detenlo con `restartmifoco` o arranca con `--puerto 8080` (y cambia `$puerto` en la función y en el acceso directo). |
| Los festivos dicen *"calculados localmente"* | La red bloqueó la API de festivos. Mi Foco los calcula igual (Ley Emiliani); en Historial → Reporte semanal puedes *Reintentar consulta en línea*. |
| Quiero pasar Mi Foco a otro equipo | Instala desde cero en el equipo nuevo y copia la carpeta **`data`** completa (base de datos, adjuntos y respaldos) encima de la nueva. |

### macOS / Linux

```bash
git clone https://github.com/icodecauseiloveit/mi-foco.git ~/mi_foco && cd ~/mi_foco
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # o ./iniciar.sh
```

## Qué hace

| Módulo | Funciones |
|---|---|
| **Hoy** | Vista tranquila que ocupa la pantalla sin scroll. Arriba, la frase del día destacada sobre fondo oscuro degradado (en formato compacto) y un resumen (pendientes, vencidas, hechas hoy, foco y racha). En el centro, **tu 🐸 rana** como protagonista con su botón *Comer la rana ▶* (si tiene subtareas, arranca por la siguiente), junto a la captura rápida. Abajo, tres paneles con **filas simples** (En curso, Vencidas y por vencer, Otras A): prioridad, título y un dato clave; ▶ y ✓ aparecen al pasar el mouse y el detalle está a un clic. Al abrir la app las alertas no saltan como avisos: quedan en la campana 🔔. |
| **Tareas** | CRUD completo, prioridad **ABCDE**, categoría, fecha límite, tiempo estimado, vínculo a una meta, filtros y búsqueda. Cada tarea aparece **contraída**: prioridad, título y una línea de resumen (categoría, vencimiento, avance, 💬/📎), con ▶/⏸ a la mano. Con **⌄** (o clic en la fila) se **despliega**: subtareas y descripción a la izquierda, datos clave a la derecha (estado, fechas, tiempo, entregable, dependencias, soporte, comentarios) y una barra de acciones (Iniciar/Pausar y Completar; Comentar, Editar, Duplicar, Ver detalle; Cancelar y Eliminar). *Desplegar / Contraer todas* en la cabecera de la lista. |
| **Categorías y descripciones** | Se guardan solas en la base cada vez que las usas. Al crear una tarea eliges la categoría de una lista (o "＋ Nueva categoría…") y puedes cargar una descripción guardada. Desde *🏷 Categorías y descripciones* (barra lateral) agregas, renombras (actualiza todas sus tareas) o quitas. Cada categoría puede llevar un **emoji o una imagen propia** (se recorta a 96×96 y se guarda en la base), que se muestra en las tareas, filtros y estadísticas. |
| **Entregable** | Al crear una tarea se pregunta qué debe existir para darla por terminada (📦). Se guarda como la última subtarea, marcada como entregable, y cuenta en el % de avance. Si creas una tarea sin entregable, te lo recuerda. Puedes cambiarlo o quitarlo al editar. |
| **Subtareas** | Al crear o editar una tarea agregas subtareas (Enter agrega otra; puedes pegar una lista). Cada una se marca por separado y la tarea muestra su avance (1 de 3 = 33 %). Cada marca queda en el historial con fecha y hora; la fecha de una subtarea completada (✅ fecha ✎) también se puede cambiar con un clic si la terminaste antes de marcarla. Al completar la última te ofrece cerrar la tarea; si cierras la tarea con subtareas pendientes, te avisa cuáles faltan. |
| **Dependencias** | Una tarea puede esperar a otra tarea completa o a una subtarea específica ("Depende de" en el formulario). Mientras falte algo queda 🔒 bloqueada: se ve rayada, el filtro *Bloqueadas / Disponibles* la separa e iniciarla o completarla pide confirmación. La tarea requisito muestra "⛓ Frena a N". Al terminar lo que faltaba se avisa 🔓 *Ya puedes empezar*. Se impiden los ciclos (A espera a B y B espera a A). Alerta de *ruta crítica* si una tarea bloqueada vence en menos de 48 h. |
| **Registrar lo ya hecho** | Al crear una tarea marca *✅ Ya está completada* e indica fecha y hora de completado (no puede ser futura) y, si quieres, el tiempo dedicado. Se calcula si fue a tiempo frente a su fecha límite y cuenta en las estadísticas de ese día. En cualquier tarea completada la fecha aparece como **✅ fecha ✎**: haz clic en ella (en la tarjeta o en el detalle) para poner otra, con atajos Ayer / Hace 2 días / Hace una semana. Queda en el historial y se recalcula si fue a tiempo. |
| **Reporte de cumplimiento** | *📤 Reporte de cumplimiento* (barra lateral) genera una imagen PNG lista para el correo: periodo (esta semana, semana pasada, este mes, mes pasado o fechas libres), categoría opcional y "Preparado por". Incluye cumplimiento del plan, entregas a tiempo, completadas, en curso/pendientes, vencidas, avance general y la tabla de actividades con prioridad, estado, avance y fechas; bajo cada actividad que tenga comentarios aparece el **último comentario** con su fecha (💬). *📋 Copiar imagen* la deja en el portapapeles para pegarla con Ctrl + V en Outlook/Gmail; también se puede descargar. Se dibuja en el navegador, sin servicios externos. |
| **Soporte (archivos y enlaces)** | En el detalle de cada tarea, sección *Soporte*: arrastra archivos (PDF, Excel, Word, imágenes, correos…; máx. 50 MB c/u) o pega enlaces (SharePoint, OneDrive, web). Los PDF e imágenes se abren en el navegador; los demás se descargan. La etiqueta **📎 N** en la tarjeta lleva directo ahí. Los archivos se guardan en `data/adjuntos/`. |
| **Comentarios** | Cada tarea tiene una sección de comentarios en su detalle (avances, acuerdos, bloqueos…), con fecha y hora; se pueden editar o borrar. El botón 💬 de la tarjeta abre directo ahí, y la etiqueta **💬 N** muestra cuántos tiene. *Ctrl + Enter* guarda. |
| **Duplicar** | Botón **⧉** en cada tarea (y *⧉ Duplicar* en el detalle): abre *Nueva tarea* con los mismos datos y el título numerado según las veces que se ha duplicado la original (*Tarea 1*, *Tarea 2*…, también si duplicas una copia). Copia descripción, prioridad, categoría, fecha límite, estimado, meta, rana, subtareas (sin marcar), entregable y dependencias; el soporte se copia si dejas marcada la casilla. No copia comentarios ni historial. |
| **Cronómetro** | Cada *Iniciar → Pausar/Completar* crea una sesión de trabajo. **Una cosa a la vez**: al iniciar otra tarea o subtarea, la anterior se pausa sola. Si la tarea tiene **subtareas pendientes, el tiempo se inicia desde cada subtarea** (▶ / ⏸ junto a ella; la tarjeta ofrece ▶ con la siguiente pendiente) y cada subtarea muestra su tiempo; la tarea **totaliza** la suma. Completar una subtarea en curso cierra su sesión. Si completas sin cronometrar, te pregunta cuántos minutos le dedicaste. |
| **Metas de aprendizaje** | Herramienta, nivel actual → objetivo (1‑5), horas objetivo, fecha, hitos con checklist y registro de práctica. El progreso combina horas y hitos; calcula el **ritmo semanal necesario**. Las horas de tareas vinculadas también suman. |
| **Rendimiento** | Puntaje 0‑100, entregas a tiempo, atraso promedio, ciclo promedio, real vs. estimado, racha, foco en lo vital (80/20), reprogramaciones, gráficos diarios y por prioridad/categoría (7 a 365 días). |
| **Historial** | Dos pestañas. *📅 Reporte semanal*: eliges el número de semana (ISO, p. ej. 46) y el año, o navegas con ‹ ›; muestra de qué día a qué día va (lunes a domingo), los **festivos de Colombia** y, **día por día**, las tareas completadas (a tiempo o con atraso), subtareas completadas, tiempo trabajado por tarea, comentarios y práctica de aprendizaje, con un resumen de la semana (días hábiles, completadas por día hábil). *📜 Bitácora de eventos*: el registro de todo lo que le pasó a cada tarea. |
| **Alertas** | Vencidas, vencen en < 24 h, rana sin empezar después de las 11 a. m., sesión de más de 90 min (descanso), metas en riesgo o vencidas, metas sin práctica en 7 días. Notificaciones del sistema (actívalas en la barra lateral) y revisión cada minuto. |

**Modo claro / oscuro:** botón ☀/🌙 en la barra superior; se recuerda en tu navegador y, si nunca lo usas, sigue el modo de Windows.

Atajo: tecla **N** abre "Nueva tarea" (en Metas, "Nueva meta"). Reportes, exportaciones, categorías, notificaciones y respaldo están en el menú **⚙ Herramientas**, abajo en la barra lateral.

## Cómo se calculan las métricas

- **Atraso** = momento de completar (o ahora, si sigue abierta) − fecha límite. Si la fecha límite no trae hora, se toma 23:59.
- **Ciclo** = completada − creada.  **Tiempo real** = suma de sesiones cronometradas o manuales.
- **Real vs. estimado** = Σ tiempo real / Σ estimado (> 1 = subestimas).
- **Puntaje** = 40 % entregas a tiempo + 30 % cumplimiento (completadas / creadas en el periodo, máx. 100 %) + 20 % foco en lo vital (logros A o B) + 10 % precisión de estimación. Si un componente no tiene datos, se reparte su peso entre los demás.
- **Racha** = días seguidos (hasta hoy o ayer) con al menos una tarea completada.

## Festivos

Los festivos de Colombia se consultan en la API pública [Nager.Date](https://date.nager.at) (`/api/v3/PublicHolidays/{año}/CO`, sin clave) y se guardan en la base para no volver a consultarla. Si la red no permite llegar a la API, se calculan localmente con la Ley Emiliani y las fechas de Semana Santa (verificado contra el calendario oficial 2025 y 2026); en el reporte semanal aparece *Reintentar consulta en línea*.

## Datos y respaldos

- Base SQLite en `data/mifoco.db` (cambia la ruta con la variable `MIFOCO_DB`).
- Al iniciar se hace **un respaldo diario** en `data/respaldos/` (se conservan los últimos 15); también hay botón "Respaldar" en la interfaz.
- Los archivos adjuntos se guardan en `data/adjuntos/` (fuera de la base de datos): si copias tus datos a otro equipo, copia la carpeta `data/` completa.
- Eliminar una tarea es **borrado lógico**: desaparece de las vistas pero su historial queda.
- Exporta `tareas.csv` y `eventos.csv` (separador `;`, UTF‑8) desde la barra lateral, o conecta Power BI directamente al `.db` con el conector ODBC de SQLite.

Tablas: `tareas`, `sesiones`, `eventos`, `subtareas`, `dependencias`, `comentarios`, `adjuntos`, `festivos`, `categorias`, `descripciones`, `metas`, `hitos_meta`, `registros_aprendizaje`.
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
GET             /api/semana?anio=2026&semana=46   POST /api/festivos/<año>/actualizar
GET             /api/tareas/<id>/duplicado   (datos para precargar la copia; se crea con POST /api/tareas + duplicada_de)
POST            /api/respaldo
```

## Estructura

```
mi_foco/
├── app.py          servidor y API
├── db.py           esquema SQLite, conexión y respaldos
├── festivos.py     festivos de Colombia (API Nager.Date + cálculo local de respaldo)
├── frases.py       frases originales inspiradas en los principios de gestión del tiempo de Brian Tracy
├── static/         index.html · style.css · app.js · reporte.js (imagen del reporte)
├── iniciar.bat · iniciar_oculto.vbs · iniciar.sh
└── data/           (se crea solo) base de datos y respaldos
```

El servidor solo escucha en `127.0.0.1`, así que no es accesible desde otros equipos de la red.

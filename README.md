# Tracking Contenedores — DIB / Decoexpress

Plataforma web de bajo/cero costo para hacer seguimiento a contenedores y Master BL
en tránsito desde el extranjero hacia San Antonio / Valparaíso.

Arquitectura (según lo conversado): **GitHub Pages** (frontend) + **Google Apps
Script + Google Sheets** (backend/base de datos), con un proceso que corre 1 vez
al día.

```
tracking-contenedores/
├── docs/              → frontend, se publica con GitHub Pages
│   ├── index.html
│   ├── app.js         → acá pegas la URL de tu Apps Script
│   └── style.css
├── apps-script/
│   └── Code.gs         → código fuente de referencia del backend
└── README.md
```

## Por qué esta arquitectura y qué NO hace todavía

El documento de fuentes que dejaste en COMEX es claro: no existe una fuente
gratuita única que cubra todas las navieras. Los agregadores tipo ShipsGo cobran
por API. Por eso el MVP:

- **Sí automatiza a diario**: recalcula retrasos comparando ETA actual vs ETA
  original y vs la fecha de hoy, y te dice qué contenedores hay que revisar.
- **No hace scraping** de las páginas de Maersk, MSC, etc. Esas páginas usan
  JavaScript y protecciones anti-bot; un script en Apps Script no las puede leer
  de forma confiable y podría violar sus términos de uso. Cuando revises el
  estado en la página de la naviera, lo actualizas en el dashboard con 2 clics
  y el sistema guarda el historial.
- Dejé un gancho (`actualizarEstadoShipsGo_`) listo para conectar un agregador
  pago el día que el volumen lo justifique — hoy no llama a ninguna API.

## Paso 1 — Crear el Google Sheet (base de datos)

1. Crea un Google Sheet nuevo (el nombre no importa, ej. `Tracking Contenedores DB`).
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido de `Code.gs` que viene por defecto y pega el contenido del
   archivo `apps-script/Code.gs` de esta carpeta.
4. Guarda (ícono disquete).
5. En el selector de funciones (arriba, al lado del ícono ▶) elige `setup` y
   presiona **Ejecutar**. La primera vez te pedirá autorizar permisos (tu propia
   cuenta, es normal). Esto crea las hojas `Maestro`, `Historial`, `Config` y
   configura el trigger diario (corre entre 07:00 y 08:00, hora del script).

## Paso 2 — Publicar el backend como Web App

1. En el editor de Apps Script: **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. "Ejecutar como": tu cuenta. "Quién tiene acceso": **Cualquier usuario** (así
   GitHub Pages puede llamarla sin login).
4. Implementar → copia la **URL de la aplicación web** (termina en `/exec`).

Cada vez que edites `Code.gs`, tienes que crear una **nueva versión** desde
Implementar → Gestionar implementaciones → editar (ícono lápiz) → Versión: Nueva
→ Implementar, para que los cambios queden activos en esa misma URL.

## Paso 3 — Conectar el frontend

1. Abre `docs/app.js` en este repo.
2. Reemplaza:
   ```js
   const API_URL = 'PEGAR_AQUI_URL_APPS_SCRIPT';
   ```
   por la URL que copiaste en el paso 2.
3. Guarda.

## Paso 4 — Subir a GitHub y activar GitHub Pages

1. Crea un repositorio nuevo en GitHub (puede ser privado) y sube esta carpeta
   completa (`git init`, `git add .`, `git commit`, `git remote add origin ...`,
   `git push`).
2. En el repo: **Settings → Pages**.
3. Source: **Deploy from a branch**. Branch: `main`, carpeta: **/docs**.
4. Guarda. GitHub te da una URL tipo
   `https://tu-usuario.github.io/tracking-contenedores/` — esa es la app.

## Uso diario

- **Agregar contenedor/BL**: botón "+ Nuevo contenedor" en el dashboard.
- **Actualizar estado**: cuando revises la naviera, botón "Actualizar" en la
  fila del contenedor → eliges el nuevo estado y la ETA actual. Queda guardado
  en el historial (hoja `Historial`).
- **Cada mañana**, antes de que entres tú, el trigger diario ya recalculó
  retrasos y marcó "pendiente revisión" en los contenedores activos — así sabes
  por dónde partir.
- Todo el dato vive en el Google Sheet: puedes abrirlo directo si necesitas
  hacer un ajuste masivo o sacar un reporte en Excel/Sheets.

## Envío de correo (apagado por defecto)

En `Code.gs`, `ENVIAR_EMAIL = false`. Si quieres el resumen diario por correo,
cambia a `true` y completa `EMAIL_DESTINO` con tu dirección, luego vuelve a
implementar (nueva versión, ver Paso 2).

## Siguiente etapa (cuando quieras)

- Sumar STI (San Antonio) y TPS (Valparaíso) para estados de liberación/retiro
  en puerto (requiere usuario en sus portales).
- Evaluar un agregador pago (ShipsGo u otro) para automatizar el 100% del
  estado por naviera, usando el gancho ya dejado en `Code.gs`.
- Multiusuario: hoy cualquiera con la URL de GitHub Pages puede ver y editar
  (porque la Web App está abierta a "Cualquier usuario"). Si necesitas login,
  se puede restringir la Web App a tu dominio de Google Workspace o agregar
  una clave simple en el frontend.

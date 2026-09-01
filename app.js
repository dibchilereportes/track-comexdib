/**
 * Tracking Contenedores - frontend
 * Consume la Web App de Apps Script (ver README para desplegarla).
 */

// 1) PEGA AQUÍ la URL de tu Apps Script Web App después de desplegarlo.
//    Ejemplo: https://script.google.com/macros/s/AKfycb.../exec
const API_URL = 'https://script.google.com/macros/s/AKfycbwUQWPv0HmdFQPdniOC-qv_yyGMqObFHmY5XutGpqerkE2IBPAsjaFxKJgPg0KtzBhr/exec';

const ESTADOS = [
  'Booking', 'Loaded', 'Departed', 'Transshipment', 'Arrived',
  'Discharged', 'Available', 'Gate Out', 'Delivered'
];

// Etiqueta en español para mostrar en pantalla. El valor interno (clave)
// se mantiene en inglés porque es el estándar que usa el documento de
// fuentes y el que va a usar el agente IA de tracking más adelante.
const ESTADO_LABEL = {
  'Booking':        'Reservado (Booking)',
  'Loaded':         'Cargado en origen',
  'Departed':       'En tránsito',
  'Transshipment':  'En transbordo',
  'Arrived':        'Arribado a POD',
  'Discharged':     'Descargado en POD',
  'Available':      'Liberado (disponible retiro)',
  'Gate Out':       'Retirado del puerto',
  'Delivered':      'Entregado en destino'
};

// Rampa secuencial (avance del pipeline) - un solo hue, claro -> oscuro.
const ESTADO_COLOR = {
  'Booking':        'var(--seq-250)',
  'Loaded':         'var(--seq-250)',
  'Departed':       'var(--seq-350)',
  'Transshipment':  'var(--seq-350)',
  'Arrived':        'var(--seq-450)',
  'Discharged':     'var(--seq-450)',
  'Available':      'var(--seq-550)',
  'Gate Out':       'var(--seq-550)',
  'Delivered':      'var(--seq-650)'
};

let maestro = [];
let configNavieras = [];
let detalleProductos = [];
let orden = { campo: 'FechaEsperadaOC', dir: -1 }; // -1 = más nueva primero
let estadosOCSeleccionados = new Set(); // vacío = "todos"
let mostrarCerrados = false; // OC en estado 'done' (Cerrado): ya recibidas, fuera del control por defecto

// Etiqueta en español para el estado de la OC en Odoo (draft/sent/purchase/
// done son los valores estándar de Odoo; se muestra el crudo si aparece
// alguno no mapeado, para no ocultar datos).
const ESTADO_OC_LABEL = {
  'draft':       'Solicitud de presupuesto',
  'sent':        'Solicitud enviada',
  'to approve':  'Por aprobar',
  'purchase':    'Orden de compra',
  'done':        'Cerrado'
};

// Mismo criterio que ordenCerradaDeVerdad_() en Code.gs: una OC de
// importación anticipada ("Entregar a" = Importación Anticipada: Recepciones)
// puede quedar Cerrada en Odoo sin haber llegado físicamente al CD -> sigue
// tratándose como activa hasta que se registre FechaRecepcionDestino a mano.
const ENTREGA_A_IMPORTACION_ANTICIPADA = 'Importación Anticipada: Recepciones';
function ordenCerradaDeVerdad(c) {
  if (c.EstadoOC !== 'done') return false;
  const esImportacionAnticipada = String(c.EntregaA || '').trim() === ENTREGA_A_IMPORTACION_ANTICIPADA;
  if (esImportacionAnticipada && !c.FechaRecepcionDestino) return false;
  return true;
}

async function apiGet(action, params) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error API');
  return json.data;
}

async function apiPost(action, data) {
  // content-type text/plain evita el preflight CORS que Apps Script no maneja bien.
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, data })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error API');
  return json.data;
}

function checkConfig() {
  if (!API_URL || API_URL === 'PEGAR_AQUI_URL_APPS_SCRIPT') {
    document.getElementById('configBanner').classList.add('show');
    document.getElementById('tablaBody').innerHTML =
      '<tr><td colspan="27" class="empty-state">Configura API_URL en app.js para cargar datos.</td></tr>';
    return false;
  }
  return true;
}

function llenarSelectsEstado() {
  ['f_estado', 'e_estado'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = ESTADOS.map(e => `<option value="${e}">${ESTADO_LABEL[e] || e}</option>`).join('');
  });
}

function badgeRetraso(c) {
  if (c.Retrasado === true || c.Retrasado === 'TRUE') {
    return '<span class="badge delay-critical"><span class="badge-dot"></span>Retrasado</span>';
  }
  return '<span class="badge delay-ok"><span class="badge-dot"></span>A tiempo</span>';
}

function badgeEstado(estado) {
  const color = ESTADO_COLOR[estado] || 'var(--seq-450)';
  const label = ESTADO_LABEL[estado] || estado || '—';
  return `<span class="badge" style="background:${color}">${label}</span>`;
}

function badgeDespacho(tipo) {
  if (!tipo) return '';
  const color = tipo === 'Directo' ? 'var(--status-good)' : 'var(--status-warning)';
  return `<span class="badge" style="background:${color}">${tipo}</span>`;
}

// Días entre Liberación POD (retiro desde puerto) y Recepción en destino
// (CD) - el control de tránsito puerto->CD que se pidió agregar. Si aún no
// hay recepción registrada, muestra los días transcurridos "en curso" desde
// la liberación para no dejar la columna en blanco mientras se espera.
function diasPodACD(c) {
  if (!c.FechaLiberacionPOD) return '';
  const liberacion = new Date(c.FechaLiberacionPOD);
  if (isNaN(liberacion)) return '';
  if (c.FechaRecepcionDestino) {
    const recepcion = new Date(c.FechaRecepcionDestino);
    if (isNaN(recepcion)) return '';
    const dias = Math.round((recepcion - liberacion) / 86400000);
    return `${dias} d`;
  }
  const dias = Math.round((new Date() - liberacion) / 86400000);
  return `${dias} d (en curso)`;
}

function poblarFiltros() {
  const empresas = [...new Set(maestro.map(c => c.Empresa).filter(Boolean))].sort();
  const selEmp = document.getElementById('filtroEmpresa');
  const empresaPrevia = selEmp.value;
  selEmp.innerHTML = '<option value="">Todas las empresas</option>' +
    empresas.map(e => `<option value="${e}">${e}</option>`).join('');
  if (empresas.includes(empresaPrevia)) selEmp.value = empresaPrevia;

  // "Cerrado" (OC en estado 'done', ya recibidas) no aparece como opción de
  // filtro salvo que "Mostrar cerrados" esté activo — no forman parte del
  // control activo, solo se pueden consultar prendiendo el toggle.
  const baseFiltro = mostrarCerrados ? maestro : maestro.filter(c => !ordenCerradaDeVerdad(c));
  const estadosOC = [...new Set(baseFiltro.map(c => c.EstadoOC).filter(Boolean))];
  // Limpia selecciones que ya no existan en los datos actuales.
  [...estadosOCSeleccionados].forEach(v => { if (!estadosOC.includes(v)) estadosOCSeleccionados.delete(v); });
  const panel = document.getElementById('filtroEstadoOCPanel');
  panel.innerHTML = estadosOC.map(e => `
    <label class="multiselect-option">
      <input type="checkbox" value="${e}" ${estadosOCSeleccionados.has(e) ? 'checked' : ''}>
      ${ESTADO_OC_LABEL[e] || e}
    </label>
  `).join('') || '<div class="multiselect-empty">Sin datos aún</div>';
  panel.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      if (chk.checked) estadosOCSeleccionados.add(chk.value);
      else estadosOCSeleccionados.delete(chk.value);
      actualizarBotonEstadoOC();
      renderTabla();
    });
  });
  actualizarBotonEstadoOC();

  const navieras = [...new Set(maestro.map(c => c.Naviera).filter(Boolean))].sort();
  const selNav = document.getElementById('filtroNaviera');
  selNav.innerHTML = '<option value="">Todas las navieras</option>' +
    navieras.map(n => `<option value="${n}">${n}</option>`).join('');

  // Se arma con los valores reales presentes en el Maestro (no con la lista
  // fija ESTADOS) para que nunca quede un valor guardado (mayúsculas,
  // espacios, data vieja) que no calce con ninguna opción del filtro.
  const estadoPrevio = document.getElementById('filtroEstado').value;
  const estadosPresentes = [...new Set(maestro.map(c => c.EstadoActual).filter(Boolean))];
  const selEstado = document.getElementById('filtroEstado');
  selEstado.innerHTML = '<option value="">Todos los estados</option>' +
    estadosPresentes.map(e => `<option value="${e}">${ESTADO_LABEL[e] || e}</option>`).join('');
  if (estadosPresentes.includes(estadoPrevio)) selEstado.value = estadoPrevio;

  document.getElementById('listaNavieras').innerHTML =
    configNavieras.map(n => `<option value="${n.Naviera}">`).join('');
}

function actualizarBotonEstadoOC() {
  const btn = document.getElementById('filtroEstadoOCBtn');
  const n = estadosOCSeleccionados.size;
  if (n === 0) btn.textContent = 'Todos';
  else if (n === 1) btn.textContent = ESTADO_OC_LABEL[[...estadosOCSeleccionados][0]] || [...estadosOCSeleccionados][0];
  else btn.textContent = `${n} seleccionados`;
  btn.classList.toggle('active', n > 0);
}

function initMultiselectEstadoOC() {
  const wrap = document.getElementById('filtroEstadoOCWrap');
  const btn = document.getElementById('filtroEstadoOCBtn');
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    wrap.classList.toggle('open');
  });
  document.addEventListener('click', (ev) => {
    if (!wrap.contains(ev.target)) wrap.classList.remove('open');
  });
}

function renderKpis(data) {
  const enTransito = ['Booking', 'Loaded', 'Departed', 'Transshipment'];
  const activos = data.filter(c => c.EstadoActual !== 'Delivered');
  const kpis = [
    { label: 'En tránsito', val: activos.filter(c => enTransito.includes(c.EstadoActual)).length, cls: 'brand' },
    { label: 'Arribados', val: data.filter(c => c.EstadoActual === 'Arrived').length, cls: 'brand' },
    { label: 'Disponibles retiro', val: data.filter(c => c.EstadoActual === 'Available').length, cls: 'brand' },
    { label: 'Retirados (Gate Out)', val: data.filter(c => c.EstadoActual === 'Gate Out').length, cls: 'brand' },
    { label: 'Recibidos en CD', val: data.filter(c => c.EstadoActual === 'Delivered').length, cls: 'ok' },
    { label: 'Retrasados', val: data.filter(c => c.Retrasado === true || c.Retrasado === 'TRUE').length, cls: null }
  ];
  kpis[5].cls = kpis[5].val > 0 ? 'alert' : 'ok';

  const row = document.getElementById('kpiRow');
  row.innerHTML = kpis.map(k =>
    `<div class="stat-tile ${k.cls}"><div class="label">${k.label}</div><div class="value">${k.val}</div></div>`
  ).join('');
}

function actualizarUltimaSync(data) {
  const el = document.getElementById('ultimaSync');
  const dot = document.getElementById('syncDot');
  if (!data.length) { el.textContent = 'Sin registros'; return; }
  const fechas = data.map(c => c.FechaUltimoUpdate).filter(Boolean).sort();
  const ultima = fechas[fechas.length - 1];
  el.textContent = ultima ? `Última sincronización: ${ultima} · ${data.length} registros` : `${data.length} registros`;
  if (dot) dot.classList.add('live');
}

function aplicarFiltros(data) {
  const empresa = document.getElementById('filtroEmpresa').value;
  const naviera = document.getElementById('filtroNaviera').value;
  const estado = document.getElementById('filtroEstado').value;
  const retraso = document.getElementById('filtroRetraso').value;
  const texto = document.getElementById('filtroTexto').value.trim().toLowerCase();

  return data.filter(c => {
    if (empresa && c.Empresa !== empresa) return false;
    if (estadosOCSeleccionados.size > 0 && !estadosOCSeleccionados.has(c.EstadoOC)) return false;
    if (naviera && c.Naviera !== naviera) return false;
    if (estado && String(c.EstadoActual || '').trim() !== estado.trim()) return false;
    if (retraso === 'si' && !(c.Retrasado === true || c.Retrasado === 'TRUE')) return false;
    if (retraso === 'no' && (c.Retrasado === true || c.Retrasado === 'TRUE')) return false;
    if (texto) {
      const campo = [c.Contenedor, c.MasterBL, c.Booking, c.PO, c.OC_Odoo].join(' ').toLowerCase();
      if (!campo.includes(texto)) return false;
    }
    return true;
  });
}

// Ordena por el campo/dirección elegidos al hacer clic en un encabezado.
// Fechas (YYYY-MM-DD) y texto ordenan bien con comparación simple; ValorUSD
// se compara como número.
function ordenarDatos(data) {
  if (!orden.campo) return data;
  const campo = orden.campo;
  const copia = [...data];
  copia.sort((a, b) => {
    let va = a[campo], vb = b[campo];
    if (campo === 'ValorUSD') {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else {
      va = String(va || '');
      vb = String(vb || '');
    }
    // Vacíos siempre al final, sin importar la dirección.
    if (va === '' && vb === '') return 0;
    if (va === '') return 1;
    if (vb === '') return -1;
    if (va < vb) return -1 * orden.dir;
    if (va > vb) return 1 * orden.dir;
    return 0;
  });
  return copia;
}

function actualizarFlechasOrden() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const flecha = th.querySelector('.sort-arrow');
    if (th.dataset.field === orden.campo) {
      flecha.textContent = orden.dir === 1 ? ' ▲' : ' ▼';
    } else {
      flecha.textContent = '';
    }
  });
}

function urlNaviera(nombreNaviera) {
  const cfg = configNavieras.find(n => n.Naviera === nombreNaviera);
  return cfg ? cfg.URLTracking : '';
}

function formatoUSD(valor) {
  const n = Number(valor);
  if (!valor || isNaN(n)) return '';
  return 'US$ ' + n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderTabla() {
  const base = mostrarCerrados ? maestro : maestro.filter(c => !ordenCerradaDeVerdad(c));
  const filtrados = ordenarDatos(aplicarFiltros(base));
  const tbody = document.getElementById('tablaBody');
  actualizarFlechasOrden();
  renderKpis(filtrados);

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="27" class="empty-state">Sin contenedores para estos filtros.</td></tr>';
    return;
  }

  tbody.innerHTML = filtrados.map(c => {
    const url = urlNaviera(c.Naviera);
    const linkTracking = url
      ? `<a href="${url}" target="_blank" rel="noopener" class="link-tracking" title="Abrir sitio de ${c.Naviera}">Ver tracking ↗</a>`
      : '';
    const naveViaje = [c.Nave, c.Viaje].filter(Boolean).join(' / ');
    return `
    <tr>
      <td>${c.FechaEsperadaOC || ''}</td>
      <td><strong>${c.Contenedor || ''}</strong></td>
      <td>${c.TipoContenedor || ''}</td>
      <td>${c.MasterBL || ''}</td>
      <td>${c.Booking || ''}</td>
      <td>${c.Naviera || ''}</td>
      <td>${naveViaje}</td>
      <td>${c.PO || ''}</td>
      <td>${c.OC_Odoo || ''}</td>
      <td>${c.NumOrdenProveedor || ''}</td>
      <td>${ESTADO_OC_LABEL[c.EstadoOC] || c.EstadoOC || ''}${(c.EstadoOC === 'done' && !ordenCerradaDeVerdad(c)) ? '<span class="pill-pendiente" title="Cerrada en Odoo (importación anticipada), pero aún no se registra la recepción en destino">imp. anticipada</span>' : ''}</td>
      <td>${c.Proveedor || ''}</td>
      <td>${c.PaisOrigen || ''}</td>
      <td>${c.Empresa || ''}</td>
      <td>${formatoUSD(c.ValorUSD)}</td>
      <td>${c.DiasLibres !== undefined && c.DiasLibres !== '' && c.DiasLibres !== null ? c.DiasLibres : ''}</td>
      <td>${c.PuertoDestino || ''}</td>
      <td>${c.FechaLiberacionPOD || ''}</td>
      <td>${badgeDespacho(c.TipoDespacho)}</td>
      <td>${c.FechaRecepcionDestino || ''}</td>
      <td>${diasPodACD(c)}</td>
      <td>${c.ETA_Original || ''}</td>
      <td>${c.ETA_Actual || ''}</td>
      <td>${badgeEstado(c.EstadoActual)}${(c.PendienteRevision === true || c.PendienteRevision === 'TRUE') ? '<span class="pill-pendiente">pendiente revisión</span>' : ''}</td>
      <td>${badgeRetraso(c)}</td>
      <td>${c.FechaUltimoUpdate || ''}</td>
      <td class="row-actions">${linkTracking}<button data-id="${c.ID}" class="btnEditarEstado">Actualizar</button>${c.OC_Odoo ? `<button data-oc="${c.OC_Odoo}" class="btnVerDetalle">Detalle</button>` : ''}</td>
    </tr>
  `;
  }).join('');

  document.querySelectorAll('.btnEditarEstado').forEach(btn => {
    btn.addEventListener('click', () => abrirModalEstado(btn.dataset.id));
  });
  document.querySelectorAll('.btnVerDetalle').forEach(btn => {
    btn.addEventListener('click', () => abrirModalDetalle(btn.dataset.oc));
  });
}

// ---------- Modal detalle de productos ----------

let detalleOCActual = ''; // OC abierta en el modal, usada por el botón Exportar a Excel

function abrirModalDetalle(ocOdoo) {
  detalleOCActual = ocOdoo;
  const lineas = detalleProductos.filter(d => d.OC_Odoo === ocOdoo);
  document.getElementById('detalleOCLabel').textContent = `OC ${ocOdoo}`;
  const tbody = document.getElementById('detalleTablaBody');
  let totalUSD = 0;
  if (!lineas.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Sin líneas de producto para esta OC.</td></tr>';
  } else {
    tbody.innerHTML = lineas.map(l => {
      totalUSD += Number(l.SubtotalUSD) || 0;
      return `
      <tr>
        <td>${l.Producto || ''}</td>
        <td>${l.SKU || ''}</td>
        <td>${l.Cantidad || ''}</td>
      </tr>`;
    }).join('');
  }
  document.getElementById('detalleTotalUSD').textContent = lineas.length
    ? `Total compra: ${formatoUSD(totalUSD)}`
    : '';
  document.getElementById('modalDetalle').classList.add('open');
}

// El Web App manda el .xlsx codificado en base64 dentro del JSON de siempre
// (Apps Script no admite devolver un Blob directo desde doGet) - acá se
// decodifica y se arma la descarga del lado del navegador.
async function exportarDetalleExcel() {
  if (!detalleOCActual) return;
  const btn = document.getElementById('btnExportarDetalle');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    const data = await apiGet('exportDetalleOC', { oc: detalleOCActual });
    const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], {
      type: data.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename || `Detalle ${detalleOCActual}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error generando el Excel: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function cerrarModalDetalle() {
  document.getElementById('modalDetalle').classList.remove('open');
}

// Mientras carga: overlay con barco navegando encima de filtros + tabla, y los
// controles quedan disabled de verdad (no solo tapados), para que no quede la
// sensación de "esto no funciona" si alguien alcanza a hacer clic antes de que
// el overlay termine de pintarse.
function bloquearPanelDatos_(bloquear) {
  document.getElementById('loadingOverlay').hidden = !bloquear;
  document.querySelectorAll('#panelDatos select, #panelDatos input, #panelDatos button')
    .forEach(el => { el.disabled = bloquear; });
}

async function cargarDatos() {
  if (!checkConfig()) return;
  bloquearPanelDatos_(true);
  document.getElementById('tablaBody').innerHTML = '<tr><td colspan="27" class="empty-state">Cargando…</td></tr>';
  try {
    const [maestroData, configData, detalleData] = await Promise.all([
      apiGet('maestro'),
      apiGet('config'),
      apiGet('detalle')
    ]);
    maestro = maestroData;
    configNavieras = configData;
    detalleProductos = detalleData;
    poblarFiltros();
    renderTabla();
    actualizarUltimaSync(maestro);
  } catch (err) {
    document.getElementById('tablaBody').innerHTML =
      `<tr><td colspan="27" class="empty-state">Error cargando datos: ${err.message}</td></tr>`;
  } finally {
    bloquearPanelDatos_(false);
  }
}

// ---------- Modal nuevo contenedor ----------

function abrirModalNuevo() {
  document.getElementById('modalNuevo').classList.add('open');
}
function cerrarModalNuevo() {
  document.getElementById('modalNuevo').classList.remove('open');
}

async function guardarNuevo() {
  const data = {
    Contenedor: document.getElementById('f_contenedor').value.trim(),
    TipoContenedor: document.getElementById('f_tipo').value,
    MasterBL: document.getElementById('f_bl').value.trim(),
    Booking: document.getElementById('f_booking').value.trim(),
    Naviera: document.getElementById('f_naviera').value.trim(),
    Nave: document.getElementById('f_nave').value.trim(),
    Viaje: document.getElementById('f_viaje').value.trim(),
    PO: document.getElementById('f_po').value.trim(),
    OC_Odoo: document.getElementById('f_oc').value.trim(),
    Proveedor: document.getElementById('f_proveedor').value.trim(),
    ValorUSD: document.getElementById('f_valor').value,
    PuertoDestino: document.getElementById('f_puerto').value,
    ETA_Original: document.getElementById('f_eta').value,
    ETA_Actual: document.getElementById('f_eta').value,
    FechaLiberacionPOD: document.getElementById('f_fecha_liberacion').value,
    TipoDespacho: document.getElementById('f_tipo_despacho').value,
    EstadoActual: document.getElementById('f_estado').value,
    Notas: document.getElementById('f_notas').value.trim()
  };
  if (!data.Contenedor && !data.MasterBL) {
    alert('Ingresa al menos el número de contenedor o el Master BL.');
    return;
  }
  await conBotonCargando('btnGuardarNuevo', async () => {
    await apiPost('addContainer', data);
    cerrarModalNuevo();
    ['f_contenedor','f_bl','f_booking','f_naviera','f_nave','f_viaje','f_po','f_oc','f_proveedor','f_valor','f_eta','f_notas','f_fecha_liberacion']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('f_tipo').value = '';
    document.getElementById('f_tipo_despacho').value = '';
    document.getElementById('f_puerto').value = '';
    await cargarDatos();
  });
}

// ---------- Modal actualizar estado ----------

let idEnEdicion = null;

function abrirModalEstado(id) {
  const c = maestro.find(m => m.ID === id);
  if (!c) return;
  idEnEdicion = id;
  const url = urlNaviera(c.Naviera);
  const avisoImportacionAnticipada = (c.EstadoOC === 'done' && !ordenCerradaDeVerdad(c))
    ? '<br><span style="color:var(--brand-pop);font-weight:600;">Cerrada en Odoo por importación anticipada — registra la fecha de recepción en destino abajo para sacarla del tracking activo.</span>'
    : '';
  document.getElementById('estadoContenedorLabel').innerHTML =
    `${c.Contenedor || c.MasterBL} — ${c.Naviera || ''}` +
    (url ? ` · <a href="${url}" target="_blank" rel="noopener">Abrir sitio de la naviera ↗</a>` : '') +
    avisoImportacionAnticipada;
  document.getElementById('e_estado').value = c.EstadoActual;
  document.getElementById('e_eta').value = c.ETA_Actual || '';
  document.getElementById('e_notas').value = '';
  document.getElementById('e_tipo').value = c.TipoContenedor || '';
  document.getElementById('e_bl').value = c.MasterBL || '';
  document.getElementById('e_booking').value = c.Booking || '';
  document.getElementById('e_nave').value = c.Nave || '';
  document.getElementById('e_viaje').value = c.Viaje || '';
  document.getElementById('e_po').value = c.PO || '';
  document.getElementById('e_oc').value = c.OC_Odoo || '';
  document.getElementById('e_proveedor').value = c.Proveedor || '';
  document.getElementById('e_valor').value = c.ValorUSD || '';
  document.getElementById('e_puerto').value = c.PuertoDestino || '';
  document.getElementById('e_eta_original').value = c.ETA_Original || '';
  document.getElementById('e_fecha_liberacion').value = c.FechaLiberacionPOD || '';
  document.getElementById('e_tipo_despacho').value = c.TipoDespacho || '';
  document.getElementById('e_fecha_recepcion').value = c.FechaRecepcionDestino || '';
  document.getElementById('modalEstado').classList.add('open');
}
function cerrarModalEstado() {
  document.getElementById('modalEstado').classList.remove('open');
}

async function guardarEstado() {
  const estadoData = {
    ID: idEnEdicion,
    EstadoActual: document.getElementById('e_estado').value,
    ETA_Actual: document.getElementById('e_eta').value,
    Notas: document.getElementById('e_notas').value.trim()
  };
  const datosData = {
    ID: idEnEdicion,
    TipoContenedor: document.getElementById('e_tipo').value,
    MasterBL: document.getElementById('e_bl').value.trim(),
    Booking: document.getElementById('e_booking').value.trim(),
    Nave: document.getElementById('e_nave').value.trim(),
    Viaje: document.getElementById('e_viaje').value.trim(),
    PO: document.getElementById('e_po').value.trim(),
    OC_Odoo: document.getElementById('e_oc').value.trim(),
    Proveedor: document.getElementById('e_proveedor').value.trim(),
    ValorUSD: document.getElementById('e_valor').value,
    PuertoDestino: document.getElementById('e_puerto').value,
    ETA_Original: document.getElementById('e_eta_original').value,
    FechaLiberacionPOD: document.getElementById('e_fecha_liberacion').value,
    TipoDespacho: document.getElementById('e_tipo_despacho').value,
    FechaRecepcionDestino: document.getElementById('e_fecha_recepcion').value
  };
  await conBotonCargando('btnGuardarEstado', async () => {
    // En paralelo, no en serie: corta a la mitad el tiempo de espera.
    await Promise.all([
      apiPost('updateEstado', estadoData),
      apiPost('updateContainer', datosData)
    ]);
    cerrarModalEstado();
    await cargarDatos();
  });
}

// ---------- Utilidad: feedback visual mientras se guarda ----------

async function conBotonCargando(idBoton, tarea) {
  const btn = document.getElementById(idBoton);
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await tarea();
  } catch (err) {
    alert('Error al guardar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ---------- Init ----------

function init() {
  llenarSelectsEstado();
  checkConfig();

  document.getElementById('btnNuevo').addEventListener('click', abrirModalNuevo);
  document.getElementById('btnCancelarNuevo').addEventListener('click', cerrarModalNuevo);
  document.getElementById('btnGuardarNuevo').addEventListener('click', guardarNuevo);

  document.getElementById('btnCancelarEstado').addEventListener('click', cerrarModalEstado);
  document.getElementById('btnGuardarEstado').addEventListener('click', guardarEstado);

  document.getElementById('btnCerrarDetalle').addEventListener('click', cerrarModalDetalle);
  document.getElementById('btnExportarDetalle').addEventListener('click', exportarDetalleExcel);

  document.getElementById('btnRefrescar').addEventListener('click', cargarDatos);
  ['filtroEmpresa','filtroNaviera','filtroEstado','filtroRetraso','filtroTexto'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderTabla);
  });
  document.getElementById('filtroMostrarCerrados').addEventListener('change', (e) => {
    mostrarCerrados = e.target.checked;
    poblarFiltros();
    renderTabla();
  });
  initMultiselectEstadoOC();

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const campo = th.dataset.field;
      if (orden.campo === campo) {
        orden.dir *= -1;
      } else {
        orden.campo = campo;
        orden.dir = 1;
      }
      renderTabla();
    });
  });

  cargarDatos();
}

document.addEventListener('DOMContentLoaded', init);

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
  'Loaded':         'Cargado a bordo',
  'Departed':       'Zarpó',
  'Transshipment':  'Transbordo',
  'Arrived':        'Arribó a puerto',
  'Discharged':     'Descargado',
  'Available':      'Disponible para retiro',
  'Gate Out':       'Retirado del puerto',
  'Delivered':      'Entregado en CD'
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
      '<tr><td colspan="17" class="empty-state">Configura API_URL en app.js para cargar datos.</td></tr>';
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

function poblarFiltros() {
  const navieras = [...new Set(maestro.map(c => c.Naviera).filter(Boolean))].sort();
  const selNav = document.getElementById('filtroNaviera');
  selNav.innerHTML = '<option value="">Todas las navieras</option>' +
    navieras.map(n => `<option value="${n}">${n}</option>`).join('');

  const selEstado = document.getElementById('filtroEstado');
  selEstado.innerHTML = '<option value="">Todos los estados</option>' +
    ESTADOS.map(e => `<option value="${e}">${ESTADO_LABEL[e] || e}</option>`).join('');

  document.getElementById('listaNavieras').innerHTML =
    configNavieras.map(n => `<option value="${n.Naviera}">`).join('');
}

function renderKpis() {
  const enTransito = ['Booking', 'Loaded', 'Departed', 'Transshipment'];
  const activos = maestro.filter(c => c.EstadoActual !== 'Delivered');
  const kpis = {
    'En tránsito': activos.filter(c => enTransito.includes(c.EstadoActual)).length,
    'Arribados': maestro.filter(c => c.EstadoActual === 'Arrived').length,
    'Disponibles retiro': maestro.filter(c => c.EstadoActual === 'Available').length,
    'Retirados (Gate Out)': maestro.filter(c => c.EstadoActual === 'Gate Out').length,
    'Recibidos en CD': maestro.filter(c => c.EstadoActual === 'Delivered').length,
    'Retrasados': maestro.filter(c => c.Retrasado === true || c.Retrasado === 'TRUE').length
  };

  const row = document.getElementById('kpiRow');
  row.innerHTML = Object.entries(kpis).map(([label, val]) => {
    const cls = label === 'Retrasados' ? (val > 0 ? 'alert' : 'ok') : '';
    return `<div class="stat-tile ${cls}"><div class="label">${label}</div><div class="value">${val}</div></div>`;
  }).join('');
}

function aplicarFiltros(data) {
  const naviera = document.getElementById('filtroNaviera').value;
  const estado = document.getElementById('filtroEstado').value;
  const retraso = document.getElementById('filtroRetraso').value;
  const texto = document.getElementById('filtroTexto').value.trim().toLowerCase();

  return data.filter(c => {
    if (naviera && c.Naviera !== naviera) return false;
    if (estado && c.EstadoActual !== estado) return false;
    if (retraso === 'si' && !(c.Retrasado === true || c.Retrasado === 'TRUE')) return false;
    if (retraso === 'no' && (c.Retrasado === true || c.Retrasado === 'TRUE')) return false;
    if (texto) {
      const campo = [c.Contenedor, c.MasterBL, c.Booking, c.PO].join(' ').toLowerCase();
      if (!campo.includes(texto)) return false;
    }
    return true;
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
  const filtrados = aplicarFiltros(maestro);
  const tbody = document.getElementById('tablaBody');

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" class="empty-state">Sin contenedores para estos filtros.</td></tr>';
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
      <td><strong>${c.Contenedor || ''}</strong></td>
      <td>${c.TipoContenedor || ''}</td>
      <td>${c.MasterBL || ''}</td>
      <td>${c.Booking || ''}</td>
      <td>${c.Naviera || ''}</td>
      <td>${naveViaje}</td>
      <td>${c.PO || ''}</td>
      <td>${c.OC_Odoo || ''}</td>
      <td>${c.Proveedor || ''}</td>
      <td>${formatoUSD(c.ValorUSD)}</td>
      <td>${c.PuertoDestino || ''}</td>
      <td>${c.ETA_Original || ''}</td>
      <td>${c.ETA_Actual || ''}</td>
      <td>${badgeEstado(c.EstadoActual)}${(c.PendienteRevision === true || c.PendienteRevision === 'TRUE') ? '<div class="pill-pendiente">pendiente revisión</div>' : ''}</td>
      <td>${badgeRetraso(c)}</td>
      <td>${c.FechaUltimoUpdate || ''}</td>
      <td class="row-actions">${linkTracking}<button data-id="${c.ID}" class="btnEditarEstado">Actualizar</button></td>
    </tr>
  `;
  }).join('');

  document.querySelectorAll('.btnEditarEstado').forEach(btn => {
    btn.addEventListener('click', () => abrirModalEstado(btn.dataset.id));
  });
}

async function cargarDatos() {
  if (!checkConfig()) return;
  document.getElementById('tablaBody').innerHTML = '<tr><td colspan="17" class="empty-state">Cargando…</td></tr>';
  try {
    const [maestroData, configData] = await Promise.all([
      apiGet('maestro'),
      apiGet('config')
    ]);
    maestro = maestroData;
    configNavieras = configData;
    poblarFiltros();
    renderKpis();
    renderTabla();
  } catch (err) {
    document.getElementById('tablaBody').innerHTML =
      `<tr><td colspan="17" class="empty-state">Error cargando datos: ${err.message}</td></tr>`;
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
    ['f_contenedor','f_bl','f_booking','f_naviera','f_nave','f_viaje','f_po','f_oc','f_proveedor','f_valor','f_eta','f_notas']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('f_tipo').value = '';
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
  document.getElementById('estadoContenedorLabel').innerHTML =
    `${c.Contenedor || c.MasterBL} — ${c.Naviera || ''}` +
    (url ? ` · <a href="${url}" target="_blank" rel="noopener">Abrir sitio de la naviera ↗</a>` : '');
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
    ETA_Original: document.getElementById('e_eta_original').value
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

  document.getElementById('btnRefrescar').addEventListener('click', cargarDatos);
  ['filtroNaviera','filtroEstado','filtroRetraso','filtroTexto'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderTabla);
  });

  cargarDatos();
}

document.addEventListener('DOMContentLoaded', init);

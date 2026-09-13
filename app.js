(function(){
  "use strict";

  // ---------------------------------------------------------------
  // ESTADO (único lugar con variables mutables de la aplicación)
  // ---------------------------------------------------------------
  let paises = [];
  let busqueda = '';
  let regionSeleccionada = 'all';
  let campoOrden = 'name';
  let ordenAscendente = true;
  let paginaActual = 1;
  const TAMANO_PAGINA = 20;

  let favoritos = leerFavoritosGuardados();
  let comparados = [];

  function leerFavoritosGuardados(){
    try{
      const guardado = localStorage.getItem('paises_favoritos');
      const lista = guardado ? JSON.parse(guardado) : [];
      return Array.isArray(lista) ? lista : [];
    }catch(e){
      return [];
    }
  }

  // ---------------------------------------------------------------
  // REFERENCIAS DOM
  // ---------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const elCarga = $('#estado-carga');
  const elError = $('#estado-error');
  const elControles = $('#controles');
  const elStats = $('#panel-stats');
  const elGrid = $('#grid-paises');
  const elVacio = $('#mensaje-vacio');
  const elPaginacion = $('#paginacion');
  const elBuscador = $('#buscador');
  const elFiltroRegion = $('#filtro-region');
  const elOrdenCampo = $('#orden-campo');
  const elOrdenDireccion = $('#orden-direccion');
  const elContadorFavs = $('#contador-favs');
  const elContadorComp = $('#contador-comp');

  // ---------------------------------------------------------------
  // CARGA DE DATOS (una sola vez, directo desde restcountries.com v5)
  // ---------------------------------------------------------------
  // NOTA: restcountries.com/v3.1 fue dado de baja por su proveedor; la API
  // vigente es v5, que exige una API key y un origen (CORS) autorizado en
  // restcountries.com/api-keys.

  // ⚠️ CLAVE VISIBLE: esta key queda expuesta para cualquiera que abra este
  // archivo (Ver código fuente / DevTools). No la subas a un repo público.
  const RESTCOUNTRIES_V5_API_KEY = 'rc_live_d8839ab07c924f7381d399a6f30dc2c6';

  async function cargarDesdeRestCountriesV5(){
    console.log('[Explorador] Intentando restcountries v5...');
    const campos = [
      'names.common', 'codes.alpha_2', 'codes.alpha_3', 'capitals',
      'population', 'region', 'area.kilometers',
      'coordinates.lat', 'coordinates.lng', 'flag.url_png'
    ].join(',');

    // v5 pagina de a 100 como máximo en el plan gratis; con 3 páginas fijas
    // (0, 100, 200) cubrimos los ~249 países sin usar un while/for dinámico.
    const offsets = [0, 100, 200];
    const respuestas = await Promise.all(
      offsets.map((offset) =>
        fetch(
          `https://api.restcountries.com/countries/v5?limit=100&offset=${offset}&response_fields=${encodeURIComponent(campos)}`,
          { headers: { Authorization: `Bearer ${RESTCOUNTRIES_V5_API_KEY}` } }
        ).then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
      )
    );

    const crudos = respuestas.flatMap((r) => (r.data && r.data.objects) || []);
    if (crudos.length === 0) throw new Error('v5 no devolvió países');

    // Traducimos el esquema nuevo de v5 al mismo formato que usa el resto
    // de la app (igual al que tenía v3.1), para no tocar ninguna otra función.
    return crudos.map((p) => ({
      name: { common: p.names?.common },
      cca2: p.codes?.alpha_2,
      cca3: p.codes?.alpha_3,
      capital: (p.capitals || []).map((c) => c.name).filter(Boolean),
      population: typeof p.population === 'number' ? p.population : 0,
      region: p.region,
      area: p.area?.kilometers,
      latlng: [p.coordinates?.lat, p.coordinates?.lng],
      flags: { png: p.flag?.url_png }
    }));
  }

  async function cargarPaises(){
    elError.hidden = true;
    elCarga.hidden = false;

    let resultado = null;
    try {
      resultado = await cargarDesdeRestCountriesV5();
    } catch (err) {
      console.error('[Explorador] Falló restcountries v5. Motivo:', err);
      resultado = null;
    }

    if (!resultado || !Array.isArray(resultado) || resultado.length === 0){
      elCarga.hidden = true;
      elError.hidden = false;
      return;
    }

    paises = resultado;
    elCarga.hidden = true;
    inicializarInterfaz();
  }

  // ---------------------------------------------------------------
  // HELPERS PUROS SOBRE EL ARRAY (map/filter/reduce/find/some/every/sort)
  // ---------------------------------------------------------------
  const nombreDe = (p) => (p && p.name && p.name.common) || 'Desconocido';
  const capitalDe = (p) => (p && p.capital && p.capital[0]) || null;

  function obtenerRegiones(){
    return [...new Set(paises.map((p) => p.region).filter(Boolean))].sort();
  }

  function compararPorCampo(a, b, campo){
    if (campo === 'population') return (a.population || 0) - (b.population || 0);
    if (campo === 'area') return (a.area || 0) - (b.area || 0);
    return nombreDe(a).localeCompare(nombreDe(b));
  }

  // Cadena única: filtro por región + búsqueda + orden, sin variables globales intermedias.
  function obtenerListaFiltrada(){
    const termino = busqueda.trim().toLowerCase();
    const resultado = [...paises]
      .filter((p) => regionSeleccionada === 'all' || p.region === regionSeleccionada)
      .filter((p) => nombreDe(p).toLowerCase().includes(termino))
      .sort((a, b) => compararPorCampo(a, b, campoOrden));
    if (!ordenAscendente) resultado.reverse();
    return resultado;
  }

  // Misma cadena + paginación con slice().
  function obtenerListaVisible(){
    return obtenerListaFiltrada().slice(
      (paginaActual - 1) * TAMANO_PAGINA,
      paginaActual * TAMANO_PAGINA
    );
  }

  function calcularEstadisticas(){
    const poblaciones = paises.map((p) => p.population || 0);
    const poblacionTotal = poblaciones.reduce((acc, n) => acc + n, 0);
    const poblacionMedia = paises.length ? poblacionTotal / paises.length : 0;
    const maxPoblacion = poblaciones.length ? Math.max(...poblaciones) : 0;
    const paisMasPoblado = paises.find((p) => (p.population || 0) === maxPoblacion);
    const haySinCapital = paises.some((p) => !capitalDe(p));
    return { poblacionTotal, poblacionMedia, paisMasPoblado, haySinCapital };
  }

  // ---------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------
  function inicializarInterfaz(){
    renderFiltroRegion();
    elControles.hidden = false;
    elStats.hidden = false;
    elGrid.hidden = false;
    elPaginacion.hidden = false;
    renderTodo();
  }

  function renderTodo(){
    renderStats();
    renderGrid();
    renderPaginacion();
    actualizarContadores();
  }

  function renderFiltroRegion(){
    const regiones = obtenerRegiones();
    elFiltroRegion.innerHTML = ['<option value="all">Todas las regiones</option>']
      .concat(regiones.map((r) => `<option value="${r}">${r}</option>`))
      .join('');
  }

  function renderStats(){
    const s = calcularEstadisticas();
    const celdas = [
      { valor: s.poblacionTotal.toLocaleString('es'), etiqueta: 'Población mundial total' },
      { valor: Math.round(s.poblacionMedia).toLocaleString('es'), etiqueta: 'Población media por país' },
      { valor: s.paisMasPoblado ? nombreDe(s.paisMasPoblado) : '—', etiqueta: 'País más poblado' },
      { valor: s.haySinCapital ? 'Sí' : 'No', etiqueta: '¿Algún país sin capital registrada?' }
    ];
    elStats.innerHTML = celdas
      .map((c) => `<div class="stat-celda"><span class="valor">${c.valor}</span><span class="etiqueta">${c.etiqueta}</span></div>`)
      .join('');
  }

  function renderTarjeta(p){
    const esFav = favoritos.includes(p.cca3);
    const enComp = comparados.includes(p.cca3);
    return `
      <article class="tarjeta-pais" data-code="${p.cca3}">
        <img class="tarjeta-bandera" src="${(p.flags && p.flags.png) || ''}" alt="Bandera de ${nombreDe(p)}" loading="lazy">
        <div class="tarjeta-cuerpo">
          <h3>${nombreDe(p)}</h3>
          <p class="tarjeta-dato">Capital: ${capitalDe(p) || '—'}</p>
          <p class="tarjeta-dato">Población: ${(p.population || 0).toLocaleString('es')}</p>
          <div class="tarjeta-acciones">
            <button class="btn-icono btn-fav ${esFav ? 'activo' : ''}" data-accion="favorito" data-code="${p.cca3}">${esFav ? '★ Guardado' : '☆ Guardar'}</button>
            <button class="btn-icono btn-comp ${enComp ? 'activo' : ''}" data-accion="comparar" data-code="${p.cca3}">${enComp ? '✓ En comparador' : '+ Comparar'}</button>
          </div>
        </div>
      </article>`;
  }

  function renderGrid(){
    const visibles = obtenerListaVisible();
    elVacio.hidden = visibles.length !== 0;
    elGrid.innerHTML = visibles.map(renderTarjeta).join('');
  }

  function renderPaginacion(){
    const total = obtenerListaFiltrada().length;
    const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
    if (paginaActual > totalPaginas) paginaActual = totalPaginas;

    const numeros = Array.from({ length: totalPaginas }, (_, i) => i + 1);
    elPaginacion.innerHTML = numeros
      .map((n) => `<button class="pagina-btn ${n === paginaActual ? 'activa' : ''}" data-pagina="${n}">${n}</button>`)
      .join('');
  }

  function actualizarContadores(){
    elContadorFavs.textContent = favoritos.length;
    elContadorComp.textContent = comparados.length;
  }

  function mostrarAviso(texto){
    const previo = document.querySelector('.aviso-toast');
    if (previo) previo.remove();
    const toast = document.createElement('div');
    toast.className = 'aviso-toast';
    toast.textContent = texto;
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  // ---------------------------------------------------------------
  // FAVORITOS (localStorage)
  // ---------------------------------------------------------------
  function alternarFavorito(code){
    favoritos = favoritos.includes(code)
      ? favoritos.filter((c) => c !== code)
      : [...favoritos, code];
    localStorage.setItem('paises_favoritos', JSON.stringify(favoritos));
    renderGrid();
    actualizarContadores();
  }

  // ---------------------------------------------------------------
  // COMPARADOR (máximo 3)
  // ---------------------------------------------------------------
  function alternarComparar(code){
    if (comparados.includes(code)){
      comparados = comparados.filter((c) => c !== code);
    } else {
      if (comparados.length >= 3){
        mostrarAviso('Ya tienes 3 países en el comparador. Quita uno para añadir otro.');
        return;
      }
      comparados = [...comparados, code];
    }
    renderGrid();
    actualizarContadores();
  }

  // ---------------------------------------------------------------
  // MODAL DETALLE
  // ---------------------------------------------------------------
  function abrirDetalle(code){
    const pais = paises.find((p) => p.cca3 === code);
    if (!pais) return;
    const filas = [
      ['Nombre oficial', (pais.name && pais.name.official) || '—'],
      ['Región', pais.region || '—'],
      ['Capital', capitalDe(pais) || '—'],
      ['Población', (pais.population || 0).toLocaleString('es')],
      ['Superficie', pais.area ? pais.area.toLocaleString('es') + ' km²' : '—']
    ];
    $('#modal-detalle-contenido').innerHTML = `
      <button class="modal-cerrar" data-cerrar="modal-detalle" aria-label="Cerrar">×</button>
      <img class="modal-bandera" src="${(pais.flags && pais.flags.png) || ''}" alt="Bandera de ${nombreDe(pais)}">
      <h2>${nombreDe(pais)}</h2>
      ${filas.map(([etiqueta, valor]) => `<div class="detalle-fila"><span>${etiqueta}</span><strong>${valor}</strong></div>`).join('')}
    `;
    $('#modal-detalle').hidden = false;
  }

  // ---------------------------------------------------------------
  // MODAL FAVORITOS + CLIMA (Promise.all)
  // ---------------------------------------------------------------
  async function abrirFavoritos(){
    $('#modal-favoritos').hidden = false;
    const contenedor = $('#lista-favoritos');

    const paisesFavoritos = favoritos.map((code) => paises.find((p) => p.cca3 === code)).filter(Boolean);

    if (paisesFavoritos.length === 0){
      contenedor.innerHTML = '<p class="vacio">Aún no guardaste ningún país. Toca ☆ en una tarjeta para añadirlo aquí.</p>';
      return;
    }

    contenedor.innerHTML = paisesFavoritos
      .map((p) => filaFavorito(p, 'Consultando clima…'))
      .join('');

    const conClima = await Promise.all(
      paisesFavoritos.map(async (p) => {
        if (!p.latlng || p.latlng.length < 2) return { p, clima: 'Sin coordenadas disponibles' };
        try {
          const [lat, lon] = p.latlng;
          const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const datos = await res.json();
          const actual = datos.current_weather;
          return {
            p,
            clima: actual ? `${actual.temperature}°C · viento ${actual.windspeed} km/h` : 'Clima no disponible'
          };
        } catch (e) {
          return { p, clima: 'No se pudo obtener el clima' };
        }
      })
    );

    contenedor.innerHTML = conClima.map(({ p, clima }) => filaFavorito(p, clima)).join('');
  }

  function filaFavorito(p, textoClima){
    return `
      <div class="fav-fila" data-code="${p.cca3}">
        <img src="${(p.flags && p.flags.png) || ''}" alt="Bandera de ${nombreDe(p)}">
        <div class="fav-info">
          <h4>${nombreDe(p)}</h4>
          <div class="fav-clima">${textoClima}</div>
        </div>
        <button class="fav-quitar" data-accion="quitar-favorito" data-code="${p.cca3}">Quitar</button>
      </div>`;
  }

  // ---------------------------------------------------------------
  // MODAL COMPARADOR
  // ---------------------------------------------------------------
  function abrirComparador(){
    $('#modal-comparar').hidden = false;
    const contenedor = $('#tabla-comparar');
    const seleccionados = comparados.map((code) => paises.find((p) => p.cca3 === code)).filter(Boolean);

    if (seleccionados.length === 0){
      contenedor.innerHTML = '<p class="vacio">Selecciona hasta 3 países con el botón "+ Comparar" en cada tarjeta.</p>';
      return;
    }

    const filas = [
      { etiqueta: 'Bandera', valor: (p) => `<img src="${(p.flags && p.flags.png) || ''}" alt="">` },
      { etiqueta: 'Nombre', valor: (p) => nombreDe(p) },
      { etiqueta: 'Región', valor: (p) => p.region || '—' },
      { etiqueta: 'Capital', valor: (p) => capitalDe(p) || '—' },
      { etiqueta: 'Población', valor: (p) => (p.population || 0).toLocaleString('es') },
      { etiqueta: 'Superficie', valor: (p) => (p.area ? p.area.toLocaleString('es') + ' km²' : '—') }
    ];

    contenedor.innerHTML = `
      <table class="tabla-comparar">
        <tbody>
          ${filas
            .map(
              (fila) => `
            <tr>
              <th>${fila.etiqueta}</th>
              ${seleccionados.map((p) => `<td>${fila.valor(p)}</td>`).join('')}
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------
  // EVENTOS
  // ---------------------------------------------------------------
  elBuscador.addEventListener('input', (e) => {
    busqueda = e.target.value;
    paginaActual = 1;
    renderGrid();
    renderPaginacion();
  });

  elFiltroRegion.addEventListener('change', (e) => {
    regionSeleccionada = e.target.value;
    paginaActual = 1;
    renderGrid();
    renderPaginacion();
  });

  elOrdenCampo.addEventListener('change', (e) => {
    campoOrden = e.target.value;
    renderGrid();
    renderPaginacion();
  });

  elOrdenDireccion.addEventListener('click', () => {
    ordenAscendente = !ordenAscendente;
    elOrdenDireccion.textContent = ordenAscendente ? '↑ Ascendente' : '↓ Descendente';
    renderGrid();
    renderPaginacion();
  });

  $('#btn-favoritos').addEventListener('click', abrirFavoritos);
  $('#btn-comparar').addEventListener('click', abrirComparador);
  $('#btn-reintentar').addEventListener('click', cargarPaises);

  elPaginacion.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-pagina]');
    if (!boton) return;
    paginaActual = Number(boton.dataset.pagina);
    renderGrid();
    renderPaginacion();
    window.scrollTo({ top: elGrid.offsetTop - 20, behavior: 'smooth' });
  });

  elGrid.addEventListener('click', (e) => {
    const botonAccion = e.target.closest('[data-accion]');
    if (botonAccion){
      const code = botonAccion.dataset.code;
      if (botonAccion.dataset.accion === 'favorito') alternarFavorito(code);
      if (botonAccion.dataset.accion === 'comparar') alternarComparar(code);
      return;
    }
    const tarjeta = e.target.closest('.tarjeta-pais');
    if (tarjeta) abrirDetalle(tarjeta.dataset.code);
  });

  $('#lista-favoritos').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion="quitar-favorito"]');
    if (!boton) return;
    alternarFavorito(boton.dataset.code);
    abrirFavoritos();
  });

  document.addEventListener('click', (e) => {
    const cerrar = e.target.closest('[data-cerrar]');
    if (cerrar){
      document.getElementById(cerrar.dataset.cerrar).hidden = true;
      return;
    }
    if (e.target.classList.contains('modal-overlay')){
      e.target.hidden = true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      document.querySelectorAll('.modal-overlay').forEach((m) => { m.hidden = true; });
    }
  });

  // ---------------------------------------------------------------
  // ARRANQUE
  // ---------------------------------------------------------------
  cargarPaises();
})();

/**
 * The read-only memory observatory's page.
 *
 * Three views over one snapshot, one scope (project + agent) and one watermark, so a reader always
 * knows which moment of which corpus they are looking at: a 3D star map of the Memory Atlas, the
 * ledger's shape over time, and the recall decisions that were actually stored.
 *
 * The star map encodes three things and no more — the arm is a node's top-level grouping, the colour
 * is its node type, the size is support and activation. Radius is a hash scatter: a second meaning
 * on the radius would be a reading the data does not support (`docs/observatory.md`).
 */

import * as THREE from './three.bundle.js';

const NODE_COLORS = {
  project: '#f2c14e',
  topic: '#5fd0b4',
  cluster: '#3fb4a0',
  issue: '#e88f6a',
  entity: '#78c8ff',
  session: '#9b8cf0',
  thread: '#8a7ae6',
  memoryKind: '#d7a05a',
  actionKind: '#e0b25e',
  episode: '#6ea8fe',
  raw_event: '#aebbd0',
  event: '#c3cfe2',
  belief: '#7fd6a8',
  action: '#f0a3c8',
  time: '#5d6f8f',
  decision: '#8fd0a0',
  correction: '#e5857e',
  actor: '#c9a7f0',
  task: '#93b8d8',
  object: '#b8c9a0',
  location: '#7fc7cf',
  state: '#c0a37a',
};
const FALLBACK_COLOR = '#9aa8bd';
/** Event series are ordered by volume, so the busiest one is always the same colour on every run. */
const SERIES_COLORS = ['#6ea8fe', '#5fd0b4', '#e0b25e', '#e5857e', '#9b8cf0', '#7fc7cf', '#b8c9a0', '#f0a3c8'];
const DEMO_SOURCE = 'demo';
/** How much of L1 a phone-sized viewport keeps, most activated first. */
const MOBILE_L1_LIMIT = 3000;

const state = {
  demo: false,
  /** id → node, rebuilt with each snapshot: a selection resolves its neighbours per click. */
  nodeIndex: new Map(),
  view: 'starmap',
  projectId: null,
  agent: null,
  snapshot: null,
  timeline: null,
  recalls: null,
  selectedNode: null,
  selectedDay: null,
  range: null,
  /** The highest layer the reader will allow; zoom decides how much of it is actually drawn. */
  lodCap: 2,
  mobile: matchMedia('(max-width: 900px)').matches,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
};
const num = (value) => Number(value ?? 0).toLocaleString('zh-CN');
const colorFor = (type) => NODE_COLORS[type] || FALLBACK_COLOR;
const stamp = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—');

function api(path, params = {}) {
  const url = new URL(`./${path.replace(/^\//, '')}`, location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return fetch(url, { headers: { accept: 'application/json' } }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  });
}

/* ---------------------------------------------------------------- star map */

const map = {
  ready: false,
  needsFrame: true,
  layers: {},
  groups: { 0: [], 1: [], 2: [] },
};

function spriteTexture(inner, outer) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(255,255,255,${inner})`);
  gradient.addColorStop(0.28, `rgba(255,255,255,${inner * 0.36})`);
  gradient.addColorStop(1, `rgba(255,255,255,${outer})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ringTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(242,193,78,0.95)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 7, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

const POINT_VERTEX = `
  attribute float size;
  attribute float weight;
  varying vec3 vColor;
  varying float vWeight;
  void main() {
    vColor = color;
    vWeight = weight;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * (480.0 / -mv.z), 1.0, 48.0);
    gl_Position = projectionMatrix * mv;
  }`;
const POINT_FRAGMENT = `
  uniform sampler2D uSprite;
  uniform float uFade;
  varying vec3 vColor;
  varying float vWeight;
  void main() {
    float alpha = texture2D(uSprite, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * vWeight * uFade, alpha * vWeight * uFade);
  }`;

/**
 * The camera distance at which each layer fades in, [starts, fully on]. Zoom is what decides how deep
 * the map is drawn — the note's ladder is a reading device, not a settings panel — and the buttons
 * above it set a ceiling. Mobile drops L2 by default and halves the sprite size, which is the
 * degradation table the note fixed.
 */
function lodBands() {
  return state.mobile
    ? { 1: [430, 250], 2: [0, -1] }
    : { 1: [560, 300], 2: [170, 95] };
}

function lodFade(lod, distance) {
  if (lod > state.lodCap) return 0;
  // The skeleton is never faded: with one project node in a corpus it is the single point at the
  // centre, and a band for it would be a threshold nobody could see the effect of.
  if (lod === 0) return 1;
  const [starts, full] = lodBands()[lod];
  if (distance <= full) return 1;
  if (distance >= starts) return 0;
  const t = (starts - distance) / (starts - full);
  return t * t * (3 - 2 * t);
}

function initMap() {
  if (map.ready) return;
  const canvas = $('map');
  map.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  map.renderer.setClearAlpha(0);
  map.scene = new THREE.Scene();
  map.camera = new THREE.PerspectiveCamera(55, 1, 1, 4000);
  map.camera.position.set(0, 132, 138);
  map.sprite = spriteTexture(0.9, 0);
  map.controls = new THREE.OrbitControls(map.camera, canvas);
  map.controls.enableDamping = true;
  map.controls.dampingFactor = 0.075;
  map.controls.rotateSpeed = 0.6;
  map.controls.zoomSpeed = 0.9;
  map.controls.minDistance = 10;
  map.controls.maxDistance = 900;
  map.controls.autoRotate = !state.reducedMotion && !state.mobile;
  map.controls.autoRotateSpeed = 0.28;
  map.controls.addEventListener('change', () => { map.needsFrame = true; });
  map.controls.addEventListener('start', () => { map.controls.autoRotate = false; });

  map.dust = dustPoints();
  map.scene.add(map.dust);
  map.marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringTexture(), depthTest: false, transparent: true, opacity: 0.95,
  }));
  map.marker.visible = false;
  map.scene.add(map.marker);
  map.edges = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3)),
    new THREE.LineBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  map.edges.frustumCulled = false;
  map.scene.add(map.edges);

  new ResizeObserver(() => { resizeMap(); applyRangeWeights(); }).observe(canvas.parentElement);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', () => { $('hovercard').classList.remove('on'); });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('keydown', onKeyDown);
  map.ready = true;
  // Reachable so a probe can read the frame's draw calls and timing off the live page; nothing in the
  // page itself reads it.
  window.__cogmemObservatory = map;
  resizeMap();
  requestAnimationFrame(frame);
}

/** Decoration, not data: it carries no meaning, so a fixed seed keeps screenshots stable. */
function dustPoints() {
  const count = state.mobile || state.reducedMotion ? 0 : 2600;
  const positions = new Float32Array(Math.max(count, 1) * 3);
  let seed = 0x2f6e2b1;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < count; index += 1) {
    const r = 200 + rand() * 900;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[index * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = r * Math.cos(phi) * 0.7;
    positions[index * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x8fa6c8, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.45,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

function pointSizeFor(node) {
  const support = Math.log10(1 + Math.max(0, node.support)) * 2.1;
  const activation = Math.min(Math.max(node.activation ?? 0, 0), 1) * 2.4;
  const base = node.lod === 2 ? 1.5 : 3.2;
  const size = Math.min(Math.max(base + support + activation, 1.5), 13);
  return state.mobile ? size * 0.5 : size;
}

function buildMap(snapshot) {
  initMap();
  for (const lod of [0, 1, 2]) {
    if (map.layers[lod]) { map.scene.remove(map.layers[lod]); map.layers[lod].geometry.dispose(); }
  }
  map.groups = { 0: [], 1: [], 2: [] };
  for (const node of snapshot.nodes) map.groups[node.lod].push(node);
  // Mobile keeps the most activated slice of L1 rather than every aggregate; the legend says how much
  // was left out, because a silent cap is the thing the note forbids.
  state.mobileDropped = 0;
  if (state.mobile && map.groups[1].length > MOBILE_L1_LIMIT) {
    state.mobileDropped = map.groups[1].length - MOBILE_L1_LIMIT;
    map.groups[1] = map.groups[1].slice(0, MOBILE_L1_LIMIT);
  }

  for (const lod of [0, 1, 2]) {
    const nodes = map.groups[lod];
    const count = Math.max(nodes.length, 1);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const weights = new Float32Array(count);
    const tint = new THREE.Color();
    nodes.forEach((node, index) => {
      positions[index * 3] = node.x;
      positions[index * 3 + 1] = node.y;
      positions[index * 3 + 2] = node.z;
      tint.set(colorFor(node.type));
      colors[index * 3] = tint.r;
      colors[index * 3 + 1] = tint.g;
      colors[index * 3 + 2] = tint.b;
      sizes[index] = pointSizeFor(node);
      weights[index] = 1;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('weight', new THREE.BufferAttribute(weights, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uSprite: { value: map.sprite }, uFade: { value: 1 } },
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = nodes.length > 0;
    map.scene.add(points);
    map.layers[lod] = points;
  }
  applyRangeWeights();
  map.needsFrame = true;
  updateMapStats();
}

function resizeMap() {
  const canvas = $('map');
  const width = canvas.clientWidth || canvas.parentElement.clientWidth;
  const height = canvas.clientHeight || canvas.parentElement.clientHeight;
  if (!width || !height) return;
  map.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.mobile ? 1.5 : 2));
  map.renderer.setSize(width, height, false);
  map.camera.aspect = width / height;
  map.camera.updateProjectionMatrix();
  updateProjection();
  map.needsFrame = true;
}

/** The one authored motion: the galaxy turns while nobody is touching it, and stops when they are. */
function frame() {
  requestAnimationFrame(frame);
  if (!map.ready) return;
  if (map.onDemandIdle === undefined) map.onDemandIdle = state.mobile || state.reducedMotion;
  const damping = map.controls.update();
  if (map.onDemandIdle && !map.needsFrame && !damping) return;
  applyLodBands();
  updateProjection();
  map.renderer.render(map.scene, map.camera);
  map.needsFrame = false;
}

/** Reused by hover picking: one world→screen matrix, recomputed once per rendered frame. */
function updateProjection() {
  map.camera.updateMatrixWorld();
  map.camera.matrixWorldInverse.copy(map.camera.matrixWorld).invert();
  map.projection = new THREE.Matrix4()
    .multiplyMatrices(map.camera.projectionMatrix, map.camera.matrixWorldInverse)
    .elements;
}

/** Zoom, not a checkbox, is what brings a layer in — and the legend is re-labelled when it changes. */
function applyLodBands() {
  const distance = map.camera.position.distanceTo(map.controls.target);
  let changed = false;
  for (const lod of [0, 1, 2]) {
    const layer = map.layers[lod];
    if (!layer) continue;
    const fade = map.groups[lod].length ? lodFade(lod, distance) : 0;
    if (layer.material.uniforms.uFade.value !== fade) {
      layer.material.uniforms.uFade.value = fade;
      changed = true;
    }
    const visible = fade > 0.02;
    if (layer.visible !== visible) {
      layer.visible = visible;
      changed = true;
    }
  }
  if (changed) updateMapStats();
}

function applyRangeWeights() {
  const range = state.range;
  for (const lod of [0, 1, 2]) {
    const layer = map.layers[lod];
    if (!layer) continue;
    const weights = layer.geometry.attributes.weight;
    map.groups[lod].forEach((node, index) => {
      let weight = 1;
      if (range && node.occurredAt) {
        const day = new Date(node.occurredAt).toISOString().slice(0, 10);
        const inside = day >= range[0] && day <= range[1];
        if (!inside) weight *= 0.12;
      }
      weights.array[index] = weight;
    });
    weights.needsUpdate = true;
  }
  map.needsFrame = true;
}

function visibleGroups() {
  const distance = map.camera.position.distanceTo(map.controls.target);
  return [0, 1, 2].filter((lod) => map.groups[lod].length > 0 && lodFade(lod, distance) > 0.02);
}

function projectToScreen(x, y, z) {
  const matrix = map.projection;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (w <= 0) return null;
  const ndcX = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
  const ndcY = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
  const canvas = map.renderer.domElement;
  return { x: (ndcX * 0.5 + 0.5) * canvas.clientWidth, y: (-ndcY * 0.5 + 0.5) * canvas.clientHeight };
}

function nearestNode(clientX, clientY, limit = 14) {
  if (!map.projection) return null;
  const rect = map.renderer.domElement.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let bestDistance = limit * limit * 4;
  for (const lod of visibleGroups()) {
    const nodes = map.groups[lod];
    const positions = map.layers[lod].geometry.attributes.position.array;
    for (let index = 0; index < nodes.length; index += 1) {
      const screen = projectToScreen(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
      if (!screen) continue;
      const dx = screen.x - x;
      const dy = screen.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = nodes[index]; }
    }
  }
  return best;
}

let hoverPending = 0;
function onPointerMove(event) {
  if (hoverPending) return;
  hoverPending = window.setTimeout(() => {
    hoverPending = 0;
    const node = nearestNode(event.clientX, event.clientY);
    const card = $('hovercard');
    if (!node) { card.classList.remove('on'); return; }
    const rect = map.renderer.domElement.getBoundingClientRect();
    card.innerHTML = '';
    card.append(el('span', { class: 't', text: node.label || node.id }));
    card.append(el('span', {
      class: 's',
      text: `${node.type}${node.status && node.status !== 'active' ? ` · ${node.status}` : ''} · support ${num(node.support)} · 证据 ${num(node.evidenceTotal)}`,
    }));
    card.classList.add('on');
    card.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 240)}px`;
    card.style.top = `${Math.max(event.clientY - rect.top - 12, 8)}px`;
  }, 50);
}

function selectNode(node, options = {}) {
  state.selectedNode = node;
  map.marker.visible = Boolean(node);
  if (node) map.marker.position.set(node.x, node.y, node.z);
  else map.edges.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  map.needsFrame = true;
  if (!node) { renderPanel(); return; }
  if (options.fromSnapshot && state.demo) {
    const detail = demoDetail(node);
    drawEdges(node, detail.neighbors);
    renderPanel({ node, detail });
    return;
  }
  if (options.fromSnapshot) {
    renderPanel({ node, detail: 'loading' });
    api(`node/${encodeURIComponent(node.id)}`, { project: state.projectId, agent: state.agent })
      .then((detail) => {
        if (state.selectedNode !== node) return;
        drawEdges(node, detail.neighbors || []);
        renderPanel({ node, detail });
      })
      .catch((error) => renderPanel({ node, error: error.message }));
  }
}

/**
 * The demo entry has no database behind it, so the detail panel is assembled from the same fictional
 * snapshot and says so. Nothing here is ever mixed with a live corpus: demo mode never calls the API.
 */
function demoDetail(node) {
  const neighbours = (state.snapshot.nodes ?? [])
    .filter((item) => item.id !== node.id && item.topicPath && item.topicPath === node.topicPath)
    .slice(0, 3);
  return {
    ...node,
    status: 'active',
    summary: `（虚构演示条目，不对应任何真实记忆）${node.label}`,
    evidenceTotal: 2,
    evidenceReturned: 1,
    evidence: [{
      eventId: `evt-demo-${node.id.replace(/[^\w]/g, '-')}`,
      drilldown: `cogmem memory show --event evt-demo --project ${state.projectId} --before 2 --after 2 --json`,
    }],
    neighbors: neighbours.map((item) => ({ source: node.id, relation: 'RELATED_TO', target: item.id, confidence: 0.5, evidenceEventIds: [] })),
  };
}

function drawEdges(node, neighbors) {
  const visible = new Set(state.snapshot.nodes.map((item) => item.id));
  const points = [];
  for (const edge of neighbors) {
    const otherId = edge.source === node.id ? edge.target : edge.source;
    if (!visible.has(otherId)) continue;
    const other = state.nodeIndex.get(otherId);
    if (!other) continue;
    points.push(node.x, node.y, node.z, other.x, other.y, other.z);
  }
  const geometry = map.edges.geometry;
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
  geometry.computeBoundingSphere();
  map.needsFrame = true;
}

function onCanvasClick(event) {
  const node = nearestNode(event.clientX, event.clientY);
  if (!node) { selectNode(null); return; }
  selectNode(node, { fromSnapshot: true });
}

function onKeyDown(event) {
  const canvas = $('map');
  const rotate = (dx, dy) => {
    map.controls.autoRotate = false;
    const offset = map.camera.position.clone();
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= dx;
    spherical.phi = Math.min(Math.max(spherical.phi - dy, 0.12), Math.PI - 0.12);
    map.camera.position.setFromSpherical(spherical);
    map.camera.lookAt(map.controls.target);
    map.needsFrame = true;
  };
  if (event.key === 'ArrowLeft') { rotate(0.12, 0); event.preventDefault(); }
  else if (event.key === 'ArrowRight') { rotate(-0.12, 0); event.preventDefault(); }
  else if (event.key === 'ArrowUp') { rotate(0, 0.1); event.preventDefault(); }
  else if (event.key === 'ArrowDown') { rotate(0, -0.1); event.preventDefault(); }
  else if (event.key === '+' || event.key === '=') { map.camera.position.multiplyScalar(0.9); map.needsFrame = true; event.preventDefault(); }
  else if (event.key === '-' || event.key === '_') { map.camera.position.multiplyScalar(1.1); map.needsFrame = true; event.preventDefault(); }
  else if (event.key === 'Enter') {
    const rect = canvas.getBoundingClientRect();
    const node = nearestNode(rect.left + rect.width / 2, rect.top + rect.height / 2, 60);
    if (node) selectNode(node, { fromSnapshot: true });
    event.preventDefault();
  } else if (event.key === 'Escape') { selectNode(null); }
}

function updateMapStats() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const distance = map.camera.position.distanceTo(map.controls.target);
  const bands = [0, 1, 2].filter((lod) => map.groups[lod].length > 0 && lodFade(lod, distance) > 0.02);
  const shown = bands.reduce((sum, lod) => sum + map.groups[lod].length, 0);
  const caps = [];
  if (state.mobileDropped) caps.push(`移动端 L1 只画最活跃的 ${num(MOBILE_L1_LIMIT)} 个（省略 ${num(state.mobileDropped)}）`);
  if (snapshot.truncation) caps.push(`快照上限 ${num(snapshot.truncation.limit)}`);
  $('map-stats').textContent = `显示 ${num(shown)} / ${num(snapshot.nodes.length)} 个节点 · LOD 当前 ${bands.map((lod) => `L${lod}`).join('+') || '无'}`
    + (caps.length ? ` · ${caps.join(' · ')}` : '');
}

/* ---------------------------------------------------------------- timeline */

function renderTimeline() {
  const host = $('view-timeline');
  host.innerHTML = '';
  const timeline = state.timeline;
  if (!timeline || !timeline.histogram.days.length) {
    host.append(emptyState(
      '这段时间里没有事件',
      '账本里没有落在这个项目与范围内的记录。换一个项目或智能体范围，或者回到星图看已编译的记忆。',
    ));
    return;
  }
  const days = timeline.histogram.days;
  const series = timeline.histogram.series;
  const width = 1000;
  const height = 300;
  const pad = { top: 16, right: 16, bottom: 34, left: 46 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.flatMap((item) => item.counts));
  const step = plotWidth / days.length;
  const barWidth = Math.max(1, step - 0.6);
  const yFor = (value) => pad.top + plotHeight - (value / max) * plotHeight;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `按天的事件分布，共 ${num(days.length)} 天`);

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (max / 4) * tick;
    const y = yFor(value);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pad.left); line.setAttribute('x2', width - pad.right);
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    line.setAttribute('class', 'grid-line');
    svg.append(line);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', pad.left - 6); label.setAttribute('y', y + 3);
    label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'axis');
    label.textContent = num(Math.round(value));
    svg.append(label);
  }

  const seriesColor = (index) => SERIES_COLORS[index % SERIES_COLORS.length];
  days.forEach((day, dayIndex) => {
    let cursor = pad.top + plotHeight;
    series.forEach((item, seriesIndex) => {
      const value = item.counts[dayIndex];
      if (!value) return;
      const barHeight = (value / max) * plotHeight;
      cursor -= barHeight;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pad.left + dayIndex * step);
      rect.setAttribute('y', cursor);
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', Math.max(barHeight, 0.8));
      rect.setAttribute('fill', seriesColor(seriesIndex));
      rect.setAttribute('class', 'bar');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${day} · ${item.eventType} · ${num(value)}`;
      rect.append(title);
      svg.append(rect);
    });
  });

  const first = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  first.setAttribute('x', pad.left); first.setAttribute('y', height - 12);
  first.setAttribute('class', 'axis'); first.textContent = days[0];
  svg.append(first);
  const last = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  last.setAttribute('x', width - pad.right); last.setAttribute('y', height - 12);
  last.setAttribute('text-anchor', 'end'); last.setAttribute('class', 'axis');
  last.textContent = days[days.length - 1];
  svg.append(last);

  const brushRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  brushRect.setAttribute('class', 'brush');
  brushRect.setAttribute('y', pad.top);
  brushRect.setAttribute('height', plotHeight);
  brushRect.setAttribute('width', 0);
  brushRect.setAttribute('visibility', 'hidden');
  svg.append(brushRect);

  const wrapper = el('div', { class: 'chart-wrap' });
  wrapper.append(svg);
  host.append(wrapper);
  host.append(el('div', { class: 'tl-legend' }, series.map((item, index) => el('span', {}, [
    el('span', { class: 'swatch', style: `color:${seriesColor(index)}` }),
    `${item.eventType} · ${num(timeline.histogram.totals[item.eventType] ?? 0)}`,
  ]))));
  const dayPanel = el('div', { class: 'day-panel' });
  host.append(dayPanel);
  renderDayPanel(dayPanel);

  let startX = null;
  const dayAt = (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.floor(((ratio * width) - pad.left) / step);
    return Math.max(0, Math.min(days.length - 1, index));
  };
  svg.addEventListener('pointerdown', (event) => {
    startX = dayAt(event);
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (startX === null) return;
    const current = dayAt(event);
    const low = Math.min(startX, current);
    const high = Math.max(startX, current);
    brushRect.setAttribute('visibility', 'visible');
    brushRect.setAttribute('x', pad.left + low * step);
    brushRect.setAttribute('width', (high - low + 1) * step);
  });
  svg.addEventListener('pointerup', (event) => {
    if (startX === null) return;
    const current = dayAt(event);
    brushRect.setAttribute('visibility', 'hidden');
    const low = Math.min(startX, current);
    const high = Math.max(startX, current);
    startX = null;
    if (low === high) {
      state.range = null;
      state.selectedDay = days[low];
    } else {
      state.range = [days[low], days[high]];
      state.selectedDay = null;
    }
    applyRangeWeights();
    renderDayPanel(dayPanel);
    renderPanel();
  });
}

function renderDayPanel(host) {
  host.innerHTML = '';
  const timeline = state.timeline;
  if (!timeline) return;
  if (state.range) {
    host.append(el('div', {}, [
      el('h3', { text: `范围 ${state.range[0]} → ${state.range[1]}` }),
      el('p', { class: 'dim', text: '星图里落在范围外的节点已变暗。' }),
      el('button', { class: 'chip', type: 'button', text: '清除范围', onclick: () => { state.range = null; applyRangeWeights(); renderDayPanel(host); renderPanel(); } }),
    ]));
    return;
  }
  const day = state.selectedDay;
  if (!day) {
    host.append(el('div', {}, [
      el('h3', { text: '选一天' }),
      el('p', { class: 'dim', text: '拖动刷选一段时间范围，或点一天看当天的构成与当天新建的 L1 节点。' }),
    ]));
    return;
  }
  const index = timeline.histogram.days.indexOf(day);
  const composition = timeline.histogram.series
    .map((item) => ({ type: item.eventType, value: item.counts[index] ?? 0 }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
  const created = (state.snapshot?.nodes ?? []).filter((node) => {
    if (node.lod !== 1 || !node.occurredAt) return false;
    return new Date(node.occurredAt).toISOString().slice(0, 10) === day;
  }).slice(0, 40);
  host.append(el('div', {}, [
    el('h3', { text: day }),
    composition.length
      ? el('ul', { class: 'plain' }, composition.map((item) => el('li', {}, [
        el('span', { text: item.type }), el('span', { class: 'num', text: num(item.value) }),
      ])))
      : el('p', { class: 'dim', text: '这一天没有记录在案的事件。' }),
  ]));
  host.append(el('div', {}, [
    el('h3', { text: `当天新建的 L1 节点（${num(created.length)}）` }),
    created.length
      ? el('ul', { class: 'plain' }, created.map((node) => el('li', {}, [
        el('button', { type: 'button', text: node.label || node.id, onclick: () => { showView('starmap'); selectNode(node, { fromSnapshot: true }); } }),
        el('span', { class: 'num dim', text: node.type }),
      ])))
      : el('p', { class: 'dim', text: '当天没有新建的聚合节点。' }),
  ]));
}

/* ----------------------------------------------------------------- recalls */

function renderRecalls() {
  const host = $('view-recalls');
  host.innerHTML = '';
  host.style.height = '100%';
  const recalls = state.recalls;
  const split = el('div', { class: 'split' });
  const list = el('div', { class: 'list' });
  const detail = el('div', { class: 'trace', id: 'recall-detail' });
  split.append(list, detail);
  host.append(split);

  if (!recalls || !recalls.available) {
    list.append(emptyState(
      '这个库还没有存过召回决策',
      '召回检查页只读已经落库的 trace（trace_events），首版不在页面里现场跑 explain。这个数据库里还没有那张表，或者它还是空的。',
    ));
    detail.append(emptyState('没有可展开的决策', '等宿主侧把 recall.request / recall.result 落进 trace 之后，这里会按任务列出每一次决策。'));
    return;
  }
  if (!recalls.recalls.length) {
    list.append(emptyState('当前范围内没有召回决策', '换一个项目或智能体范围再试。'));
    detail.append(emptyState('没有可展开的决策', '列表为空时没有详情可看。'));
    return;
  }
  const items = [];
  for (const recall of recalls.recalls) {
    const button = el('button', { class: 'recall-item', type: 'button' }, [
      el('span', { class: 'q', text: recall.query || '(无查询文本)' }),
      el('span', { class: 'm', text: `${stamp(recall.startedAt)} · ${recall.decision} · ${recall.taskId || recall.recallId}` }),
    ]);
    button.addEventListener('click', () => {
      for (const other of items) other.setAttribute('aria-current', 'false');
      button.setAttribute('aria-current', 'true');
      showRecallDetail(detail, recall.taskId || recall.recallId);
    });
    items.push(button);
    list.append(button);
  }
  items[0].setAttribute('aria-current', 'true');
  showRecallDetail(detail, recalls.recalls[0].taskId || recalls.recalls[0].recallId);
}

function showRecallDetail(host, recallId) {
  host.innerHTML = '';
  if (state.demo) {
    const recall = (state.recalls?.recalls ?? []).find((item) => (item.taskId || item.recallId) === recallId);
    if (recall) renderRecallDetail(host, { ...recall, chain: [] });
    else host.append(emptyState('这条 trace 打不开', '演示数据里没有这一条。'));
    return;
  }
  host.append(el('div', { class: 'skeleton w80' }), el('div', { class: 'skeleton w60' }), el('div', { class: 'skeleton w40' }));
  api(`recalls/${encodeURIComponent(recallId)}`, { project: state.projectId, agent: state.agent })
    .then((detail) => renderRecallDetail(host, detail))
    .catch((error) => {
      host.innerHTML = '';
      host.append(emptyState('这条 trace 打不开', error.message));
    });
}

function renderRecallDetail(host, detail) {
  host.innerHTML = '';
  const payload = detail.payload ?? {};
  host.append(el('h3', { text: detail.query || '(无查询文本)' }));
  host.append(el('dl', { class: 'kv' }, [
    el('dt', { text: '决策 id' }), el('dd', { text: detail.recallId }),
    el('dt', { text: '时间' }), el('dd', { text: stamp(detail.startedAt) }),
    el('dt', { text: '任务' }), el('dd', { text: detail.taskId || '—' }),
  ]));
  const suppressed = Array.isArray(payload.suppressed) ? payload.suppressed : [];
  if (suppressed.length) {
    host.append(el('h2', { class: 'head', text: '被门控 / 抑制', style: 'margin-top:0.875rem' }));
    host.append(el('div', { class: 'suppressed' }, suppressed.map((entry) =>
      el('span', { text: `${entry.reason ?? 'unknown'} × ${num(entry.count ?? 0)}` }))));
  }
  if (detail.chain?.length > 1) {
    host.append(el('h2', { class: 'head', text: '决策链', style: 'margin-top:0.875rem' }));
    host.append(el('ul', { class: 'plain' }, detail.chain.map((step) =>
      el('li', {}, [el('span', { text: step.eventType }), el('span', { class: 'dim', text: stamp(step.timestamp) })]))));
  }
  host.append(el('h2', { class: 'head', text: '完整 payload', style: 'margin-top:0.875rem' }));
  host.append(el('pre', { class: 'json', text: JSON.stringify(payload, null, 2) }));
}

/* ------------------------------------------------------------------- panel */

function emptyState(title, body) {
  return el('div', { class: 'empty' }, [el('h3', { text: title }), el('p', { class: 'dim', text: body })]);
}

function panelHeader(title, sub) {
  return el('div', { class: 'section' }, [el('h3', { text: title }), sub ? el('p', { class: 'dim', text: sub }) : null]);
}

function renderPanel(options = {}) {
  const panel = $('panel');
  panel.innerHTML = '';
  if (state.view === 'recalls') { renderRecallsPanel(panel); return; }
  if (state.view === 'timeline') { renderTimelinePanel(panel); return; }
  if (state.selectedNode) { renderNodePanel(panel, options); return; }
  renderOverviewPanel(panel);
}

function renderOverviewPanel(panel) {
  const snapshot = state.snapshot;
  if (!snapshot) { panel.append(loadingPanel()); return; }
  panel.append(panelHeader('快照', `这份快照读的是水位线 ${num(snapshot.watermark)} 那一刻的库。`));
  const counts = el('div', { class: 'section' });
  counts.append(el('h2', { class: 'head', text: '规模' }));
  counts.append(el('dl', { class: 'kv' }, [
    el('dt', { text: '节点' }), el('dd', { text: num(snapshot.counts.nodesTotal) }),
    el('dt', { text: '边' }), el('dd', { text: num(snapshot.counts.edgesTotal) }),
    el('dt', { text: '本视图节点' }), el('dd', { text: num(snapshot.nodes.length) + (state.agent ? ` / ${num(snapshot.counts.nodesTotal)}` : '') }),
    el('dt', { text: '生成时刻' }), el('dd', { text: stamp(snapshot.generatedAt) }),
  ]));
  panel.append(counts);

  const types = Object.entries(snapshot.counts.nodesByType).sort((left, right) => right[1] - left[1]);
  const typeSection = el('div', { class: 'section' });
  typeSection.append(el('h2', { class: 'head', text: state.agent ? '按类型（本视图）' : '按类型' }));
  typeSection.append(el('ul', { class: 'plain' }, types.map(([type, count]) => el('li', {}, [
    el('span', {}, [el('span', { class: 'swatch', style: `color:${colorFor(type)};margin-right:0.375rem` }), type]),
    el('span', { class: 'num', text: num(count) }),
  ]))));
  panel.append(typeSection);

  const layout = el('div', { class: 'section' });
  layout.append(el('h2', { class: 'head', text: '星图的编码' }));
  layout.append(el('p', {
    class: 'dim prose',
    text: snapshot.layout.armRule === 'topic_path'
      ? `旋臂 = 顶层主题（${num(snapshot.layout.arms.length)} 条臂）。颜色 = 节点类型，点大小 = support 与 activation。半径不承载语义。`
      : `这个项目没有主题节点，所以整片星云落在一条臂上（${snapshot.projectId}）。颜色 = 节点类型，点大小 = support 与 activation。半径不承载语义。`,
  }));
  layout.append(el('ul', { class: 'plain' }, snapshot.layout.arms.slice(0, 12).map((arm) =>
    el('li', {}, [el('span', { text: arm.id }), el('span', { class: 'num', text: num(arm.nodes) })]))));
  panel.append(layout);

  const edges = Object.entries(snapshot.counts.edgesByRelation).sort((left, right) => right[1] - left[1]);
  if (edges.length) {
    const edgeSection = el('div', { class: 'section' });
    edgeSection.append(el('h2', { class: 'head', text: '关系（不在快照里）' }));
    edgeSection.append(el('p', { class: 'dim', text: '边不随快照下发，选中节点时按需取一跳邻域。' }));
    edgeSection.append(el('ul', { class: 'plain' }, edges.slice(0, 12).map(([relation, count]) =>
      el('li', {}, [el('span', { text: relation }), el('span', { class: 'num', text: num(count) })]))));
    panel.append(edgeSection);
  }
  if (state.demo) {
    panel.append(el('div', { class: 'section' }, [
      el('p', { class: 'dim', text: '当前是虚构演示数据，不来自任何真实数据库。' }),
      el('button', { class: 'chip', type: 'button', text: '回到真实数据', onclick: () => { location.search = ''; } }),
    ]));
  } else {
    panel.append(el('div', { class: 'section' }, [
      el('p', { class: 'hint', text: '想看界面长什么样而没有语料？' }),
      el('button', { class: 'chip', type: 'button', text: '打开虚构演示数据', onclick: () => { location.search = '?demo=1'; } }),
    ]));
  }
}

function renderNodePanel(panel, options) {
  const node = options.node ?? state.selectedNode;
  panel.append(panelHeader(node.label || node.id, `${node.type} · LOD ${node.lod}`));
  if (options.error) {
    panel.append(el('div', { class: 'section' }, [el('p', { class: 'dim', text: `详情读取失败：${options.error}` })]));
    return;
  }
  if (options.detail === 'loading') { panel.append(loadingPanel()); return; }
  const detail = options.detail;
  const facts = el('div', { class: 'section' });
  facts.append(el('dl', { class: 'kv' }, [
    el('dt', { text: 'support' }), el('dd', { text: num(node.support) }),
    el('dt', { text: 'activation' }), el('dd', { text: (node.activation ?? 0).toFixed(3) }),
    el('dt', { text: '状态' }), el('dd', { text: detail?.status ?? '—' }),
    el('dt', { text: '时间' }), el('dd', { text: stamp(node.occurredAt) }),
    el('dt', { text: 'id' }), el('dd', { text: node.id }),
  ]));
  panel.append(facts);
  if (detail?.summary) {
    panel.append(el('div', { class: 'section' }, [el('p', { class: 'prose', text: detail.summary })]));
  }
  const evidence = detail?.evidence ?? [];
  const evidenceSection = el('div', { class: 'section' });
  evidenceSection.append(el('h2', { class: 'head', text: `证据（${num(detail?.evidenceTotal ?? evidence.length)}）` }));
  if (!evidence.length) evidenceSection.append(el('p', { class: 'dim', text: '这个节点没有直接的下钻证据。' }));
  evidenceSection.append(el('ul', { class: 'evidence' }, evidence.map((item) => {
    const locator = item.sourceLocator;
    return el('li', {}, [
      el('span', {
        class: 'dim',
        text: locator?.localDate ? `${locator.localDate} · ${item.eventId.slice(0, 18)}…` : item.eventId,
      }),
      el('div', { class: 'cmd' }, [
        el('span', { text: locator?.command || item.drilldown }),
        el('button', { type: 'button', text: '复制', onclick: (event) => copyCommand(event, locator?.command || item.drilldown) }),
      ]),
    ]);
  })));
  panel.append(evidenceSection);

  const neighbors = detail?.neighbors ?? [];
  const edgeSection = el('div', { class: 'section' });
  edgeSection.append(el('h2', { class: 'head', text: `一跳邻域（${num(neighbors.length)}）` }));
  if (!neighbors.length) edgeSection.append(el('p', { class: 'dim', text: '没有相邻节点。' }));
  edgeSection.append(el('ul', { class: 'edges' }, neighbors.map((edge) => {
    const otherId = edge.source === node.id ? edge.target : edge.source;
    const other = state.nodeIndex.get(otherId);
    return el('li', {}, [
      el('span', { class: 'rel', text: edge.relation }),
      other
        ? el('button', { type: 'button', text: other.label || otherId, onclick: () => selectNode(other, { fromSnapshot: true }) })
        : el('span', { class: 'dim', text: otherId }),
    ]);
  })));
  panel.append(edgeSection);
}

function copyCommand(event, text) {
  navigator.clipboard?.writeText(text).then(() => {
    event.target.textContent = '已复制';
    setTimeout(() => { event.target.textContent = '复制'; }, 1400);
  }).catch(() => {});
}

function renderTimelinePanel(panel) {
  panel.append(panelHeader('时间线', '按天 × 事件类型统计，来自 memory_events。'));
  if (state.range) {
    panel.append(el('div', { class: 'section' }, [el('p', { class: 'dim', text: `已选范围 ${state.range[0]} → ${state.range[1]}，星图同步高亮。` })]));
  } else if (state.selectedDay) {
    panel.append(el('div', { class: 'section' }, [el('p', { class: 'dim', text: `已选 ${state.selectedDay}。` })]));
  } else {
    panel.append(el('div', { class: 'section' }, [el('p', { class: 'dim', text: '拖动刷选范围，或点一天看当天。' })]));
  }
}

function renderRecallsPanel(panel) {
  panel.append(panelHeader('召回检查', '只读已经落库的决策 trace，不在页面里现场跑 explain。'));
  const recalls = state.recalls;
  const section = el('div', { class: 'section' });
  section.append(el('dl', { class: 'kv' }, [
    el('dt', { text: 'trace 表' }), el('dd', { text: recalls?.available ? '存在' : '不存在' }),
    el('dt', { text: '决策条数' }), el('dd', { text: num(recalls?.recalls?.length ?? 0) }),
    el('dt', { text: '范围' }), el('dd', { text: state.agent ?? '全部' }),
  ]));
  panel.append(section);
}

function loadingPanel() {
  return el('div', { class: 'section' }, [
    el('div', { class: 'skeleton w60' }), el('div', { class: 'skeleton' }),
    el('div', { class: 'skeleton w80' }), el('div', { class: 'skeleton w40' }),
  ]);
}

/* ---------------------------------------------------------- scope and boot */

function renderHeader() {
  const snapshot = state.snapshot;
  const demo = state.demo || snapshot?.source === DEMO_SOURCE;
  const badge = $('source-badge');
  badge.className = `badge ${demo ? 'badge-demo' : 'badge-live'}`;
  $('source-label').textContent = demo ? 'demo · 虚构' : 'live';
  $('waterline').innerHTML = demo
    ? '演示数据 · <b>无水位线</b>'
    : `水位线 <b>#${num(snapshot?.watermark ?? 0)}</b> · 生成 <b>${stamp(snapshot?.generatedAt)}</b> · 范围 <b>${state.agent ? escapeHtml(state.agent) : '全部'}</b>`;
  $('legend-scope').textContent = state.agent ? `范围 ${state.agent}` : '全部';
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function renderScope() {
  const snapshot = state.snapshot;
  const roster = $('roster');
  roster.innerHTML = '';
  $('scope-all-count').textContent = snapshot ? ` ${num(snapshot.counts.nodesTotal)}` : '';
  $('scope-all').setAttribute('aria-pressed', String(state.agent === null));
  for (const agent of snapshot?.agents ?? []) {
    const chip = el('button', {
      class: `chip${agent.kind === 'host' ? ' host' : ''}`,
      type: 'button',
      'aria-pressed': String(state.agent === agent.id),
      title: `${agent.events} 条事件 · ${agent.nodes} 个节点${agent.kind === 'host' ? ' · 已接入宿主' : ''}`,
      onclick: () => { state.agent = state.agent === agent.id ? null : agent.id; reload(); },
    }, [agent.id, el('span', { class: 'count', text: num(agent.events) })]);
    roster.append(chip);
  }
}

function renderLegend() {
  const snapshot = state.snapshot;
  const types = Object.entries(snapshot?.counts.nodesByType ?? {}).sort((left, right) => right[1] - left[1]);
  $('legend-items').innerHTML = '';
  for (const [type, count] of types) {
    $('legend-items').append(el('li', {}, [
      el('span', { class: 'swatch', style: `color:${colorFor(type)}` }), `${type} ${num(count)}`,
    ]));
  }
  const truncation = snapshot?.truncation;
  const notice = $('truncation-notice');
  if (truncation) {
    notice.classList.remove('hidden');
    const parts = Object.entries(truncation.byType).map(([type, entry]) => `${type} ${num(entry.returned)}/${num(entry.total)}`);
    notice.textContent = `已截断：快照上限 ${num(truncation.limit)} 个节点，省略 ${num(truncation.omitted)} 个（${parts.join('、')}）。截断按激活度、support 与时间从高到低。`;
  } else {
    notice.classList.add('hidden');
  }
}

function showView(view) {
  state.view = view;
  for (const name of ['starmap', 'timeline', 'recalls']) {
    $(`tab-${name}`).setAttribute('aria-selected', String(name === view));
    $(`view-${name}`).classList.toggle('on', name === view);
  }
  if (view === 'recalls') renderRecalls();
  if (view === 'timeline') renderTimeline();
  if (view === 'starmap') map.needsFrame = true;
  renderPanel();
}

async function loadDemo() {
  state.demo = true;
  const response = await fetch('./demo.json');
  const demo = await response.json();
  state.projectId = demo.projectId;
  state.snapshot = { ...demo.snapshot, source: DEMO_SOURCE };
  state.timeline = { ...demo.timeline, source: DEMO_SOURCE };
  state.recalls = { ...demo.recalls, source: DEMO_SOURCE };
  applyLoaded();
}

function applyLoaded() {
  state.selectedNode = null;
  state.selectedDay = null;
  state.range = null;
  map.marker && (map.marker.visible = false);
  map.edges?.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  $('project-select').innerHTML = '';
  for (const project of state.snapshot.projects ?? []) {
    $('project-select').append(el('option', { value: project.projectId, selected: project.projectId === state.projectId, text: `${project.projectId} · ${num(project.nodes)} 节点 / ${num(project.events)} 事件` }));
  }
  if (!state.snapshot.projects?.length) {
    $('project-select').append(el('option', { text: state.projectId || '（无项目）' }));
  }
  state.nodeIndex = new Map(state.snapshot.nodes.map((node) => [node.id, node]));
  renderHeader();
  renderScope();
  renderLegend();
  buildMap(state.snapshot);
  renderTimeline();
  renderRecalls();
  renderPanel();
}

async function reload() {
  if (state.demo) { state.agent = null; return; }
  renderPanel();
  const params = { project: state.projectId, agent: state.agent };
  const [snapshot, timeline, recalls] = await Promise.all([
    api('snapshot', params),
    api('timeline', params),
    api('recalls', { ...params, limit: 50 }),
  ]);
  state.snapshot = snapshot;
  state.timeline = timeline;
  state.recalls = recalls;
  if (!state.projectId) state.projectId = snapshot.projectId || null;
  applyLoaded();
}

async function boot() {
  if (new URLSearchParams(location.search).get('demo') === '1') {
    try { await loadDemo(); return; } catch (error) { /* fall through to the live path */ }
  }
  try {
    await reload();
  } catch (error) {
    $('panel').innerHTML = '';
    $('panel').append(emptyState('读不到记忆库', `${error.message}。确认 cogmem-mcp 正在运行，并且这个工作区里有记忆数据库。`));
  }
}

$('tab-starmap').addEventListener('click', () => showView('starmap'));
$('tab-timeline').addEventListener('click', () => showView('timeline'));
$('tab-recalls').addEventListener('click', () => showView('recalls'));
$('scope-all').addEventListener('click', () => { state.agent = null; reload(); });
$('project-select').addEventListener('change', (event) => { state.projectId = event.target.value; reload(); });
for (const button of document.querySelectorAll('.lod-row button')) {
  button.addEventListener('click', () => {
    state.lodCap = Number(button.dataset.lod);
    for (const other of document.querySelectorAll('.lod-row button')) {
      other.setAttribute('aria-pressed', String(Number(other.dataset.lod) === state.lodCap));
    }
    applyLodBands();
    map.needsFrame = true;
    updateMapStats();
  });
}
window.addEventListener('resize', () => { state.mobile = matchMedia('(max-width: 900px)').matches; });
initMap();
boot();

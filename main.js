import * as THREE from "three";
import { OrbitControls } from "https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js";

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.z = 2.5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lights
const ambient = new THREE.AmbientLight(0x334455, 0.55);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(5, 2, 5);
scene.add(sun);

// Real-time-ish sun direction based on UTC time and Earth's axial tilt.
const sunRadius = 5;
const earthTilt = THREE.MathUtils.degToRad(23.44);
const sunDir = new THREE.Vector3();
const rotY = new THREE.Matrix4();
const rotZ = new THREE.Matrix4().makeRotationZ(earthTilt);

function updateSunFromTime(date = new Date()) {
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Align solar noon at longitude 0 around 12:00 UTC.
  const dayAngle = ((utcHours - 12) / 24) * Math.PI * 2;

  rotY.makeRotationY(-dayAngle);
  sunDir.set(1, 0, 0).applyMatrix4(rotZ).applyMatrix4(rotY).normalize();
  sun.position.copy(sunDir).multiplyScalar(sunRadius);
}

// Globe
const loader = new THREE.TextureLoader();
const assetUrl = path => new URL(path, import.meta.url).toString();

const colorMap = loader.load(assetUrl("./assets/8k_earth_daymap.jpg"));
const normalMap = loader.load(assetUrl("./assets/earth_normal_2048.jpg"));
const lightsMap = loader.load(assetUrl("./assets/8k_earth_nightmap.jpg"));
const cloudsMap = loader.load(assetUrl("./assets/8k_earth_clouds.jpg"));
const roughnessMap = loader.load(assetUrl("./assets/earth_roughness.png"));
const starsMap = loader.load(assetUrl("./assets/8k_stars_milky_way.jpg"));
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

// Improve texture sharpness at glancing angles and reduce pixelation.
colorMap.colorSpace = THREE.SRGBColorSpace;
colorMap.anisotropy = maxAnisotropy;
colorMap.minFilter = THREE.LinearMipmapLinearFilter;
colorMap.magFilter = THREE.LinearFilter;

normalMap.anisotropy = maxAnisotropy;
normalMap.minFilter = THREE.LinearMipmapLinearFilter;
normalMap.magFilter = THREE.LinearFilter;

lightsMap.colorSpace = THREE.SRGBColorSpace;
lightsMap.anisotropy = maxAnisotropy;
lightsMap.minFilter = THREE.LinearMipmapLinearFilter;
lightsMap.magFilter = THREE.LinearFilter;

// Treat clouds as a mask instead of a dark color overlay.
cloudsMap.colorSpace = THREE.NoColorSpace;
cloudsMap.anisotropy = maxAnisotropy;
cloudsMap.minFilter = THREE.LinearMipmapLinearFilter;
cloudsMap.magFilter = THREE.LinearFilter;

roughnessMap.colorSpace = THREE.NoColorSpace;
roughnessMap.anisotropy = maxAnisotropy;
roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
roughnessMap.magFilter = THREE.LinearFilter;

starsMap.colorSpace = THREE.SRGBColorSpace;
starsMap.anisotropy = maxAnisotropy;
starsMap.minFilter = THREE.LinearMipmapLinearFilter;
starsMap.magFilter = THREE.LinearFilter;

const globeMaterial = new THREE.MeshStandardMaterial({
  map: colorMap,
  normalMap: normalMap,
  roughnessMap: roughnessMap,
  emissive: new THREE.Color(0xffffff),
  emissiveMap: lightsMap,
  emissiveIntensity: 0.9,
  roughness: 0.72,
  metalness: 0.02
});

// Fade city lights on the day side based on the sun direction.
globeMaterial.onBeforeCompile = shader => {
  shader.uniforms.sunDirection = { value: new THREE.Vector3(1, 0, 0) };
  shader.uniforms.terminatorColor = { value: new THREE.Color(0xff8844) };
  shader.uniforms.terminatorStrength = { value: 0.18 };
  shader.uniforms.terminatorWidth = { value: 22.0 };

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    `
#include <common>
uniform vec3 sunDirection;
uniform vec3 terminatorColor;
uniform float terminatorStrength;
uniform float terminatorWidth;
`
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <emissivemap_fragment>",
    `
#include <emissivemap_fragment>
float sunDot = dot(normalize(vNormal), normalize(sunDirection));
float nightFactor = smoothstep(0.15, -0.25, sunDot);
totalEmissiveRadiance *= nightFactor;
`
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <dithering_fragment>",
    `
float sunDotBand = dot(normalize(vNormal), normalize(sunDirection));
float terminator = exp(-abs(sunDotBand) * terminatorWidth);
outgoingLight += terminatorColor * (terminator * terminatorStrength);
#include <dithering_fragment>
`
  );

  globeMaterial.userData.shader = shader;
};

const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), globeMaterial);
scene.add(globe);

const sunDirWorld = new THREE.Vector3();
const sunDirView = new THREE.Vector3();

// Atmosphere (rim glow)
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.06, 96, 96),
  new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x4fa3ff) },
      intensity: { value: 0.7 },
      power: { value: 4.0 }
    },
    vertexShader: `
      varying vec3 vNormalView;
      void main() {
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      uniform float power;
      varying vec3 vNormalView;
      void main() {
        float rim = 1.0 - max(dot(vNormalView, vec3(0.0, 0.0, 1.0)), 0.0);
        float glow = intensity * pow(rim, power);
        gl_FragColor = vec4(glowColor, glow);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide
  })
);
scene.add(atmosphere);

// Clouds layer
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(1.01, 96, 96),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    alphaMap: cloudsMap,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    roughness: 1.0,
    metalness: 0.0
  })
);
scene.add(clouds);

// Stars
function makeStarSprite(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0.0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.25)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const starSprite = makeStarSprite();

function createStars({
  count,
  minRadius,
  maxRadius,
  size,
  opacity
}) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const radius = minRadius + Math.random() * (maxRadius - minRadius);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Subtle variation between cool white and faint blue.
    const t = Math.random();
    color.setRGB(0.75 + 0.25 * t, 0.8 + 0.2 * t, 0.9 + 0.1 * t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    map: starSprite ?? null,
    alphaTest: 0.05,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geometry, material);
}

const starsFar = createStars({
  count: 2600,
  minRadius: 80,
  maxRadius: 140,
  size: 0.55,
  opacity: 0.8
});
scene.add(starsFar);

const starsNear = createStars({
  count: 900,
  minRadius: 55,
  maxRadius: 85,
  size: 0.9,
  opacity: 0.55
});
scene.add(starsNear);

// Milky Way background
const milkyWay = new THREE.Mesh(
  new THREE.SphereGeometry(260, 64, 64),
  new THREE.MeshBasicMaterial({
    map: starsMap,
    side: THREE.BackSide,
    depthWrite: false
  })
);
scene.add(milkyWay);

// Procedural nebula overlay
const nebula = new THREE.Mesh(
  new THREE.SphereGeometry(258, 64, 64),
  new THREE.ShaderMaterial({
    uniforms: {
      c1: { value: new THREE.Color(0x0b1b3a) },
      c2: { value: new THREE.Color(0x3b2a6d) },
      c3: { value: new THREE.Color(0x8a2c6a) },
      c4: { value: new THREE.Color(0x1e6fbf) },
      strength: { value: 0.55 }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vDir = normalize(worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 c1;
      uniform vec3 c2;
      uniform vec3 c3;
      uniform vec3 c4;
      uniform float strength;
      varying vec3 vDir;

      float bands(vec3 d) {
        float b =
          0.45 * sin(d.x * 9.0) +
          0.35 * sin(d.y * 13.0) +
          0.25 * sin((d.x + d.z) * 17.0) +
          0.20 * sin(length(d.xy) * 21.0);
        return 0.5 + 0.5 * b;
      }

      void main() {
        float t = bands(vDir);
        vec3 base = mix(c1, c2, smoothstep(0.12, 0.78, t));
        base = mix(base, c4, smoothstep(0.32, 0.95, t));
        base = mix(base, c3, smoothstep(0.62, 1.0, t));
        gl_FragColor = vec4(base, strength);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
);
scene.add(nebula);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.6;
controls.maxDistance = 4.5;
controls.autoRotate = false;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.enableDamping = true;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY;
controls.enableZoom = true;
controls.target.set(0, 0, 0);

// Zoom buttons
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomStep = 0.6;
const zoomScale = 1.2;

function clampZoom(distance) {
  return THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance);
}

function applyZoom(delta) {
  if (controls.dollyIn && controls.dollyOut) {
    if (delta < 0) {
      controls.dollyIn(zoomScale);
    } else {
      controls.dollyOut(zoomScale);
    }
    controls.update();
    return;
  }

  const direction = new THREE.Vector3();
  direction.copy(camera.position).sub(controls.target).normalize();
  const distance = camera.position.distanceTo(controls.target);
  const nextDistance = clampZoom(distance + delta);
  camera.position.copy(controls.target).add(direction.multiplyScalar(nextDistance));
  controls.update();
}

function stopPropagation(event) {
  event.stopPropagation();
}

zoomInBtn?.addEventListener("click", event => {
  stopPropagation(event);
  applyZoom(-zoomStep);
});
zoomOutBtn?.addEventListener("click", event => {
  stopPropagation(event);
  applyZoom(zoomStep);
});

// Player
const trackTitleEl = document.getElementById("track-title");
const trackArtistEl = document.getElementById("track-artist");
const timeCurrentEl = document.getElementById("time-current");
const timeDurationEl = document.getElementById("time-duration");
const seekEl = document.getElementById("track-seek");
const playBtn = document.getElementById("track-play");
const nextBtn = document.getElementById("track-next");
const prevBtn = document.getElementById("track-prev");

const audio = new Audio();
audio.preload = "auto";
audio.volume = 0.1;

const tracks = [
  { artist: "AERØHEAD", title: "Giving Away", src: "./assets/song/AERØHEAD - Giving Away.mp3" },
  { artist: "Devyzed & Ghostrifter", title: "Travelers", src: "./assets/song/Devyzed & Ghostrifter - Travelers_fixed2.mp3" },
  { artist: "Hayden Folker", title: "Adrift", src: "./assets/song/Hayden Folker - Adrift_fixed2.mp3" },
  { artist: "Punch Deck", title: "Spacewalk", src: "./assets/song/Punch Deck - Spacewalk_fixed2.mp3" },
  { artist: "Rexlambo", title: "Under The Stars", src: "./assets/song/Rexlambo - Under The Stars.mp3" }
];

let currentIndex = 0;
let isSeeking = false;

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateTrackUI() {
  const track = tracks[currentIndex];
  if (trackTitleEl) trackTitleEl.textContent = track.title;
  if (trackArtistEl) trackArtistEl.textContent = track.artist;
}

function loadTrack(index, autoplay = false) {
  const safeIndex = ((index % tracks.length) + tracks.length) % tracks.length;
  currentIndex = safeIndex;
  const track = tracks[safeIndex];
  audio.src = track.src;
  audio.load();
  updateTrackUI();
  isSeeking = false;
  if (seekEl) seekEl.value = "0";
  if (timeCurrentEl) timeCurrentEl.textContent = "0:00";
  if (timeDurationEl) timeDurationEl.textContent = "0:00";
  if (autoplay) {
    audio.play().catch(() => {});
  }
  if (playBtn) playBtn.textContent = autoplay ? "||" : ">";
}

function togglePlay() {
  if (!audio.src) {
    loadTrack(currentIndex, true);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
    if (playBtn) playBtn.textContent = "||";
  } else {
    audio.pause();
    if (playBtn) playBtn.textContent = ">";
  }
}

function nextTrack() {
  loadTrack(currentIndex + 1, true);
}

function prevTrack() {
  loadTrack(currentIndex - 1, true);
}

function setSeekFromAudio() {
  if (!seekEl || isSeeking) return;
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  seekEl.value = duration ? String((current / duration) * 100) : "0";
  if (timeCurrentEl) timeCurrentEl.textContent = formatTime(current);
  if (timeDurationEl) timeDurationEl.textContent = formatTime(duration);
}

function setAudioFromSeek() {
  if (!seekEl) return;
  const duration = audio.duration || 0;
  if (!duration) return;
  const value = Number(seekEl.value) / 100;
  audio.currentTime = duration * value;
}


playBtn?.addEventListener("click", event => {
  stopPropagation(event);
  togglePlay();
});

nextBtn?.addEventListener("click", event => {
  stopPropagation(event);
  nextTrack();
});

prevBtn?.addEventListener("click", event => {
  stopPropagation(event);
  prevTrack();
});

seekEl?.addEventListener("input", () => {
  isSeeking = true;
  setAudioFromSeek();
});
seekEl?.addEventListener("change", () => {
  isSeeking = false;
  setAudioFromSeek();
});

audio.addEventListener("timeupdate", setSeekFromAudio);
audio.addEventListener("loadedmetadata", setSeekFromAudio);
audio.addEventListener("durationchange", setSeekFromAudio);
audio.addEventListener("canplay", setSeekFromAudio);
audio.addEventListener("loadedmetadata", () => {
  // Workaround for MP3s that report Infinity duration until forced.
  if (!Number.isFinite(audio.duration)) {
    audio.currentTime = 1e101;
  }
});
audio.addEventListener("durationchange", () => {
  if (Number.isFinite(audio.duration) && audio.currentTime > 1e50) {
    audio.currentTime = 0;
  }
});
audio.addEventListener("ended", () => {
  nextTrack();
});

loadTrack(0, false);

// Country borders
function latLonToVector3(lat, lon, radius = 1.002) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

function pointToLatLon(pointWorld) {
  const p = pointWorld.clone().normalize();
  const lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
  const theta = Math.atan2(p.z, -p.x);
  let lon = THREE.MathUtils.radToDeg(theta) - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

function addRingSegments(ring, positions) {
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const v1 = latLonToVector3(lat1, lon1);
    const v2 = latLonToVector3(lat2, lon2);
    positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  }
}

let countriesGeoJson = null;
let selectedCountryBorders = null;

async function addCountryBorders() {
  try {
    const res = await fetch(assetUrl("./assets/countries.geo.json"));
    if (!res.ok) throw new Error(`Failed to load borders (${res.status})`);
    const geojson = await res.json();
    countriesGeoJson = geojson;

    const positions = [];
    for (const feature of geojson.features) {
      const geom = feature.geometry;
      if (!geom) continue;

      if (geom.type === "Polygon") {
        for (const ring of geom.coordinates) addRingSegments(ring, positions);
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          for (const ring of poly) addRingSegments(ring, positions);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    const material = new THREE.LineBasicMaterial({
      color: 0x8fb7ff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });

    const borders = new THREE.LineSegments(geometry, material);
    scene.add(borders);
  } catch (err) {
    console.warn("Country borders failed to load:", err);
  }
}

addCountryBorders();

// Country popup on click
const tooltipEl = document.getElementById("tooltip");
const countryPanelEl = document.getElementById("country-panel");
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerDown = new THREE.Vector2();
const hitPoint = new THREE.Vector3();
const tooltipAnchorWorld = new THREE.Vector3();
const projectedAnchor = new THREE.Vector3();
const cameraToAnchor = new THREE.Vector3();
const cameraDir = new THREE.Vector3();
let hasTooltipAnchor = false;
let pointerMoved = false;
let tooltipRequestId = 0;
const summaryCache = new Map();

function showTooltip(x, y, html) {
  if (!tooltipEl) return;
  tooltipEl.style.display = "block";
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
  tooltipEl.innerHTML = html;
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.style.display = "none";
  hasTooltipAnchor = false;
}

function showCountryPanel(title, bodyHtml) {
  if (!countryPanelEl) return;
  countryPanelEl.style.display = "block";
  countryPanelEl.innerHTML = `<h3>${title}</h3><p>${bodyHtml}</p>`;
}

function hideCountryPanel() {
  if (!countryPanelEl) return;
  countryPanelEl.style.display = "none";
}

function setTooltipAnchor(pointWorld, html) {
  tooltipAnchorWorld.copy(pointWorld);
  hasTooltipAnchor = true;
  showTooltip(0, 0, html);
}

function updateTooltipPosition() {
  if (!tooltipEl || !hasTooltipAnchor) return;

  projectedAnchor.copy(tooltipAnchorWorld).project(camera);
  const inClip = projectedAnchor.z >= -1 && projectedAnchor.z <= 1;
  if (!inClip) {
    tooltipEl.style.display = "none";
    return;
  }

  camera.getWorldDirection(cameraDir);
  cameraToAnchor.copy(tooltipAnchorWorld).sub(camera.position).normalize();
  const facingCamera = cameraDir.dot(cameraToAnchor) > 0;
  if (!facingCamera) {
    tooltipEl.style.display = "none";
    return;
  }

  tooltipEl.style.display = "block";
  const x = (projectedAnchor.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projectedAnchor.y * 0.5 + 0.5) * window.innerHeight;
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon, lat, rings) {
  if (!rings || rings.length === 0) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

function findCountryAtLatLon(lat, lon) {
  if (!countriesGeoJson?.features) return null;
  for (const feature of countriesGeoJson.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === "Polygon") {
      if (pointInPolygon(lon, lat, geom.coordinates)) return feature;
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        if (pointInPolygon(lon, lat, poly)) return feature;
      }
    }
  }
  return null;
}

function createCountryBorderHighlight(feature, scale = 1.002) {
  const geom = feature?.geometry;
  if (!geom) return null;

  const positions = [];
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) addRingSegments(ring, positions);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      for (const ring of poly) addRingSegments(ring, positions);
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0xffe082,
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.scale.setScalar(scale / 1.002);
  return lines;
}

function highlightCountry(feature) {
  if (selectedCountryBorders) {
    scene.remove(selectedCountryBorders);
    selectedCountryBorders.geometry.dispose();
    selectedCountryBorders.material.dispose();
    selectedCountryBorders = null;
  }

  if (!feature) return;
  selectedCountryBorders = createCountryBorderHighlight(feature);
  if (selectedCountryBorders) scene.add(selectedCountryBorders);
}

async function fetchCountrySummary(countryName) {
  if (summaryCache.has(countryName)) return summaryCache.get(countryName);
  const url =
    "https://en.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(countryName);
  const res = await fetch(url, {
    headers: { accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Summary fetch failed (${res.status})`);
  const data = await res.json();
  const summary = data?.extract || "No summary available.";
  summaryCache.set(countryName, summary);
  return summary;
}

function formatTimeAtLongitude(lon, date = new Date()) {
  // Approximate local time from longitude (15° ≈ 1 hour).
  const offsetHours = lon / 15;
  const ms = date.getTime() + offsetHours * 60 * 60 * 1000;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatTimeAtTimeZone(timeZone, date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone
    });
    return fmt.format(date);
  } catch {
    return null;
  }
}

const timeZoneCache = new Map();

async function lookupTimeZone(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (timeZoneCache.has(key)) return timeZoneCache.get(key);

  // Open-Meteo returns a valid IANA time zone with timezone=auto.
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    "&current=temperature_2m&timezone=auto";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Time zone lookup failed (${res.status})`);
  const data = await res.json();
  const timeZone = data?.timezone ?? null;
  if (timeZone) timeZoneCache.set(key, timeZone);
  return timeZone;
}

renderer.domElement.addEventListener("pointerdown", event => {
  pointerDown.set(event.clientX, event.clientY);
  pointerMoved = false;
});

renderer.domElement.addEventListener("pointermove", event => {
  if (pointerMoved) return;
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  if (dx * dx + dy * dy > 16) pointerMoved = true;
});

renderer.domElement.addEventListener("pointerup", async event => {
  if (pointerMoved) return;

  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(globe, false);
  if (hits.length === 0) {
    hideTooltip();
    return;
  }

  hitPoint.copy(hits[0].point);
  const { lat, lon } = pointToLatLon(hitPoint);
  const feature = findCountryAtLatLon(lat, lon);
  const requestId = ++tooltipRequestId;

  if (!feature) {
    highlightCountry(null);
    hideTooltip();
    hideCountryPanel();
    return;
  }

  highlightCountry(feature);
  const countryName = feature.properties?.name ?? "Unknown";
  showCountryPanel(countryName, "Loading summary...");

  const approxTime = formatTimeAtLongitude(lon);
  const loadingHtml =
    `${countryName}<br/>Time calculating...<br/>` +
    `Latitude ${lat.toFixed(2)}, Longitude ${lon.toFixed(2)}`;
  setTooltipAnchor(hitPoint, loadingHtml);

  try {
    const timeZone = await lookupTimeZone(lat, lon);
    if (requestId !== tooltipRequestId) return;

    const tzTime = timeZone ? formatTimeAtTimeZone(timeZone) : null;
    const timeLabel = tzTime ?? approxTime;
    const tzLabel = timeZone ? ` (${timeZone})` : " (approx)";
    const html =
      `${countryName}<br/>Time ${timeLabel}${tzLabel}<br/>` +
      `Latitude ${lat.toFixed(2)}, Longitude ${lon.toFixed(2)}`;
    setTooltipAnchor(hitPoint, html);
  } catch {
    // Keep the approximate time if the lookup fails.
  }

  try {
    const summary = await fetchCountrySummary(countryName);
    if (requestId !== tooltipRequestId) return;
    showCountryPanel(countryName, summary);
  } catch {
    if (requestId !== tooltipRequestId) return;
    showCountryPanel(countryName, "Summary unavailable.");
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateSunFromTime();
  updateTooltipPosition();

  // Keep the shader's sun direction in view space (matches vNormal).
  const shader = globeMaterial.userData.shader;
  if (shader?.uniforms?.sunDirection) {
    sunDirWorld.copy(sun.position).normalize();
    sunDirView.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
    shader.uniforms.sunDirection.value.copy(sunDirView);
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

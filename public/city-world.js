import * as THREE from '/vendor/three/three.module.js';
import { CITY_ORIGIN, PLAYER_START } from './map-config.js';

const TILE_ZOOM = 17;
const TILE_PIXELS = 256;
const VIEW_TILES = 3;
const MAX_TILE_TEXTURES = 45;
const ROAD_SPACING = 108;
const MAP_START = CITY_ORIGIN;

function project(lat, lon) {
  const scale = TILE_PIXELS * 2 ** TILE_ZOOM;
  const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: (lon + 180) / 360 * scale,
    y: (1 - Math.asinh(Math.tan(boundedLat * Math.PI / 180)) / Math.PI) / 2 * scale
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = value * 1664525 + 1013904223 >>> 0;
    return value / 4294967296;
  };
}

function makeNameSprite(name, color, width = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(15, 23, 17, 0.91)';
  context.beginPath();
  context.roundRect(4, 7, width - 8, 82, 15);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.stroke();
  context.font = '600 38px "DM Mono", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(name.toUpperCase(), width / 2, 48, width - 28);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(name.length * 0.14 + 2, .5, 1);
  return sprite;
}

class CityWorld {
  constructor({ canvas, places, onPosition, onStatus, onMode, onMapTiles = () => {} }) {
    this.canvas = canvas;
    this.places = places;
    this.onPosition = onPosition;
    this.onStatus = onStatus;
    this.onMode = onMode;
    this.onMapTiles = onMapTiles;
    this.destroyed = false;
    this.raf = 0;
    this.lastFrame = performance.now();
    this.keys = new Set();
    this.textures = new Map();
    this.tileGroups = new Map();
    this.players = new Map();
    this.landmarkModels = new Map();
    this.roadsideTrees = [];
    this.bikes = [];
    this.animals = [];
    this.audioContext = null;
    this.audioLoops = null;
    this.lastAudioUpdateAt = 0;
    this.nextFootstepAt = 0;
    this.target = null;
    this.heading = 0;
    this.speed = 0;
    this.vehicle = false;
    this.isPassenger = false;
    this.cameraDistance = 10;
    this.jumpVelocity = 0;
    this.playerHeight = 0;
    this.position = { ...PLAYER_START };
    this.projectedStart = project(MAP_START.lat, MAP_START.lon);
    this.metersPerPixel = 156543.03392 * Math.cos(MAP_START.lat * Math.PI / 180) / (2 ** TILE_ZOOM);
    this.worldPosition = this.localPosition(PLAYER_START.lat, PLAYER_START.lon);
    this.position = this.geoPosition(this.worldPosition.x, this.worldPosition.z);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9aa799);
    this.scene.fog = new THREE.Fog(0xa9b3a0, 170, 950);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.camera = new THREE.PerspectiveCamera(59, 1, .1, 1800);
    this.scene.add(new THREE.HemisphereLight(0xe5eddf, 0x545449, 2.15));
    this.sun = new THREE.DirectionalLight(0xffe7bd, 3.1);
    this.sun.position.set(-110, 190, 90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -115;
    this.sun.shadow.camera.right = 115;
    this.sun.shadow.camera.top = 115;
    this.sun.shadow.camera.bottom = -115;
    this.sun.shadow.normalBias = .04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200000, 200000),
      new THREE.MeshStandardMaterial({ color: 0x77836f, roughness: 1 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -.34;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.makePlayer();
    this.makeCar();
    this.makeStreetLife();
    this.makeUkkadamKuniyamuthurFlyover();
    this.makeTargetMarker();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.keyDown = event => this.onKeyDown(event);
    this.keyUp = event => this.onKeyUp(event);
    this.touchButtons = [...document.querySelectorAll('[data-move]')];
    this.touchRelease = event => {
      const button = this.touchButtons.find(item => item.hasPointerCapture?.(event.pointerId));
      if (button) {
        this.keys.delete(button.dataset.move);
        button.releasePointerCapture(event.pointerId);
      }
    };
    this.touchDownHandlers = new Map();
    for (const button of this.touchButtons) {
      const pointerDown = event => {
        event.preventDefault();
        this.startAudio();
        this.keys.add(button.dataset.move);
        button.setPointerCapture(event.pointerId);
      };
      this.touchDownHandlers.set(button, pointerDown);
      button.addEventListener('pointerdown', pointerDown);
      button.addEventListener('pointerup', this.touchRelease);
      button.addEventListener('pointercancel', this.touchRelease);
      button.addEventListener('lostpointercapture', this.touchRelease);
    }
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearKeys = () => this.keys.clear());
    this.resize();
    this.updateTiles();
    this.onStatus('THIRD-PERSON CITY · LOADING COIMBATORE');
    this.updateCamera(1 / 60);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.animate);
  }

  localPosition(lat, lon) {
    return {
      x: (lon - MAP_START.lon) * 111320 * Math.cos(MAP_START.lat * Math.PI / 180),
      z: (MAP_START.lat - lat) * 111320
    };
  }

  geoPosition(x, z) {
    return {
      lat: MAP_START.lat - z / 111320,
      lon: MAP_START.lon + x / (111320 * Math.cos(MAP_START.lat * Math.PI / 180))
    };
  }

  startAudio() {
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') void this.audioContext.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('This browser does not support game audio.');
      return;
    }
    this.audioContext = new AudioContextClass();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.audioMuted ? 0 : .55;
    this.masterGain.connect(this.audioContext.destination);
    const createLoop = (wave, frequency, cutoff) => {
      const oscillator = this.audioContext.createOscillator();
      const filter = this.audioContext.createBiquadFilter();
      const gain = this.audioContext.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      gain.gain.value = 0;
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      oscillator.start();
      return { oscillator, gain };
    };
    this.audioLoops = {
      car: createLoop('sawtooth', 42, 240),
      bus: createLoop('sawtooth', 34, 150),
      train: createLoop('triangle', 28, 110),
      bike: createLoop('sawtooth', 65, 420),
      airplane: createLoop('sawtooth', 55, 190)
    };
  }

  playAudioTone(frequency, duration, volume = .04, wave = 'sine') {
    if (!this.audioContext) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const start = this.audioContext.currentTime;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * .45), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  playFootstep(volume) {
    if (!this.audioContext) return;
    const context = this.audioContext;
    const length = Math.ceil(context.sampleRate * .08);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) samples[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .08);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  toggleSound() {
    const shouldEnable = !this.audioContext;
    this.startAudio();
    if (!this.audioContext || !this.masterGain) return false;
    if (shouldEnable) {
      this.audioMuted = false;
      this.masterGain.gain.setTargetAtTime(.55, this.audioContext.currentTime, .04);
      return true;
    }
    this.audioMuted = !this.audioMuted;
    this.masterGain.gain.setTargetAtTime(this.audioMuted ? 0 : .55, this.audioContext.currentTime, .04);
    return !this.audioMuted;
  }

  updateAudio(now) {
    if (!this.audioContext || !this.audioLoops) return;
    if (now - this.lastAudioUpdateAt < 100) return;
    this.lastAudioUpdateAt = now;
    const context = this.audioContext;
    const time = context.currentTime;
    const setLoop = (name, frequency, volume) => {
      const loop = this.audioLoops[name];
      loop.oscillator.frequency.setTargetAtTime(frequency, time, .12);
      loop.gain.gain.setTargetAtTime(volume, time, .2);
    };
    setLoop('car', 38 + Math.abs(this.speed) * 5.2, this.vehicle ? .032 : 0);
    const busDistance = Math.hypot(this.cityBus.position.x - this.worldPosition.x, this.cityBus.position.z - this.worldPosition.z);
    setLoop('bus', 34 + Math.abs(this.busSpeed || 6) * 3, Math.max(0, 1 - busDistance / 80) * .018);
    let trainDistance = Infinity;
    for (const train of this.railwayTrains || []) {
      const x = this.railwayPosition.x + train.model.position.x;
      const z = this.railwayPosition.z + train.trackZ;
      trainDistance = Math.min(trainDistance, Math.hypot(x - this.worldPosition.x, z - this.worldPosition.z));
    }
    setLoop('train', 30 + Math.sin(now * .01) * 4, Math.max(0, 1 - trainDistance / 260) * .026);
    let bikeDistance = Infinity;
    for (const bike of this.bikes) {
      bikeDistance = Math.min(bikeDistance, Math.hypot(bike.position.x - this.worldPosition.x, bike.position.z - this.worldPosition.z));
    }
    setLoop('bike', 65 + bikeDistance * .15, Math.max(0, 1 - bikeDistance / 55) * .014);
    let planeDistance = Infinity;
    for (const airport of this.landmarkModels.values()) {
      const plane = airport.userData.plane;
      if (!plane) continue;
      const x = airport.position.x + plane.position.x;
      const z = airport.position.z + plane.position.z;
      planeDistance = Math.min(planeDistance, Math.hypot(x - this.worldPosition.x, z - this.worldPosition.z));
    }
    setLoop('airplane', 52 + Math.sin(now * .002) * 9, Math.max(0, 1 - planeDistance / 800) * .025);
  }

  makePlayer() {
    this.player = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: 0xc4ed69, roughness: .75 });
    const darkGreen = new THREE.MeshStandardMaterial({ color: 0x304735, roughness: .86 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb77852, roughness: .9 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0x20251f, roughness: .9 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(.72, .9, .39), darkGreen);
    torso.position.y = 1.33;
    torso.castShadow = true;
    this.player.add(torso);
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(.76, .24, .42), green);
    jacket.position.y = 1.58;
    jacket.castShadow = true;
    this.player.add(jacket);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.255, 16, 12), skin);
    head.position.set(0, 1.99, -.035);
    head.castShadow = true;
    this.player.add(head);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(.258, 16, 8, 0, Math.PI * 2, 0, Math.PI * .48),
      new THREE.MeshStandardMaterial({ color: 0x20221f, roughness: 1 })
    );
    hair.position.copy(head.position);
    hair.position.y += .045;
    hair.castShadow = true;
    this.player.add(hair);
    this.legs = [];
    this.arms = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * .2, .97, 0);
      const limb = new THREE.Mesh(new THREE.BoxGeometry(.23, .69, .26), darkGreen);
      limb.position.y = -.34;
      limb.castShadow = true;
      leg.add(limb);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(.25, .14, .39), shoes);
      foot.position.set(0, -.66, -.075);
      foot.castShadow = true;
      leg.add(foot);
      this.player.add(leg);
      this.legs.push(leg);

      const arm = new THREE.Group();
      arm.position.set(side * .45, 1.64, 0);
      const armLimb = new THREE.Mesh(new THREE.BoxGeometry(.18, .57, .22), skin);
      armLimb.position.y = -.27;
      armLimb.castShadow = true;
      arm.add(armLimb);
      this.player.add(arm);
      this.arms.push(arm);
    }
    this.player.castShadow = true;
    this.scene.add(this.player);
    this.nameTag = makeNameSprite('YOU', '#d4f36a', 180);
    this.nameTag.position.y = 2.54;
    this.player.add(this.nameTag);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(.55, 18),
      new THREE.MeshBasicMaterial({ color: 0x192018, transparent: true, opacity: .3 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = .015;
    this.player.add(shadow);
  }

  makeCar() {
    this.car = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc59a47, roughness: .57, metalness: .14 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x29393a, roughness: .35, metalness: .23 });
    const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: .9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.03, .73, 4.05), bodyMaterial);
    body.position.y = .78;
    body.castShadow = true;
    this.car.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.65, .78, 2.12), glassMaterial);
    roof.position.set(0, 1.4, -.22);
    roof.castShadow = true;
    this.car.add(roof);
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.72, .17, .19), new THREE.MeshStandardMaterial({ color: 0xe5d7a8 }));
    front.position.set(0, .75, -2.08);
    this.car.add(front);
    this.wheels = [];
    for (const x of [-1, 1]) {
      for (const z of [-1.32, 1.32]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.39, .39, .23, 16), tireMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, .46, z);
        wheel.castShadow = true;
        this.car.add(wheel);
        this.wheels.push(wheel);
      }
    }
    this.scene.add(this.car);
    const carPosition = this.localPosition(PLAYER_START.lat, PLAYER_START.lon);
    this.car.position.set(carPosition.x, 0, carPosition.z);
    this.car.rotation.y = 0;
    this.parkedCarPosition = { ...this.car.position };
  }

  makeStreetLife() {
    const materials = {
      asphalt: new THREE.MeshStandardMaterial({ color: 0x373a36, roughness: .98 }),
      curb: new THREE.MeshStandardMaterial({ color: 0xbcb5a0, roughness: .95 }),
      sidewalk: new THREE.MeshStandardMaterial({ color: 0xc4bda8, roughness: 1 }),
      tea: new THREE.MeshStandardMaterial({ color: 0xa94f31, roughness: .82 }),
      cream: new THREE.MeshStandardMaterial({ color: 0xe9d8b2, roughness: .84 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x354b42, roughness: .8 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x684a31, roughness: .94 }),
      temple: new THREE.MeshStandardMaterial({ color: 0xd8894f, roughness: .86 }),
      templeLight: new THREE.MeshStandardMaterial({ color: 0xf0cc84, roughness: .85 }),
      green: new THREE.MeshStandardMaterial({ color: 0x417354, roughness: .82 }),
      bus: new THREE.MeshStandardMaterial({ color: 0x176e62, roughness: .54, metalness: .12 }),
      busLight: new THREE.MeshStandardMaterial({ color: 0xe8bb59, roughness: .68 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9ec7c0, roughness: .28, metalness: .15 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x252722, roughness: .92 })
    };
    const box = (parent, width, height, depth, x, y, z, material, castShadow = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const roadWidth = 20;
    const roadZLength = 360;
    box(this.scene, roadWidth, .14, roadZLength, -2, -.02, 0, materials.asphalt, false);
    for (const side of [-1, 1]) {
      box(this.scene, 5, .22, roadZLength, -2 + side * 12.4, .025, 0, materials.sidewalk, false);
      box(this.scene, .32, .2, roadZLength, -2 + side * 10.15, .06, 0, materials.curb, false);
    }
    for (const z of [-68, 68]) {
      box(this.scene, 330, .14, 15, 0, -.02, z, materials.asphalt, false);
      for (const side of [-1, 1]) {
        box(this.scene, 330, .22, 4, 0, .025, z + side * 10.7, materials.sidewalk, false);
        box(this.scene, 330, .2, .32, 0, .06, z + side * 8.2, materials.curb, false);
      }
    }
    for (let z = -172; z <= 172; z += 14) {
      box(this.scene, .2, .035, 6.5, -2, .073, z, materials.busLight, false);
    }
    for (const intersectionZ of [-68, 68]) {
      for (let stripe = 0; stripe < 9; stripe++) {
        box(this.scene, 1.05, .035, 3.2, -10 + stripe * 2, .074, intersectionZ, materials.cream, false);
      }
    }
    this.streetPeopleOrigin = { ...this.worldPosition };

    const teaKadai = new THREE.Group();
    teaKadai.position.set(18, 0, -17);
    box(teaKadai, 8, 4.5, 7, 0, 2.25, 0, materials.tea);
    box(teaKadai, 8.8, .32, 7.8, 0, 4.65, 0, materials.wood);
    box(teaKadai, 2.3, .42, 8.3, -4.45, 3.75, 0, materials.roof);
    box(teaKadai, .8, 1.05, 6.5, -3.62, 1.15, 0, materials.wood);
    box(teaKadai, .9, .16, 6.7, -3.62, 1.72, 0, materials.cream);
    box(teaKadai, .12, 2.05, 2.7, -3.56, 2.55, -1.25, materials.glass, false);
    box(teaKadai, .14, 2.05, 1.9, -3.58, 2.55, 2.15, materials.roof, false);
    for (let index = 0; index < 3; index++) {
      const kettle = new THREE.Mesh(new THREE.CylinderGeometry(.23, .26, .42, 10), materials.busLight);
      kettle.position.set(-3.95, 2.02, -1.65 + index * 1.35);
      kettle.castShadow = true;
      teaKadai.add(kettle);
    }
    const teaSign = makeNameSprite('KOVAI TEA KADAI', '#fff0c5', 460);
    teaSign.scale.set(7.6, 1.5, 1);
    teaSign.position.set(-4.15, 4.95, 0);
    teaKadai.add(teaSign);
    this.scene.add(teaKadai);

    const temple = new THREE.Group();
    temple.position.set(-29, 0, -76);
    box(temple, 12, .35, 13, 0, .18, 0, materials.templeLight);
    box(temple, 9.5, 3.6, 9, 0, 1.95, 1.6, materials.cream);
    box(temple, 11, .65, 2, 0, 3.95, -3.4, materials.templeLight);
    for (let tier = 0; tier < 6; tier++) {
      const width = 7.3 - tier * .94;
      const height = .82 - tier * .055;
      const y = 4.45 + tier * .68;
      box(temple, width, height, 1.2, 0, y, -4.35, tier % 2 ? materials.templeLight : materials.temple);
      for (const x of [-width * .38, 0, width * .38]) {
        const detail = new THREE.Mesh(new THREE.SphereGeometry(.3, 8, 6), materials.busLight);
        detail.position.set(x, y + height * .62, -4.36);
        detail.castShadow = true;
        temple.add(detail);
      }
    }
    box(temple, 2.2, 3.2, .3, 0, 1.7, -4.62, materials.wood);
    const templeSign = makeNameSprite('KOVAI AMMAN TEMPLE', '#ffe3a6', 460);
    templeSign.scale.set(8.5, 1.65, 1);
    templeSign.position.set(0, 7.1, -5.3);
    temple.add(templeSign);
    temple.rotation.y = -Math.PI / 2;
    this.scene.add(temple);

    const stop = new THREE.Group();
    stop.position.set(11.3, 0, -39);
    for (const z of [-4, 4]) box(stop, .16, 3.2, .16, 0, 1.6, z, materials.wood);
    box(stop, 4.8, .2, 9, 0, 3.25, 0, materials.roof);
    box(stop, 3.6, .55, 2.4, 0, .55, .9, materials.wood);
    const stopSign = makeNameSprite('GANDHIPURAM BUS STOP', '#d4f36a', 500);
    stopSign.scale.set(6.6, 1.3, 1);
    stopSign.position.set(0, 4.05, 0);
    stop.add(stopSign);
    this.scene.add(stop);

    const bus = new THREE.Group();
    box(bus, 2.9, 3.15, 10.2, 0, 1.8, 0, materials.bus);
    box(bus, 2.55, .86, 8.45, 0, 2.57, -.18, materials.glass, false);
    box(bus, 2.68, .22, 10.28, 0, .38, 0, materials.busLight);
    box(bus, 2.3, .22, .18, 0, 3.2, -4.7, materials.busLight, false);
    for (const x of [-1.47, 1.47]) {
      for (const z of [-3.35, 3.35]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .22, 14), materials.tire);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, .58, z);
        wheel.castShadow = true;
        bus.add(wheel);
      }
    }
    for (const x of [-.92, .92]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(.42, .24, .12), materials.cream);
      light.position.set(x, 1.15, -5.16);
      bus.add(light);
    }
    const route = makeNameSprite('TOWN BUS · GANDHIPURAM', '#fff1c5', 540);
    route.scale.set(8.4, 1.68, 1);
    route.position.set(0, 3.35, -5.18);
    bus.add(route);
    bus.position.set(this.streetPeopleOrigin.x - 8, .05, this.streetPeopleOrigin.z - 47);
    this.scene.add(bus);
    this.cityBus = bus;

    this.streetPeople = [];
    const personMaterials = [0xb8563d, 0x355f8a, 0xa9a743, 0x784b70, 0xd18138, 0x436b59]
      .map(color => new THREE.MeshStandardMaterial({ color, roughness: .84 }));
    const skin = new THREE.MeshStandardMaterial({ color: 0xb77b55, roughness: .91 });
    for (let index = 0; index < 18; index++) {
      const person = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.31, .6, 3, 6), personMaterials[index % personMaterials.length]);
      body.position.y = 1.35;
      body.castShadow = true;
      person.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.23, 10, 8), skin);
      head.position.y = 1.91;
      head.castShadow = true;
      person.add(head);
      const legs = [];
      for (const side of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(side * .15, .92, 0);
        const limb = new THREE.Mesh(new THREE.BoxGeometry(.19, .82, .21), materials.wood);
        limb.position.y = -.38;
        limb.castShadow = true;
        leg.add(limb);
        person.add(leg);
        legs.push(leg);
      }
      const side = index % 2 ? 1 : -1;
      const baseX = side < 0 ? -14.5 : 10.8 + (index % 3) * .45;
      const baseZ = -88 + Math.floor(index / 2) * 20;
      person.position.set(this.streetPeopleOrigin.x + baseX, .15, this.streetPeopleOrigin.z + baseZ);
      person.userData = { baseX, baseZ, phase: index * 1.7, legs };
      this.streetPeople.push(person);
      this.scene.add(person);
    }
    for (let index = 0; index < 3; index++) {
      const customer = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.31, .62, 3, 6), personMaterials[(index + 2) % personMaterials.length]);
      torso.position.y = 1.15;
      torso.castShadow = true;
      customer.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.23, 10, 8), skin);
      head.position.y = 1.9;
      customer.add(head);
      customer.position.set(14.3 + index * .5, .15, -13 + index * 2.2);
      customer.rotation.y = Math.PI / 2;
      this.scene.add(customer);
    }
    this.makeNpcMotorcycles(materials);

    this.lampPosts = [];
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x39453c, roughness: .76, metalness: .26 });
    const lampGlow = new THREE.MeshStandardMaterial({ color: 0xffd887, emissive: 0xffb64e, emissiveIntensity: 1.1 });
    for (const side of [-1, 1]) {
      for (const z of [-94, -34, 30, 94]) {
        const lamp = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .15, 6, 8), lampMaterial);
        pole.position.y = 3;
        lamp.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(.9, .12, .12), lampMaterial);
        arm.position.set(-side * .35, 5.7, 0);
        lamp.add(arm);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), lampGlow);
        glow.position.set(-side * .74, 5.6, 0);
        lamp.add(glow);
        lamp.position.set(-2 + side * 11.4, .15, z);
        this.scene.add(lamp);
        this.lampPosts.push(lamp);
      }
    }

    this.makeUkkadamBridge(materials, box);
    this.makeCoimbatoreRailway(materials, box);
    this.makeStreetAnimals(materials);
  }

  makeStreetAnimals(materials) {
    const makeAnimal = (kind, x, z, scale = 1) => {
      const animal = new THREE.Group();
      const fur = new THREE.MeshStandardMaterial({
        color: kind === 'cow' ? 0xe8e1cd : kind === 'elephant' ? 0x777b78 : 0x976e43,
        roughness: .96
      });
      const dark = new THREE.MeshStandardMaterial({ color: kind === 'cow' ? 0x49392f : 0x51483d, roughness: 1 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), fur);
      body.scale.set(kind === 'elephant' ? 1.55 : kind === 'cow' ? 1.2 : .78, kind === 'elephant' ? 1.15 : .82, kind === 'elephant' ? 2.25 : 1.5);
      body.position.y = kind === 'elephant' ? 1.65 : 1.05;
      body.castShadow = true;
      animal.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(kind === 'elephant' ? .72 : .48, 10, 8), fur);
      head.position.set(0, kind === 'elephant' ? 2.1 : 1.2, kind === 'elephant' ? -1.85 : -1.18);
      head.castShadow = true;
      animal.add(head);
      const legCount = 4;
      for (let index = 0; index < legCount; index++) {
        const side = index % 2 ? 1 : -1;
        const front = index < 2;
        const legHeight = kind === 'elephant' ? 1.15 : kind === 'cow' ? .78 : .45;
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(kind === 'elephant' ? .25 : .12, kind === 'elephant' ? .3 : .14, legHeight, 7),
          kind === 'cow' && index === 3 ? dark : fur
        );
        leg.position.set(side * (kind === 'elephant' ? .88 : .66), legHeight / 2, front ? -.85 : .82);
        leg.castShadow = true;
        animal.add(leg);
      }
      if (kind === 'elephant') {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.19, .13, 1.15, 8), fur);
        trunk.position.set(0, 1.3, -2.25);
        trunk.rotation.x = -.28;
        animal.add(trunk);
        for (const side of [-1, 1]) {
          const ear = new THREE.Mesh(new THREE.SphereGeometry(.75, 8, 7), fur);
          ear.scale.set(.3, 1, .82);
          ear.position.set(side * .78, 2.05, -1.45);
          animal.add(ear);
          const tusk = new THREE.Mesh(new THREE.ConeGeometry(.11, .58, 7), new THREE.MeshStandardMaterial({ color: 0xf0e6cb }));
          tusk.position.set(side * .36, 1.42, -2.1);
          tusk.rotation.x = -.65;
          animal.add(tusk);
        }
      } else if (kind === 'cow') {
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(.055, .08, 1.05, 6), fur);
        tail.position.set(0, 1.35, 1.85);
        tail.rotation.x = -.38;
        animal.add(tail);
        for (const side of [-1, 1]) {
          const horn = new THREE.Mesh(new THREE.ConeGeometry(.09, .48, 6), materials.cream);
          horn.position.set(side * .31, 1.74, -1.45);
          horn.rotation.z = side * -.2;
          animal.add(horn);
        }
      } else {
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(.06, .12, .72, 6), fur);
        tail.position.set(0, 1.02, 1.2);
        tail.rotation.x = -.8;
        animal.add(tail);
      }
      animal.scale.setScalar(scale);
      animal.position.set(this.streetPeopleOrigin.x + x, .02, this.streetPeopleOrigin.z + z);
      this.scene.add(animal);
      this.animals.push({
        model: animal,
        kind,
        baseX: x,
        baseZ: z,
        phase: this.animals.length * 2.3,
        fleeUntil: 0
      });
    };

    const origin = this.streetPeopleOrigin;
    this.streetAnimalsOrigin = { ...origin };
    makeAnimal('elephant', -43, -88, 1.45);
    makeAnimal('cow', 16, -48, 1.05);
    makeAnimal('dog', -17, 48, 1.05);
    makeAnimal('dog', 16, 96, .9);
  }

  makeNpcMotorcycles(materials) {
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xd5a743, roughness: .52, metalness: .24 });
    const riderMaterials = [0x9d4635, 0x315e83, 0x6f7540, 0x7b4d75]
      .map(color => new THREE.MeshStandardMaterial({ color, roughness: .85 }));
    const skin = new THREE.MeshStandardMaterial({ color: 0xb77b55, roughness: .9 });
    this.bikes = [];
    for (let index = 0; index < 4; index++) {
      const bike = new THREE.Group();
      for (const z of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(.48, .1, 7, 16), materials.tire);
        wheel.rotation.y = Math.PI / 2;
        wheel.position.set(0, .58, z);
        wheel.castShadow = true;
        bike.add(wheel);
      }
      const tank = new THREE.Mesh(new THREE.BoxGeometry(.58, .42, .78), frameMaterial);
      tank.position.set(0, 1.12, -.15);
      tank.castShadow = true;
      bike.add(tank);
      const body = new THREE.Mesh(new THREE.BoxGeometry(.48, .48, .68), materials.bus);
      body.position.set(0, .85, .42);
      body.castShadow = true;
      bike.add(body);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(.5, .17, .78), materials.wood);
      seat.position.set(0, 1.32, .38);
      bike.add(seat);
      const rider = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.29, .48, 3, 7), riderMaterials[index]);
      torso.position.set(0, 1.84, .35);
      torso.rotation.x = -.18;
      torso.castShadow = true;
      rider.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 8), skin);
      head.position.set(0, 2.35, .08);
      head.castShadow = true;
      rider.add(head);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(.24, 10, 7, 0, Math.PI * 2, 0, Math.PI * .58), materials.busLight);
      helmet.position.copy(head.position);
      helmet.position.y += .04;
      rider.add(helmet);
      bike.add(rider);
      const position = this.localPosition(this.position.lat, this.position.lon);
      const laneX = index % 2 ? -15 : -5.7;
      const direction = index % 2 ? 1 : -1;
      const startZ = -110 + Math.floor(index / 2) * 130;
      bike.position.set(position.x + laneX, .05, position.z + startZ);
      bike.rotation.y = direction > 0 ? Math.PI : 0;
      bike.userData = {
        direction,
        laneX,
        phase: index * 79,
        speed: 8 + (index % 3) * 2.5,
        wheels: bike.children.filter(child => child.geometry?.type === 'TorusGeometry')
      };
      this.bikes.push(bike);
      this.scene.add(bike);
    }
  }

  updateNpcMotorcycles(deltaTime, now) {
    for (const bike of this.bikes) {
      const { direction, laneX, phase, speed, wheels } = bike.userData;
      const distance = ((now * .001 * speed + phase) % 360 + 360) % 360;
      bike.position.set(
        this.streetPeopleOrigin.x + laneX,
        .05,
        this.streetPeopleOrigin.z - 180 + (direction > 0 ? distance : 360 - distance)
      );
      wheels.forEach(wheel => { wheel.rotation.x += direction * speed * deltaTime / .48; });
    }
  }

  makeUkkadamKuniyamuthurFlyover() {
    const ukkadam = this.localPosition(10.9883471, 76.9618799);
    const kuniyamuthur = this.localPosition(10.9560206, 76.9540742);
    const control = [
      new THREE.Vector3(ukkadam.x, 0, ukkadam.z),
      new THREE.Vector3(ukkadam.x + 36, 0, ukkadam.z + 570),
      new THREE.Vector3(ukkadam.x - 15, 0, ukkadam.z + 1390),
      new THREE.Vector3(ukkadam.x - 290, 0, ukkadam.z + 2320),
      new THREE.Vector3(kuniyamuthur.x, 0, kuniyamuthur.z)
    ];
    const curve = new THREE.CatmullRomCurve3(control, false, 'centripetal');
    const sampleCount = 280;
    const points = curve.getPoints(sampleCount);
    const path = [];
    let distanceAlong = 0;
    let previous = points[0];
    const elevationAt = distance => {
      const rise = THREE.MathUtils.smoothstep(distance, 100, 540) * 10;
      const fall = THREE.MathUtils.smoothstep(distance, 3020, 3570) * 10;
      return Math.max(0, rise - fall);
    };
    path.push({ x: previous.x, z: previous.z, y: elevationAt(0), distance: 0 });
    for (let index = 1; index < points.length; index++) {
      const point = points[index];
      distanceAlong += previous.distanceTo(point);
      path.push({ x: point.x, z: point.z, y: elevationAt(distanceAlong), distance: distanceAlong });
      previous = point;
    }
    this.flyoverPath = path;
    const segmentCount = path.length - 1;
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x777971, roughness: .84 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0xd6cfb9, roughness: .78 });
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xe4ca72, roughness: .72 });
    const supportMaterial = new THREE.MeshStandardMaterial({ color: 0x9c9889, roughness: .96 });
    const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .75, 1), deckMaterial, segmentCount);
    const guardrails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), railMaterial, segmentCount * 2);
    const divider = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stripeMaterial, segmentCount);
    const supports = [];
    const supportGeometry = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < segmentCount; index++) {
      const start = path[index];
      const end = path[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const segmentLength = Math.hypot(dx, dz) + .6;
      const angle = Math.atan2(dx, dz);
      const middleY = (start.y + end.y) / 2;
      dummy.position.set((start.x + end.x) / 2, middleY, (start.z + end.z) / 2);
      dummy.rotation.set(0, angle, -Math.atan2(end.y - start.y, segmentLength));
      dummy.scale.set(15, 1, segmentLength);
      dummy.updateMatrix();
      deck.setMatrixAt(index, dummy.matrix);
      for (const side of [-1, 1]) {
        dummy.position.set(
          (start.x + end.x) / 2 + Math.cos(angle) * side * 7.5,
          middleY + .7,
          (start.z + end.z) / 2 + Math.sin(angle) * side * 7.5
        );
        dummy.rotation.set(0, angle, -Math.atan2(end.y - start.y, segmentLength));
        dummy.scale.set(.38, 1.1, segmentLength);
        dummy.updateMatrix();
        guardrails.setMatrixAt(index * 2 + (side === 1 ? 1 : 0), dummy.matrix);
      }
      dummy.position.set((start.x + end.x) / 2, middleY + .39, (start.z + end.z) / 2);
      dummy.rotation.set(0, angle, -Math.atan2(end.y - start.y, segmentLength));
      dummy.scale.set(.18, .06, segmentLength * .55);
      dummy.updateMatrix();
      divider.setMatrixAt(index, dummy.matrix);
      if (index > 0 && index % 4 === 0 && middleY > 1.8) {
        const pierHeight = middleY - .35;
        for (const side of [-1, 1]) {
          supports.push({
            x: (start.x + end.x) / 2 + Math.cos(angle) * side * 5.9,
            z: (start.z + end.z) / 2 + Math.sin(angle) * side * 5.9,
            height: pierHeight
          });
        }
      }
    }
    const pierMesh = new THREE.InstancedMesh(supportGeometry, supportMaterial, supports.length);
    supports.forEach((pier, index) => {
      dummy.position.set(pier.x, pier.height / 2, pier.z);
      dummy.scale.set(1.4, pier.height, 1.8);
      dummy.updateMatrix();
      pierMesh.setMatrixAt(index, dummy.matrix);
    });
    deck.castShadow = true;
    deck.receiveShadow = true;
    guardrails.castShadow = true;
    pierMesh.castShadow = true;
    const flyover = new THREE.Group();
    flyover.name = 'Ukkadam to Kuniyamuthur elevated flyover';
    flyover.add(deck, guardrails, divider, pierMesh);
    this.scene.add(flyover);
  }

  getFlyoverHeight(x, z) {
    if (!this.flyoverPath) return 0;
    let nearestDistance = Infinity;
    let elevation = 0;
    for (const point of this.flyoverPath) {
      const distance = Math.hypot(point.x - x, point.z - z);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      elevation = point.y;
    }
    return nearestDistance <= 7 ? elevation + .45 : 0;
  }

  makeUkkadamBridge(materials, box) {
    const bridge = new THREE.Group();
    bridge.name = 'Ukkadam Aathupalam bridge';
    const water = new THREE.MeshStandardMaterial({ color: 0x477779, roughness: .42, metalness: .08 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a927d, roughness: .94 });
    const waterway = box(bridge, 168, .12, 30, 0, -.3, 0, water, false);
    waterway.receiveShadow = false;
    box(bridge, 86, .85, 17, 0, .76, 0, materials.asphalt);
    for (const side of [-1, 1]) {
      box(bridge, 86, .42, .9, 0, 1.38, side * 8.05, stone);
      for (let index = 0; index < 12; index++) {
        box(bridge, .42, 1.25, .42, -40 + index * 7.25, .35, side * 8.35, stone);
      }
    }
    for (const x of [-31, 0, 31]) {
      box(bridge, 5, 7, 17, x, -3.45, 0, stone);
    }
    const bridgeSign = makeNameSprite('AATHUPALAM · UKKADAM', '#fff0c5', 580);
    bridgeSign.scale.set(13, 2.6, 1);
    bridgeSign.position.set(0, 8, 0);
    bridge.add(bridgeSign);
    const bridgePosition = this.localPosition(10.9808, 76.9583);
    bridge.position.set(bridgePosition.x, 0, bridgePosition.z);
    this.scene.add(bridge);

    const busStand = new THREE.Group();
    busStand.name = 'Ukkadam bus stand';
    const busPosition = this.localPosition(10.9883471, 76.9618799);
    busStand.position.set(busPosition.x, 0, busPosition.z);
    box(busStand, 48, .5, 30, 0, .25, 0, materials.sidewalk);
    box(busStand, 42, .5, 18, 0, 3.5, 0, materials.bus);
    for (const x of [-19, 0, 19]) box(busStand, .7, 7, .7, x, 0, 0, materials.wood);
    const standSign = makeNameSprite('UKKADAM BUS STAND', '#d4f36a', 580);
    standSign.scale.set(12, 2.4, 1);
    standSign.position.set(0, 8, 0);
    busStand.add(standSign);
    this.scene.add(busStand);
  }

  makeCoimbatoreRailway(materials, box) {
    const station = new THREE.Group();
    const railMetal = new THREE.MeshStandardMaterial({ color: 0x555d5a, roughness: .28, metalness: .76 });
    const sleeper = new THREE.MeshStandardMaterial({ color: 0x564a3d, roughness: .95 });
    const platform = new THREE.MeshStandardMaterial({ color: 0xbeb59f, roughness: .98 });
    const stationPaint = new THREE.MeshStandardMaterial({ color: 0xe7dfc9, roughness: .9 });
    const stationRoof = new THREE.MeshStandardMaterial({ color: 0x526c63, roughness: .7 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd9bb69, roughness: .8 });
    const stationPosition = this.localPosition(10.9975682, 76.9663657);
    station.position.set(stationPosition.x, 0, stationPosition.z);

    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, .22, .3), sleeper, 108);
    const sleeperTransform = new THREE.Object3D();
    for (let track = 0; track < 2; track++) {
      const trackZ = track ? 7 : -7;
      box(station, 300, .65, 14, 0, .32, trackZ + (track ? 16 : -16), platform);
      box(station, 300, .15, .12, 0, .67, trackZ + (track ? 9.2 : -9.2), yellow, false);
      for (let index = 0; index < 54; index++) {
        const x = -132 + index * 5;
        sleeperTransform.position.set(x, .12, trackZ);
        sleeperTransform.updateMatrix();
        sleepers.setMatrixAt(track * 54 + index, sleeperTransform.matrix);
      }
      for (const railZ of [-1.1, 1.1]) {
        box(station, 300, .24, .2, 0, .38, trackZ + railZ, railMetal, false);
      }
    }
    station.add(sleepers);

    box(station, 42, .5, 13, 0, .25, 30, stationPaint);
    box(station, 44, .6, 15, 0, 5.2, 30, stationRoof);
    for (const x of [-19, -9.5, 0, 9.5, 19]) box(station, .55, 4.8, .55, x, 2.6, 30, materials.wood);
    box(station, 5, 3.3, .4, -12, 2.15, 23.25, materials.glass, false);
    box(station, 5, 3.3, .4, 0, 2.15, 23.25, materials.glass, false);
    box(station, 5, 3.3, .4, 12, 2.15, 23.25, materials.glass, false);

    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 1100;
    boardCanvas.height = 300;
    const boardContext = boardCanvas.getContext('2d');
    boardContext.fillStyle = '#10201b';
    boardContext.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardContext.strokeStyle = '#d4f36a';
    boardContext.lineWidth = 8;
    boardContext.strokeRect(7, 7, boardCanvas.width - 14, boardCanvas.height - 14);
    boardContext.textAlign = 'center';
    boardContext.textBaseline = 'middle';
    boardContext.fillStyle = '#f4f0da';
    boardContext.font = 'bold 48px sans-serif';
    boardContext.fillText('கோயம்புத்தூர்  ⇄  പാലക്കാട്', 550, 58);
    boardContext.fillStyle = '#d4f36a';
    boardContext.font = '500 28px sans-serif';
    boardContext.fillText('PLATFORM 1 · கோயம்புத்தூர்  →  പാലക്കാട്', 550, 125);
    boardContext.fillText('PLATFORM 2 · പാലക്കാട്  →  கோயம்புத்தூர்', 550, 174);
    boardContext.fillStyle = '#d5dfcf';
    boardContext.font = '500 27px "DM Mono", monospace';
    boardContext.fillText('COIMBATORE JUNCTION · GAME SERVICE EVERY 30 SECONDS', 550, 250);
    const boardTexture = new THREE.CanvasTexture(boardCanvas);
    boardTexture.colorSpace = THREE.SRGBColorSpace;
    this.railwayBoard = new THREE.Sprite(new THREE.SpriteMaterial({ map: boardTexture, transparent: false }));
    this.railwayBoard.scale.set(31, 8.45, 1);
    this.railwayBoard.position.set(0, 10.5, 31);
    station.add(this.railwayBoard);
    station.name = 'Coimbatore Junction · scheduled Palakkad game trains';

    const makeTrain = (bodyMaterial, direction, trackZ) => {
      const train = new THREE.Group();
      for (let coachIndex = 0; coachIndex < 4; coachIndex++) {
        const coachZ = 13 - coachIndex * 10;
        const locomotive = coachIndex === 0;
        const car = new THREE.Group();
        box(car, 3.4, 2.7, locomotive ? 10.5 : 9.2, 0, 1.95, 0, locomotive ? bodyMaterial : materials.cream);
        box(car, 3.15, .22, locomotive ? 10 : 8.8, 0, 3.32, 0, bodyMaterial);
        for (const side of [-1, 1]) {
          box(car, .12, 1.12, locomotive ? 5.2 : 6.6, side * 1.72, 2.36, .15, materials.glass, false);
          for (let window = 0; window < (locomotive ? 2 : 3); window++) {
            box(car, .14, .85, .72, side * 1.79, 2.55, -2.3 + window * 2.15, materials.glass, false);
          }
          for (const axle of [-2.85, 2.85]) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .18, 12), materials.tire);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(side * 1.68, .72, axle);
            car.add(wheel);
          }
        }
        if (locomotive) {
          box(car, 2.5, .3, .24, 0, 1.08, -5.3, materials.busLight, false);
          const headlight = new THREE.Mesh(new THREE.SphereGeometry(.3, 10, 8), materials.cream);
          headlight.position.set(0, 2.25, -5.38);
          car.add(headlight);
          const destinationBoard = makeNameSprite(
            direction < 0 ? 'கோயம்புத்தூர் → പാലക്കാട്' : 'പാലക്കാട് → கோயம்புத்தൂർ',
            '#fff0c5',
            720
          );
          destinationBoard.scale.set(7.8, 1.55, 1);
          destinationBoard.position.set(0, 3.72, -4.7);
          car.add(destinationBoard);
        }
        car.position.z = coachZ;
        train.add(car);
      }
      train.rotation.y = direction < 0 ? Math.PI / 2 : -Math.PI / 2;
      train.position.set(0, 0, trackZ);
      station.add(train);
      return train;
    };

    this.railwayTrains = [
      { model: makeTrain(materials.bus, -1, -7), direction: -1, trackZ: -7, phase: 0 },
      { model: makeTrain(materials.temple, 1, 7), direction: 1, trackZ: 7, phase: 30 }
    ];
    this.railwayTrains[0].model.name = 'Coimbatore to Palakkad train';
    this.railwayTrains[1].model.name = 'Palakkad to Coimbatore train';
    this.railwayPosition = { ...stationPosition };
    this.railwayEpoch = performance.now();
    this.railwayStatusContext = boardContext;
    this.railwayStatusTexture = boardTexture;
    this.railwayLastCountdown = -1;
    this.scene.add(station);
  }

  updateRailway(now) {
    if (!this.railwayTrains) return;
    const cycle = 60;
    const elapsed = (now - this.railwayEpoch) / 1000;
    const time = elapsed % cycle;
    for (const train of this.railwayTrains) {
      const phase = (time - train.phase + cycle) % cycle;
      const moving = phase < 18;
      const startX = train.direction < 0 ? 150 : -150;
      const endX = -startX;
      const x = moving
        ? startX + train.direction * 300 * (phase / 18)
        : endX;
      train.model.position.set(x, 0, train.trackZ);
    }
    const nextDeparture = time < 18 || (time >= 30 && time < 48)
      ? 0
      : time < 30 ? 30 - time : cycle - time;
    const seconds = Math.ceil(nextDeparture);
    if (seconds === this.railwayLastCountdown) return;
    this.railwayLastCountdown = seconds;
    const context = this.railwayStatusContext;
    context.fillStyle = '#10201b';
    context.fillRect(8, 8, 1084, 284);
    context.strokeStyle = '#d4f36a';
    context.lineWidth = 8;
    context.strokeRect(7, 7, 1086, 286);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f4f0da';
    context.font = 'bold 48px sans-serif';
    context.fillText('கோயம்புத்தூர்  ⇄  പാലക്കാട്', 550, 58);
    context.fillStyle = '#d4f36a';
    context.font = '500 28px sans-serif';
    context.fillText('PLATFORM 1 · கோயம்புத்தூர்  →  പാലക്കാട്', 550, 125);
    context.fillText('PLATFORM 2 · പാലക്കാട്  →  கோயம்புத்தൂർ', 550, 174);
    context.fillStyle = '#d5dfcf';
    context.font = '500 27px "DM Mono", monospace';
    const service = seconds ? `NEXT TRAIN IN 00:${String(seconds).padStart(2, '0')}` : 'TRAIN DEPARTING NOW';
    context.fillText(`${service} · GAME TIMETABLE`, 550, 250);
    this.railwayStatusTexture.needsUpdate = true;
  }

  updateStreetLife(deltaTime, now) {
    if (Math.hypot(
      this.worldPosition.x - this.streetPeopleOrigin.x,
      this.worldPosition.z - this.streetPeopleOrigin.z
    ) > 150) {
      this.streetPeopleOrigin = { ...this.worldPosition };
    }
    const bus = this.cityBus;
    const busProgress = now * .00032;
    const busOffsetZ = Math.sin(busProgress) * 100;
    bus.position.set(this.streetPeopleOrigin.x - 8, .05, this.streetPeopleOrigin.z + busOffsetZ);
    bus.rotation.y = Math.cos(busProgress) < 0 ? Math.PI : 0;
    for (const person of this.streetPeople) {
      const { baseX, baseZ, phase, legs } = person.userData;
      const progress = (now * .0011 + phase) % 170;
      let sidewalkOffset = Math.sin(now * .001 + phase) * .55;
      if (this.vehicle && Math.abs(this.speed) > 2) {
        const distanceToCar = Math.hypot(person.position.x - this.worldPosition.x, person.position.z - this.worldPosition.z);
        if (distanceToCar < 13) {
          person.userData.fleeUntil = now + 1600;
          person.userData.fleeSide = Math.sign(person.position.x - this.worldPosition.x) || (baseX < 0 ? -1 : 1);
        }
      }
      if (person.userData.fleeUntil > now) sidewalkOffset += person.userData.fleeSide * 5;
      person.position.x = this.streetPeopleOrigin.x + baseX + sidewalkOffset;
      person.position.z = this.streetPeopleOrigin.z + baseZ + progress;
      person.rotation.y = progress > 85 ? Math.PI : 0;
      const stride = Math.sin(now * .009 + phase) * .38;
      legs.forEach((leg, index) => { leg.rotation.x = index ? -stride : stride; });
    }
    for (const animal of this.animals) {
      const { model, kind, baseX, baseZ, phase } = animal;
      const wander = Math.sin(now * .00045 + phase) * (kind === 'elephant' ? 1.5 : 4);
      const animalOrigin = kind === 'elephant' ? this.streetAnimalsOrigin : this.streetPeopleOrigin;
      const homeX = animalOrigin.x + baseX + wander;
      const homeZ = animalOrigin.z + baseZ + Math.cos(now * .00038 + phase) * 3;
      if (kind === 'dog' && this.vehicle && Math.abs(this.speed) > 1.5) {
        const distanceToCar = Math.hypot(model.position.x - this.worldPosition.x, model.position.z - this.worldPosition.z);
        if (distanceToCar < 24) {
          animal.fleeUntil = now + 2400;
          animal.fleeX = Math.sign(model.position.x - this.worldPosition.x) || (baseX < 0 ? -1 : 1);
          animal.fleeZ = Math.sign(model.position.z - this.worldPosition.z) || 1;
        }
      }
      if (kind === 'dog' && animal.fleeUntil > now) {
        const run = Math.min(32, (animal.fleeUntil - now) * .012);
        model.position.set(homeX + animal.fleeX * run, .02, homeZ + animal.fleeZ * run);
        model.rotation.y = Math.atan2(-animal.fleeX, animal.fleeZ);
      } else {
        model.position.set(homeX, .02, homeZ);
        model.rotation.y = Math.sin(now * .0004 + phase) * .18;
      }
    }
    for (const airport of this.landmarkModels.values()) {
      const plane = airport.userData.plane;
      if (!plane) continue;
      const flight = (now * .001 / 78 + (airport.userData.flightPhase || 0)) % 1;
      plane.position.x = -530 + flight * 1060;
      plane.position.y = 1.1 + Math.sin(flight * Math.PI) * 54;
      plane.position.z = -60;
      plane.rotation.y = -Math.PI / 2;
    }
    this.updateNpcMotorcycles(deltaTime, now);
    this.updateRailway(now);
    this.updateAudio(now);
  }

  makeOtherPlayer(player) {
    let other = this.players.get(player.id);
    if (other) return other;
    other = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(.68, 1.22, .4),
      new THREE.MeshStandardMaterial({ color: 0x71c9ee, roughness: .78 })
    );
    body.position.y = 1.18;
    body.castShadow = true;
    other.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(.24, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xc1845d, roughness: .9 })
    );
    head.position.y = 1.96;
    head.castShadow = true;
    other.add(head);
    const label = makeNameSprite(player.name, '#8bd6ff');
    label.position.y = 2.55;
    other.add(label);
    other.userData.playerName = player.name;
    this.players.set(player.id, other);
    this.scene.add(other);
    return other;
  }

  updatePlayers(players) {
    const activeIds = new Set(players.map(player => player.id));
    for (const [id, model] of this.players) {
      if (activeIds.has(id)) continue;
      this.scene.remove(model);
      model.traverse(object => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else object.material?.dispose();
      });
      this.players.delete(id);
    }
    for (const player of players) {
      const model = this.makeOtherPlayer(player);
      const position = this.localPosition(player.lat, player.lon);
      model.position.set(position.x, this.getFlyoverHeight(position.x, position.z), position.z);
      model.rotation.y = Number.isFinite(player.heading) ? -player.heading : 0;
      model.visible = !player.passenger;
    }
  }

  makeTileDecoration(tileX, tileY) {
    const keySeed = Math.imul(tileX, 73856093) ^ Math.imul(tileY, 19349663);
    const random = seededRandom(keySeed);
    const tileWidth = TILE_PIXELS * this.metersPerPixel;
    const tileCenter = this.tileWorldPosition(tileX, tileY);
    const group = new THREE.Group();
    const buildingGroups = Array.from({ length: 6 }, () => []);
    const collisionBoxes = [];
    const buildingMaterials = [
      0xc9bba3, 0xd3c5ad, 0xaea991, 0xd0ad8b, 0xa9b2a0, 0xc5b7ae
    ].map(color => {
      const facade = document.createElement('canvas');
      facade.width = 256;
      facade.height = 256;
      const context = facade.getContext('2d');
      context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      context.fillRect(0, 0, facade.width, facade.height);
      context.fillStyle = 'rgba(70, 64, 52, .22)';
      context.fillRect(0, 0, facade.width, 15);
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 5; column++) {
          const x = 16 + column * 47;
          const y = 31 + row * 53;
          context.fillStyle = '#665b49';
          context.fillRect(x - 2, y - 2, 31, 36);
          context.fillStyle = row === 0 && column % 2 ? '#b9c6b2' : '#667c79';
          context.fillRect(x, y, 27, 30);
          context.fillStyle = 'rgba(226, 219, 194, .42)';
          context.fillRect(x + 3, y + 3, 3, 24);
        }
      }
      const texture = new THREE.CanvasTexture(facade);
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: texture, roughness: .91 });
    });
    const treeMatrices = [];
    const roadsideTreeMatrices = [];
    const flowers = [];
    const minWorldX = tileCenter.x - tileWidth / 2;
    const maxWorldX = tileCenter.x + tileWidth / 2;
    const minWorldZ = tileCenter.z - tileWidth / 2;
    const maxWorldZ = tileCenter.z + tileWidth / 2;
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x383b37, roughness: .98 });
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xbab39f, roughness: 1 });
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xe1cd84, roughness: .8 });
    const verticalRoads = [];
    const horizontalRoads = [];
    const sidewalks = [];
    const laneMarks = [];
    for (let streetX = Math.ceil(minWorldX / ROAD_SPACING) * ROAD_SPACING; streetX <= maxWorldX; streetX += ROAD_SPACING) {
      verticalRoads.push({ x: streetX - tileCenter.x, z: 0, sx: 9, sz: tileWidth + 1 });
      for (const side of [-1, 1]) sidewalks.push({ x: streetX - tileCenter.x + side * 7, z: 0, sx: 4, sz: tileWidth + 1 });
      for (let z = Math.ceil(minWorldZ / 36) * 36; z <= maxWorldZ; z += 36) {
        if (Math.abs(z - Math.round(z / ROAD_SPACING) * ROAD_SPACING) < 12) continue;
        laneMarks.push({ x: streetX - tileCenter.x, z: z - tileCenter.z, sx: .2, sz: 4 });
      }
    }
    for (let streetZ = Math.ceil(minWorldZ / ROAD_SPACING) * ROAD_SPACING; streetZ <= maxWorldZ; streetZ += ROAD_SPACING) {
      horizontalRoads.push({ x: 0, z: streetZ - tileCenter.z, sx: tileWidth + 1, sz: 9 });
      for (const side of [-1, 1]) sidewalks.push({ x: 0, z: streetZ - tileCenter.z + side * 7, sx: tileWidth + 1, sz: 4 });
      for (let x = Math.ceil(minWorldX / 36) * 36; x <= maxWorldX; x += 36) {
        if (Math.abs(x - Math.round(x / ROAD_SPACING) * ROAD_SPACING) < 12) continue;
        laneMarks.push({ x: x - tileCenter.x, z: streetZ - tileCenter.z, sx: 4, sz: .2 });
      }
    }
    const makeStreetInstances = (items, material, y) => {
      if (!items.length) return null;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, items.length);
      const dummy = new THREE.Object3D();
      items.forEach((item, index) => {
        dummy.position.set(tileCenter.x + item.x, y, tileCenter.z + item.z);
        dummy.scale.set(item.sx, .16, item.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.receiveShadow = true;
      return mesh;
    };
    const roads = makeStreetInstances([...verticalRoads, ...horizontalRoads], roadMaterial, .025);
    const pavements = makeStreetInstances(sidewalks, sidewalkMaterial, .04);
    const markings = makeStreetInstances(laneMarks, lineMaterial, .12);
    if (roads) group.add(roads);
    if (pavements) group.add(pavements);
    if (markings) group.add(markings);
    for (let streetX = Math.ceil(minWorldX / ROAD_SPACING) * ROAD_SPACING; streetX <= maxWorldX; streetX += ROAD_SPACING) {
      for (const side of [-1, 1]) {
        const rowX = streetX + side * 10;
        for (let z = Math.ceil(minWorldZ / 38) * 38; z <= maxWorldZ; z += 38) {
          if (Math.abs(z - Math.round(z / ROAD_SPACING) * ROAD_SPACING) < 14) continue;
          roadsideTreeMatrices.push({ x: rowX - tileCenter.x, z: z - tileCenter.z, height: 3.1 + random() * 1.2 });
        }
      }
    }
    for (let streetZ = Math.ceil(minWorldZ / ROAD_SPACING) * ROAD_SPACING; streetZ <= maxWorldZ; streetZ += ROAD_SPACING) {
      for (const side of [-1, 1]) {
        const rowZ = streetZ + side * 10;
        for (let x = Math.ceil(minWorldX / 38) * 38; x <= maxWorldX; x += 38) {
          if (Math.abs(x - Math.round(x / ROAD_SPACING) * ROAD_SPACING) < 14) continue;
          roadsideTreeMatrices.push({ x: x - tileCenter.x, z: rowZ - tileCenter.z, height: 3.1 + random() * 1.2 });
        }
      }
    }
    roadsideTreeMatrices.forEach(tree => {
      for (let index = 0; index < 5; index++) {
        const angle = index * Math.PI * 2 / 5;
        flowers.push({
          x: tree.x + Math.cos(angle) * 1.2,
          z: tree.z + Math.sin(angle) * 1.2,
          y: .28 + (index % 2) * .15,
          color: index % 2
        });
      }
    });
    for (let index = 0; index < 26; index++) {
      const x = (random() - .5) * tileWidth * .9;
      const z = (random() - .5) * tileWidth * .9;
      const worldX = x + tileCenter.x;
      const worldZ = z + tileCenter.z;
      const distanceToRoadX = Math.abs(worldX - Math.round(worldX / ROAD_SPACING) * ROAD_SPACING);
      const distanceToRoadZ = Math.abs(worldZ - Math.round(worldZ / ROAD_SPACING) * ROAD_SPACING);
      if (Math.min(distanceToRoadX, distanceToRoadZ) < 12) continue;
      const distance = Math.hypot(worldX - this.worldPosition.x, worldZ - this.worldPosition.z);
      if (distance < 100) continue;
      const width = 8 + random() * 16;
      const depth = 8 + random() * 19;
      const height = 5 + random() ** 2 * 27;
      collisionBoxes.push({ minX: worldX - width / 2, maxX: worldX + width / 2, minZ: worldZ - depth / 2, maxZ: worldZ + depth / 2 });
      const indexGroup = Math.floor(random() * buildingGroups.length);
      buildingGroups[indexGroup].push({ x, z, width, depth, height });
      if (random() < .55) {
        for (let tree = 0; tree < 2; tree++) {
          treeMatrices.push({ x: x + (random() - .5) * (width + 6), z: z + (random() - .5) * (depth + 6), height: 1.3 + random() });
        }
      }
    }
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    for (let index = 0; index < buildingGroups.length; index++) {
      const buildings = buildingGroups[index];
      if (!buildings.length) continue;
      const mesh = new THREE.InstancedMesh(boxGeometry, buildingMaterials[index], buildings.length);
      const dummy = new THREE.Object3D();
      buildings.forEach((building, instance) => {
        dummy.position.set(
          tileCenter.x + building.x,
          building.height / 2,
          tileCenter.z + building.z
        );
        dummy.scale.set(building.width, building.height, building.depth);
        dummy.updateMatrix();
        mesh.setMatrixAt(instance, dummy.matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (treeMatrices.length) {
      const trunkGeometry = new THREE.CylinderGeometry(.18, .28, 2.15, 6);
      const crownGeometry = new THREE.ConeGeometry(1.25, 2.8, 6);
      const trunkMesh = new THREE.InstancedMesh(
        trunkGeometry,
        new THREE.MeshStandardMaterial({ color: 0x69563d, roughness: 1 }),
        treeMatrices.length
      );
      const crownMesh = new THREE.InstancedMesh(
        crownGeometry,
        new THREE.MeshStandardMaterial({ color: 0x647655, roughness: 1 }),
        treeMatrices.length
      );
      const dummy = new THREE.Object3D();
      treeMatrices.forEach((tree, index) => {
        dummy.position.set(tileCenter.x + tree.x, 1.08 * tree.height, tileCenter.z + tree.z);
        dummy.scale.setScalar(tree.height);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(index, dummy.matrix);
        dummy.position.y += 2.1 * tree.height;
        dummy.scale.setScalar(tree.height);
        dummy.updateMatrix();
        crownMesh.setMatrixAt(index, dummy.matrix);
      });
      trunkMesh.castShadow = true;
      crownMesh.castShadow = true;
      group.add(trunkMesh, crownMesh);
    }
    if (roadsideTreeMatrices.length) {
      const roadsideTrunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(.22, .38, 3.2, 7),
        new THREE.MeshStandardMaterial({ color: 0x765639, roughness: 1 }),
        roadsideTreeMatrices.length
      );
      const roadsideCanopies = new THREE.InstancedMesh(
        new THREE.SphereGeometry(2.4, 8, 7),
        new THREE.MeshStandardMaterial({ color: 0x47764a, roughness: .98 }),
        roadsideTreeMatrices.length
      );
      const dummy = new THREE.Object3D();
      roadsideTreeMatrices.forEach((tree, index) => {
        const positionX = tileCenter.x + tree.x;
        const positionZ = tileCenter.z + tree.z;
        dummy.position.set(positionX, 1.6, positionZ);
        dummy.scale.setScalar(tree.height / 3.2);
        dummy.updateMatrix();
        roadsideTrunks.setMatrixAt(index, dummy.matrix);
        dummy.position.y = tree.height + 1.9;
        dummy.scale.set(1.1, 1.25, 1.1);
        dummy.updateMatrix();
        roadsideCanopies.setMatrixAt(index, dummy.matrix);
      });
      roadsideTrunks.castShadow = true;
      roadsideCanopies.castShadow = true;
      group.add(roadsideTrunks, roadsideCanopies);
      const flowerColors = [0xed8193, 0xf4cb68];
      for (let color = 0; color < flowerColors.length; color++) {
        const coloredFlowers = flowers.filter(flower => flower.color === color);
        if (!coloredFlowers.length) continue;
        const mesh = new THREE.InstancedMesh(
          new THREE.SphereGeometry(.16, 6, 5),
          new THREE.MeshStandardMaterial({ color: flowerColors[color], roughness: .75 }),
          coloredFlowers.length
        );
        coloredFlowers.forEach((flower, index) => {
          dummy.position.set(tileCenter.x + flower.x, flower.y, tileCenter.z + flower.z);
          dummy.scale.set(1, .8, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
        });
        group.add(mesh);
      }
    }
    group.userData.collisionBoxes = collisionBoxes;
    this.scene.add(group);
    return group;
  }

  tileWorldPosition(tileX, tileY) {
    const tileSize = TILE_PIXELS * this.metersPerPixel;
    return {
      x: (tileX * TILE_PIXELS + TILE_PIXELS / 2 - this.projectedStart.x) * this.metersPerPixel,
      z: (tileY * TILE_PIXELS + TILE_PIXELS / 2 - this.projectedStart.y) * this.metersPerPixel,
      size: tileSize
    };
  }

  async loadTileTexture(tileX, tileY, key) {
    const url = `https://tile.openstreetmap.org/${TILE_ZOOM}/${tileX}/${tileY}.png`;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    try {
      const texture = await loader.loadAsync(url);
      if (this.destroyed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.textures.delete(key);
      this.textures.set(key, texture);
      while (this.textures.size > MAX_TILE_TEXTURES) {
        const oldestKey = this.textures.keys().next().value;
        const oldestTexture = this.textures.get(oldestKey);
        if (![...this.tileGroups.values()].some(item => item.textureKey === oldestKey)) {
          oldestTexture.dispose();
          this.textures.delete(oldestKey);
        } else break;
      }
      const tile = this.tileGroups.get(key);
      if (tile) {
        tile.material.map = texture;
        tile.material.needsUpdate = true;
        this.onMapTiles(this.getMapTiles());
        this.onStatus('OPENSTREETMAP CITY · THIRD-PERSON FREE ROAM');
        this.renderer.render(this.scene, this.camera);
      }
    } catch (error) {
      console.warn(`Could not load OpenStreetMap tile ${key}.`, error);
      this.onStatus('3D CITY MODE · MAP TILES UNAVAILABLE');
    }
  }

  updateTiles() {
    const centerTile = {
      x: Math.floor(this.projectedStart.x + this.worldPosition.x / this.metersPerPixel) / TILE_PIXELS,
      y: Math.floor(this.projectedStart.y + this.worldPosition.z / this.metersPerPixel) / TILE_PIXELS
    };
    centerTile.x = Math.floor(centerTile.x);
    centerTile.y = Math.floor(centerTile.y);
    if (centerTile.x === this.centerTileX && centerTile.y === this.centerTileY) return;
    this.centerTileX = centerTile.x;
    this.centerTileY = centerTile.y;
    const radius = Math.floor(VIEW_TILES / 2);
    const desired = new Set();
    const worldTiles = 2 ** TILE_ZOOM;
    for (let y = centerTile.y - radius; y <= centerTile.y + radius; y++) {
      for (let x = centerTile.x - radius; x <= centerTile.x + radius; x++) {
        const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;
        const key = `${TILE_ZOOM}/${wrappedX}/${y}`;
        desired.add(key);
        if (!this.tileGroups.has(key)) {
          const tilePosition = this.tileWorldPosition(x, y);
          const material = new THREE.MeshStandardMaterial({
            color: 0xd4d7c8,
            roughness: 1,
            metalness: 0
          });
          const terrain = new THREE.Mesh(new THREE.PlaneGeometry(tilePosition.size, tilePosition.size), material);
          terrain.rotation.x = -Math.PI / 2;
          terrain.position.set(tilePosition.x, -.05, tilePosition.z);
          terrain.receiveShadow = true;
          this.scene.add(terrain);
          const decorations = this.makeTileDecoration(x, y);
          this.tileGroups.set(key, {
            terrain,
            material,
            decorations,
            colliders: decorations.userData.collisionBoxes,
            textureKey: key
          });
          const existing = this.textures.get(key);
          if (existing) material.map = existing;
          else void this.loadTileTexture(wrappedX, y, key);
        }
      }
    }
    for (const [key, tile] of this.tileGroups) {
      if (desired.has(key)) continue;
      this.scene.remove(tile.terrain, tile.decorations);
      tile.terrain.geometry.dispose();
      tile.material.dispose();
      const geometries = new Set();
      const materials = new Set();
      tile.decorations.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
        else if (object.material) materials.add(object.material);
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => {
        material.map?.dispose();
        material.dispose();
      });
      this.tileGroups.delete(key);
    }
    this.onMapTiles(this.getMapTiles());
    this.onStatus('THIRD-PERSON CITY · LOADING NEIGHBOURHOOD');
    this.refreshNearbyLandmarks();
  }

  getMapTiles() {
    return [...this.tileGroups.values()].flatMap(tile => {
      const image = tile.material.map?.image;
      if (!image || !image.width || !image.height) return [];
      return [{
        image,
        x: tile.terrain.position.x,
        z: tile.terrain.position.z,
        size: tile.terrain.geometry.parameters.width
      }];
    });
  }

  onKeyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ', 'e'].includes(key)) {
      event.preventDefault();
      this.startAudio();
      this.keys.add(key);
      if (key === 'e' && !event.repeat && !this.isPassenger) this.toggleVehicle();
      if (key === ' ' && !event.repeat && !this.vehicle && this.playerHeight === 0) {
        this.jumpVelocity = 5.2;
        this.playAudioTone(420, .16, .035, 'sine');
      }
      if (key === 's' && !event.repeat && this.vehicle && this.speed > 2) {
        this.playAudioTone(190, .28, .025, 'sawtooth');
      }
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.key.toLowerCase());
  }

  setPlayer(player) {
    const position = this.localPosition(player.lat, player.lon);
    const model = this.makeOtherPlayer(player);
    model.position.set(position.x, this.getFlyoverHeight(position.x, position.z), position.z);
    model.rotation.y = Number.isFinite(player.heading) ? -player.heading : 0;
    model.visible = !player.passenger;
  }

  setTarget(place) {
    this.target = place;
  }

  makePlaceLandmark(place) {
    const building = new THREE.Group();
    building.name = `Destination landmark · ${place.name}`;
    const colors = {
      COLLEGE: 0xd9cfb7,
      CAMPUS: 0xd9cfb7,
      TEMPLE: 0xd98552,
      SHOPPING: 0xd9c7a4,
      TRANSIT: 0x347768,
      RAILWAY: 0xe5dcc5,
      BRIDGE: 0x777b77,
      NATURE: 0x497a56,
      HOSPITAL: 0xe8e8df,
      SPORTS: 0xb6ab93,
      MARKET: 0xb77a45,
      NEIGHBOURHOOD: 0xcbbba0,
      AIRPORT: 0xc6c9c4,
      MUSEUM: 0xd2b895,
      VENUE: 0xcbbfa7,
      PARK: 0x71905c,
      LANDMARK: 0xc5bba5
    };
    const wallMaterial = new THREE.MeshStandardMaterial({ color: colors[place.type] || 0xcbbba0, roughness: .88 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x756850, roughness: .84 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x73918b, roughness: .32, metalness: .08 });
    const runwayPaintMaterial = new THREE.MeshStandardMaterial({ color: 0xf0eee0, roughness: .9 });
    const signColor = place.type === 'TEMPLE' ? '#ffe2a4' : '#e5efce';
    const addBox = (width, height, depth, x, y, z, material = wallMaterial) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      building.add(mesh);
      return mesh;
    };
    let signHeight = 7;
    if (place.name === 'Coimbatore Mani Koondu') {
      const clockMaterial = new THREE.MeshStandardMaterial({ color: 0xf2e7cb, roughness: .72 });
      const handMaterial = new THREE.MeshStandardMaterial({ color: 0x29291f, roughness: .65 });
      addBox(18, .6, 18, 0, .3, 0, roofMaterial);
      addBox(11, 15, 11, 0, 8, 0);
      addBox(15, 2, 15, 0, 16.5, 0, roofMaterial);
      addBox(8, 3, 8, 0, 19, 0);
      const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, .3, 32), clockMaterial);
      clockFace.rotation.x = Math.PI / 2;
      clockFace.position.set(0, 19, -4.2);
      building.add(clockFace);
      const minuteHand = addBox(.16, 1.8, .18, 0, 19.8, -4.42, handMaterial);
      minuteHand.rotation.z = -.25;
      const hourHand = addBox(1.3, .16, .18, -.45, 19, -4.43, handMaterial);
      hourHand.rotation.z = -.35;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(6, 7, 4), roofMaterial);
      cap.position.set(0, 24, 0);
      cap.rotation.y = Math.PI / 4;
      building.add(cap);
      signHeight = 32;
    } else if (place.name === 'Isha Yoga Center') {
      const statueMaterial = new THREE.MeshStandardMaterial({ color: 0x222827, roughness: .42, metalness: .18 });
      const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xd3ad58, roughness: .6, metalness: .15 });
      addBox(38, .8, 34, 0, .4, 0, roofMaterial);
      addBox(25, 1.2, 21, 0, 1.4, 1, goldMaterial);
      addBox(19, 8, 16, 0, 5.8, 2, wallMaterial);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), roofMaterial);
      dome.position.set(0, 10, 1);
      building.add(dome);
      const head = new THREE.Mesh(new THREE.SphereGeometry(7.4, 24, 18), statueMaterial);
      head.position.set(0, 15, -13);
      head.scale.set(1.12, 1.15, .83);
      building.add(head);
      const forehead = new THREE.Mesh(new THREE.SphereGeometry(4.6, 20, 14), statueMaterial);
      forehead.position.set(0, 11.4, -12.7);
      forehead.scale.set(1.2, .7, .78);
      building.add(forehead);
      for (let curl = 0; curl < 7; curl++) {
        const angle = Math.PI * (curl + 1) / 8;
        const knot = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), statueMaterial);
        knot.position.set(Math.cos(angle) * 5.1, 19.2 + Math.sin(angle) * 1.2, -12.8);
        building.add(knot);
      }
      const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xb9a477, roughness: .5 });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(.34, 8, 6), eyeMaterial);
        eye.position.set(side * 1.6, 15.3, -18.7);
        building.add(eye);
      }
      addBox(1.2, 3.2, .7, 0, 13.4, -18.2, statueMaterial);
      signHeight = 26;
    } else if (place.type === 'TEMPLE') {
      addBox(18, .5, 16, 0, .25, 1);
      addBox(13, 5, 12, 0, 2.8, 3);
      addBox(15, .8, 3, 0, 5.4, -4.5, roofMaterial);
      for (let tier = 0; tier < 5; tier++) {
        const width = 11 - tier * 1.55;
        const height = .75 - tier * .06;
        addBox(width, height, 1.2, 0, 6 + tier * .66, -5.2, tier % 2 ? wallMaterial : roofMaterial);
      }
      addBox(3, 3.7, .45, 0, 2, -5.5, roofMaterial);
      signHeight = 10.2;
    } else if (place.type === 'AIRPORT') {
      const tarmac = new THREE.Mesh(
        new THREE.BoxGeometry(1500, .12, 900),
        new THREE.MeshStandardMaterial({ color: 0x9c9f92, roughness: .96 })
      );
      tarmac.position.set(0, -.015, 0);
      tarmac.receiveShadow = true;
      building.add(tarmac);
      addBox(1450, .16, 54, 0, .12, -60, new THREE.MeshStandardMaterial({ color: 0x343936, roughness: .98 }));
      addBox(1380, .035, .5, 0, .22, -60, runwayPaintMaterial);
      for (let mark = -650; mark <= 650; mark += 70) {
        addBox(28, .04, .65, mark, .23, -60, runwayPaintMaterial);
      }
      for (const end of [-1, 1]) {
        for (let strip = -4; strip <= 4; strip++) {
          addBox(3.2, .045, 22, end * 660, .23, -60 + strip * 3.5, runwayPaintMaterial);
        }
      }
      addBox(260, 18, 48, 0, 9, 125, wallMaterial);
      addBox(280, 2, 55, 0, 19, 125, roofMaterial);
      for (let window = -110; window <= 110; window += 22) {
        addBox(14, 6, .2, window, 10, 100.8, glassMaterial);
      }
      addBox(22, 38, 20, -175, 19, 125, roofMaterial);
      addBox(18, 5, 12, 105, 22, 125, wallMaterial);
      for (const x of [-310, 310]) {
        addBox(110, 1.2, 82, x, .6, 125, roofMaterial);
        addBox(92, .4, 2, x, 1.5, 125, runwayPaintMaterial);
      }
      const plane = this.makeAirportPlane();
      plane.position.set(-510, 1.1, -60);
      building.add(plane);
      building.userData.plane = plane;
      signHeight = 29;
    } else if (place.type === 'COLLEGE' || place.type === 'CAMPUS' || place.type === 'HOSPITAL' || place.type === 'MUSEUM' || place.type === 'VENUE') {
      const floors = place.type === 'HOSPITAL' ? 5 : 4;
      const height = floors * 3.4;
      addBox(26, height, 18, 0, height / 2, 0);
      addBox(29, .65, 20, 0, height + .35, 0, roofMaterial);
      for (let floor = 0; floor < floors; floor++) {
        for (let column = 0; column < 5; column++) {
          addBox(2.25, 1.55, .12, -10 + column * 5, 2.15 + floor * 3.4, -9.1, glassMaterial);
        }
      }
      addBox(10, 3.4, 1, 0, 1.7, -12, roofMaterial);
      signHeight = height + 4;
      if (place.type === 'COLLEGE' || place.type === 'CAMPUS') {
        for (const x of [-17, 17]) addBox(.7, 5, .7, x, 2.5, -12, roofMaterial);
        addBox(35, .6, .8, 0, 5, -12, roofMaterial);
      }
    } else if (place.type === 'SHOPPING' || place.type === 'NEIGHBOURHOOD') {
      const floors = place.type === 'SHOPPING' ? 5 : 2;
      const height = floors * 3.1;
      addBox(18, height, 15, 0, height / 2, 0);
      addBox(19, .6, 16, 0, height + .3, 0, roofMaterial);
      for (let floor = 0; floor < floors; floor++) {
        for (let column = 0; column < 4; column++) {
          addBox(3, 1.7, .12, -6.5 + column * 4.3, 1.9 + floor * 3.1, -7.6, glassMaterial);
        }
        addBox(18, .45, .75, 0, .3 + floor * 3.1, -8.1, roofMaterial);
      }
      signHeight = height + 3;
    } else if (place.type === 'TRANSIT' || place.type === 'RAILWAY') {
      addBox(29, .6, 20, 0, .3, 0, roofMaterial);
      addBox(27, .45, 19, 0, 5.1, 0, roofMaterial);
      for (const x of [-12, -4, 4, 12]) addBox(.65, 4.8, .65, x, 2.5, 0, wallMaterial);
      if (place.type === 'RAILWAY') {
        for (const x of [-4.5, 4.5]) addBox(100, .15, .18, 0, .12, x, roofMaterial);
        signHeight = 8;
      }
    } else if (place.type === 'BRIDGE') {
      addBox(64, .8, 13, 0, 5, 0, roofMaterial);
      for (const x of [-27, -9, 9, 27]) addBox(2, 5, 10, x, 2.4, 0, wallMaterial);
      for (const side of [-1, 1]) addBox(64, .55, .5, 0, 5.75, side * 6.2, wallMaterial);
      signHeight = 9;
    } else if (place.type === 'NATURE' || place.type === 'PARK') {
      const lawn = new THREE.Mesh(
        new THREE.CylinderGeometry(18, 18, .35, 20),
        new THREE.MeshStandardMaterial({ color: place.name.toLowerCase().includes('lake') ? 0x4f898c : 0x668354, roughness: .72 })
      );
      lawn.position.y = .18;
      building.add(lawn);
      if (!place.name.toLowerCase().includes('lake')) {
        for (const [x, z] of [[-8, -6], [-5, 7], [6, -8], [9, 5]]) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, 3.2, 7), roofMaterial);
          trunk.position.set(x, 1.8, z);
          building.add(trunk);
          const crown = new THREE.Mesh(new THREE.SphereGeometry(2.5, 9, 8), wallMaterial);
          crown.position.set(x, 4.3, z);
          building.add(crown);
        }
      }
      signHeight = 7;
    } else if (place.type === 'MARKET') {
      for (let index = 0; index < 4; index++) {
        const x = -9 + index * 6;
        addBox(5, 2.7, 6, x, 1.35, 0, index % 2 ? wallMaterial : roofMaterial);
        addBox(5.6, .4, 6.4, x, 3, 0, roofMaterial);
        addBox(5, .8, .35, x, 1.5, -3.1, glassMaterial);
      }
    } else {
      addBox(19, 5, 16, 0, 2.5, 0);
      addBox(20, .6, 17, 0, 5.3, 0, roofMaterial);
    }
    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(34, .35, 28),
      new THREE.MeshStandardMaterial({ color: 0xb6ad98, roughness: 1 })
    );
    foundation.position.y = -.1;
    foundation.receiveShadow = true;
    building.add(foundation);
    const label = makeNameSprite(place.name, signColor, 640);
    label.scale.set(Math.min(20, Math.max(9, place.name.length * .34)), 2, 1);
    label.position.set(0, signHeight, 0);
    building.add(label);
    const position = this.localPosition(place.lat, place.lon);
    building.position.set(position.x, 0, position.z);
    building.userData.place = place;
    if (place.type === 'AIRPORT') {
      building.userData.collisionBoxes = [
        { minX: position.x - 130, maxX: position.x + 130, minZ: position.z + 100, maxZ: position.z + 150 },
        { minX: position.x - 190, maxX: position.x - 160, minZ: position.z + 105, maxZ: position.z + 145 }
      ];
    } else if (!['NATURE', 'PARK', 'BRIDGE'].includes(place.type)) {
      const width = place.type === 'TEMPLE' ? 18 : place.name === 'Coimbatore Mani Koondu' ? 18 : 24;
      const depth = place.type === 'TEMPLE' ? 18 : place.name === 'Coimbatore Mani Koondu' ? 18 : 20;
      building.userData.collisionBoxes = [
        { minX: position.x - width / 2, maxX: position.x + width / 2, minZ: position.z - depth / 2, maxZ: position.z + depth / 2 }
      ];
    } else {
      building.userData.collisionBoxes = [];
    }
    return building;
  }

  makeAirportPlane() {
    const plane = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e8df, roughness: .5, metalness: .15 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xd57442, roughness: .55, metalness: .12 });
    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x415a60, roughness: .32, metalness: .2 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, 25, 12), bodyMaterial);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.castShadow = true;
    plane.add(fuselage);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.05, 5, 12), bodyMaterial);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -14.5;
    plane.add(nose);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(9, .4, 3.8), accentMaterial);
    tail.position.z = 12;
    plane.add(tail);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(39, .42, 5.8), bodyMaterial);
    wings.castShadow = true;
    plane.add(wings);
    const rearWings = new THREE.Mesh(new THREE.BoxGeometry(15, .32, 2.8), accentMaterial);
    rearWings.position.set(0, .55, 10);
    plane.add(rearWings);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.55, 5.5, 3.8), accentMaterial);
    fin.position.set(0, 3, 11.2);
    plane.add(fin);
    for (const side of [-1, 1]) {
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(.72, .72, 4.4, 10), windowMaterial);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 10.5, -.45, 1.1);
      plane.add(engine);
      const window = new THREE.Mesh(new THREE.BoxGeometry(.42, .3, 16), windowMaterial);
      window.position.set(side * .82, .72, -1.5);
      plane.add(window);
    }
    plane.rotation.y = Math.PI / 2;
    plane.scale.setScalar(1.5);
    plane.name = 'Coimbatore airport passenger airplane';
    return plane;
  }

  refreshNearbyLandmarks() {
    const nearby = new Set();
    for (const place of this.places) {
      const position = this.localPosition(place.lat, place.lon);
      const distance = Math.hypot(position.x - this.worldPosition.x, position.z - this.worldPosition.z);
      if (distance > 680) continue;
      nearby.add(place.name);
      if (this.landmarkModels.has(place.name)) continue;
      const model = this.makePlaceLandmark(place);
      this.landmarkModels.set(place.name, model);
      this.scene.add(model);
    }
    for (const [name, model] of this.landmarkModels) {
      if (nearby.has(name)) continue;
      this.scene.remove(model);
      model.traverse(object => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
        else if (object.material) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      this.landmarkModels.delete(name);
    }
  }

  setZoom(change) {
    this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + change, 5.5, 22);
  }

  setPosition(position) {
    this.isPassenger = false;
    this.position = { ...position };
    this.worldPosition = this.localPosition(position.lat, position.lon);
    this.player.position.x = this.worldPosition.x;
    this.player.position.z = this.worldPosition.z;
    this.player.position.y = this.getFlyoverHeight(this.worldPosition.x, this.worldPosition.z) + this.playerHeight;
    this.player.rotation.y = -this.heading;
    this.updateTiles();
    this.onPosition(this.position, { heading: this.heading, vehicle: this.vehicle, speed: this.speed });
  }

  setPassengerMode(driver) {
    if (!driver) {
      this.isPassenger = false;
      this.vehicle = false;
      this.speed = 0;
      this.player.visible = true;
      return;
    }
    this.isPassenger = true;
    this.vehicle = true;
    this.player.visible = false;
    this.setPassengerPosition(driver);
  }

  setPassengerPosition(driver) {
    if (!this.isPassenger || !Number.isFinite(driver?.lat) || !Number.isFinite(driver?.lon)) return;
    this.position = { lat: driver.lat, lon: driver.lon };
    this.heading = Number.isFinite(driver.heading) ? driver.heading : this.heading;
    this.speed = Number.isFinite(driver.speed) ? driver.speed : 0;
    this.worldPosition = this.localPosition(driver.lat, driver.lon);
    const roadHeight = this.getFlyoverHeight(this.worldPosition.x, this.worldPosition.z);
    this.car.position.set(this.worldPosition.x, roadHeight, this.worldPosition.z);
    this.car.rotation.y = -this.heading;
    this.updateTiles();
  }

  canOccupy(x, z, radius) {
    const blocked = box => {
      const closestX = THREE.MathUtils.clamp(x, box.minX, box.maxX);
      const closestZ = THREE.MathUtils.clamp(z, box.minZ, box.maxZ);
      return Math.hypot(x - closestX, z - closestZ) < radius;
    };
    for (const tile of this.tileGroups.values()) {
      const tileSize = tile.terrain.geometry.parameters.width;
      if (Math.abs(tile.terrain.position.x - x) > tileSize / 2 + 24
        || Math.abs(tile.terrain.position.z - z) > tileSize / 2 + 24) continue;
      if (tile.colliders.some(blocked)) return false;
    }
    for (const model of this.landmarkModels.values()) {
      if (model.userData.collisionBoxes?.some(blocked)) return false;
    }
    return true;
  }

  reset() {
    this.heading = 0;
    this.speed = 0;
    this.vehicle = false;
    this.player.visible = true;
    this.car.position.copy(this.parkedCarPosition);
    this.setPosition(PLAYER_START);
  }

  toggleVehicle() {
    if (this.isPassenger) return;
    if (this.vehicle) {
      const exitX = this.car.position.x + Math.cos(this.heading) * 2.4;
      const exitZ = this.car.position.z + Math.sin(this.heading) * 2.4;
      this.worldPosition = { x: exitX, z: exitZ };
      this.position = this.geoPosition(exitX, exitZ);
      this.player.position.set(exitX, this.getFlyoverHeight(exitX, exitZ), exitZ);
      this.player.visible = true;
      this.vehicle = false;
      this.speed = 0;
      this.onPosition(this.position, { heading: this.heading, vehicle: false, speed: 0 });
      this.onStatus('ON FOOT · PRESS E NEAR YOUR CAR TO DRIVE');
      this.onMode(false, 0);
      return;
    }
    const distance = Math.hypot(
      this.car.position.x - this.worldPosition.x,
      this.car.position.z - this.worldPosition.z
    );
    if (distance > 16) {
      this.onStatus('YOUR CAR IS NEAR GANDHIPURAM · PRESS ⌖ TO RETURN');
      return;
    }
    this.vehicle = true;
    this.heading = -this.car.rotation.y;
    this.player.visible = false;
    this.speed = 0;
    this.onStatus('DRIVING · SHIFT TO ACCELERATE');
    this.onMode(true, 0);
  }

  updateMovement(deltaTime) {
    if (this.isPassenger) return;
    if (![this.heading, this.worldPosition.x, this.worldPosition.z, this.speed].every(Number.isFinite)) {
      console.error('Player position became invalid; restoring the last known Coimbatore location.');
      this.heading = 0;
      this.speed = 0;
      this.worldPosition = this.localPosition(this.position.lat, this.position.lon);
    }
    const forward = this.keys.has('w') || this.keys.has('arrowup') || this.keys.has('forward');
    const backward = this.keys.has('s') || this.keys.has('arrowdown') || this.keys.has('backward');
    const left = this.keys.has('a') || this.keys.has('arrowleft') || this.keys.has('left');
    const right = this.keys.has('d') || this.keys.has('arrowright') || this.keys.has('right');
    const turn = Number(right) - Number(left);
    const move = Number(forward) - Number(backward);
    const sprint = this.keys.has('shift');
    const previousSpeed = this.speed;
    if (this.vehicle) {
      const forwardMax = sprint ? 24 : 16;
      if (move > 0) {
        this.speed = this.speed < 0
          ? Math.min(0, this.speed + 10 * deltaTime)
          : Math.min(forwardMax, this.speed + 6.5 * deltaTime);
      } else if (move < 0) {
        this.speed = this.speed > 0
          ? Math.max(0, this.speed - 13 * deltaTime)
          : Math.max(-5.5, this.speed - 4 * deltaTime);
      } else {
        this.speed *= Math.exp(-.72 * deltaTime);
      }
      const steeringGrip = .15 + Math.min(Math.abs(this.speed) / 12, 1) * 1.05;
      const travelDirection = this.speed < -.1 ? -1 : 1;
      this.heading += turn * steeringGrip * travelDirection * deltaTime;
      this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    } else {
      const walkingSpeed = sprint ? 7.6 : 4.2;
      const targetSpeed = move * walkingSpeed;
      const acceleration = Math.abs(targetSpeed) > Math.abs(this.speed) ? 18 : 24;
      if (Math.abs(this.speed - targetSpeed) <= acceleration * deltaTime) this.speed = targetSpeed;
      else this.speed += Math.sign(targetSpeed - this.speed) * acceleration * deltaTime;
      this.heading += turn * 2.35 * deltaTime;
      this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    }
    const nextX = THREE.MathUtils.clamp(this.worldPosition.x + Math.sin(this.heading) * this.speed * deltaTime, -25000, 25000);
    const nextZ = THREE.MathUtils.clamp(this.worldPosition.z - Math.cos(this.heading) * this.speed * deltaTime, -25000, 25000);
    const radius = this.vehicle ? 1.65 : .58;
    if (this.canOccupy(nextX, nextZ, radius)) {
      this.worldPosition.x = nextX;
      this.worldPosition.z = nextZ;
    } else if (this.canOccupy(nextX, this.worldPosition.z, radius)) {
      this.worldPosition.x = nextX;
      this.speed *= .55;
    } else if (this.canOccupy(this.worldPosition.x, nextZ, radius)) {
      this.worldPosition.z = nextZ;
      this.speed *= .55;
    } else {
      this.speed = 0;
    }
    if (!this.vehicle) {
      if (this.keys.has(' ') && this.playerHeight === 0) this.jumpVelocity = 5.2;
      this.jumpVelocity -= 15 * deltaTime;
      this.playerHeight = Math.max(0, this.playerHeight + this.jumpVelocity * deltaTime);
      if (this.playerHeight === 0) this.jumpVelocity = 0;
    }
    const roadHeight = this.getFlyoverHeight(this.worldPosition.x, this.worldPosition.z);
    this.player.rotation.y = -this.heading;
    this.player.position.set(this.worldPosition.x, roadHeight + this.playerHeight, this.worldPosition.z);
    const walking = Math.abs(this.speed) > .1 && !this.vehicle;
    if (walking && this.audioContext && performance.now() >= this.nextFootstepAt) {
      this.playFootstep(sprint ? .034 : .022);
      this.nextFootstepAt = performance.now() + (sprint ? 285 : 410);
    }
    const stride = walking ? Math.sin(performance.now() * .013 * (sprint ? 1.35 : 1)) * .53 : 0;
    this.legs.forEach((leg, index) => { leg.rotation.x = index ? -stride : stride; });
    this.arms.forEach((arm, index) => {
      arm.rotation.x = walking ? (index ? stride * .58 : -stride * .58) : (sprint ? -.17 : 0);
    });
    if (this.vehicle) {
      this.car.position.set(this.worldPosition.x, roadHeight, this.worldPosition.z);
      this.car.rotation.y = -this.heading;
      for (const wheel of this.wheels) wheel.rotation.x += this.speed * deltaTime * 1.5;
      this.wheels[0].rotation.y = -turn * .38;
      this.wheels[2].rotation.y = -turn * .38;
    }
    this.position = this.geoPosition(this.worldPosition.x, this.worldPosition.z);
    if (!Number.isFinite(this.position.lat) || !Number.isFinite(this.position.lon)) {
      console.error('Player coordinates became invalid; keeping the last valid location.');
      this.position = { lat: MAP_START.lat, lon: MAP_START.lon };
      this.worldPosition = this.localPosition(this.position.lat, this.position.lon);
      this.player.position.set(
        this.worldPosition.x,
        this.getFlyoverHeight(this.worldPosition.x, this.worldPosition.z) + this.playerHeight,
        this.worldPosition.z
      );
      return;
    }
    this.updateTiles();
    this.onPosition(this.position, { heading: this.heading, vehicle: this.vehicle, speed: this.speed });
    this.onMode(this.vehicle, this.speed);
  }

  updateCamera(deltaTime) {
    const target = this.vehicle ? this.car : this.player;
    const distance = this.vehicle ? this.cameraDistance + 3 : this.cameraDistance;
    const height = this.vehicle ? 5.1 : 4.45;
    const desiredPosition = new THREE.Vector3(
      target.position.x - Math.sin(this.heading) * distance,
      target.position.y + height,
      target.position.z + Math.cos(this.heading) * distance
    );
    this.camera.position.lerp(desiredPosition, 1 - Math.exp(-5 * deltaTime));
    if (!this.cameraReady) {
      this.camera.position.copy(desiredPosition);
      this.cameraReady = true;
    }
    this.camera.lookAt(
      target.position.x + Math.sin(this.heading) * 4.5,
      target.position.y + (this.vehicle ? 1.2 : 1.4),
      target.position.z - Math.cos(this.heading) * 4.5
    );
    this.sun.position.set(target.position.x - 110, 190, target.position.z + 90);
    this.sun.target.position.copy(target.position);
    if (this.target) {
      const targetPos = this.localPosition(this.target.lat, this.target.lon);
      const near = Math.hypot(targetPos.x - this.worldPosition.x, targetPos.z - this.worldPosition.z) < 90;
      this.targetMarker.visible = near;
      this.targetMarker.position.set(targetPos.x, 1, targetPos.z);
    } else if (this.targetMarker) {
      this.targetMarker.visible = false;
    }
  }

  makeTargetMarker() {
    this.targetMarker = new THREE.Group();
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(.35, .7, 2.6, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xd4f36a, transparent: true, opacity: .55, side: THREE.DoubleSide })
    );
    beacon.position.y = 1.3;
    this.targetMarker.add(beacon);
    this.targetMarker.add(makeNameSprite('DESTINATION', '#d4f36a', 300));
    this.targetMarker.children[1].position.y = 3;
    this.scene.add(this.targetMarker);
  }

  resize() {
    const { width, height } = this.canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
  }

  animate = () => {
    const now = performance.now();
    const elapsed = (now - this.lastFrame) / 1000;
    const deltaTime = Number.isFinite(elapsed) && elapsed > 0
      ? THREE.MathUtils.clamp(elapsed, 0, .045)
      : 1 / 60;
    this.lastFrame = now;
    const bounds = this.canvas.parentElement.getBoundingClientRect();
    const expectedWidth = Math.round(bounds.width * this.renderer.getPixelRatio());
    const expectedHeight = Math.round(bounds.height * this.renderer.getPixelRatio());
    if (expectedWidth > 0 && (this.canvas.width !== expectedWidth || this.canvas.height !== expectedHeight)) {
      this.resize();
    }
    if (now - (this.lastPlaceRefresh || 0) > 700) {
      this.lastPlaceRefresh = now;
      this.refreshNearbyLandmarks();
    }
    this.updateMovement(deltaTime);
    this.updateStreetLife(deltaTime, now);
    this.updateCamera(deltaTime);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.animate);
  };

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.clearKeys);
    for (const button of this.touchButtons) {
      button.removeEventListener('pointerdown', this.touchDownHandlers.get(button));
      button.removeEventListener('pointerup', this.touchRelease);
      button.removeEventListener('pointercancel', this.touchRelease);
      button.removeEventListener('lostpointercapture', this.touchRelease);
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.renderer.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
    });
  }
}

export function createCityWorld(options) {
  return new CityWorld(options);
}

import { createCityWorld } from './city-world.js?v=23';
import { CITY_ORIGIN, PLAYER_START } from './map-config.js';

const authScreen = document.querySelector('#auth-screen');
const gameScreen = document.querySelector('#game-screen');
const authContent = document.querySelector('#auth-content');
const authStatus = document.querySelector('#auth-status');
const canvas = document.querySelector('#game-map');
const tileStatus = document.querySelector('#tile-status');
const placeList = document.querySelector('#places-list');
const destinationCard = document.querySelector('#destination-card');
const destinationName = document.querySelector('#destination-name');
const destinationDistance = document.querySelector('#destination-distance');
const mapCoords = document.querySelector('#map-coords');
const currentArea = document.querySelector('#current-area');
const miniMap = document.querySelector('#city-minimap');
const miniMapContext = miniMap.getContext('2d');
const miniMapHeading = document.querySelector('#mini-map-heading');
const miniMapTargetKey = document.querySelector('#mini-map-target-key');
const miniMapPlace = document.querySelector('#mini-map-place');
const miniMapOnline = document.querySelector('#mini-map-online');
const miniMapPlayerCount = document.querySelector('#mini-map-player-count');
const playerActions = document.querySelector('#player-actions');
const nearbyPlayerName = document.querySelector('#nearby-player-name');
const playerActionStatus = document.querySelector('#player-action-status');
const talkPlayerButton = document.querySelector('#talk-player');
const ridePlayerButton = document.querySelector('#ride-player');
const acceptPlayerButton = document.querySelector('#accept-player');
const rejectPlayerButton = document.querySelector('#reject-player');
const voiceControls = document.querySelector('#voice-controls');
const voiceStatus = document.querySelector('#voice-status');
const voiceAudio = document.querySelector('#voice-audio');
const dayCycleButton = document.querySelector('#day-cycle');
const rainToggleButton = document.querySelector('#rain-toggle');
const passengerControls = document.querySelector('#passenger-controls');
const passengerLabel = document.querySelector('#passenger-label');
const cityWorld = { current: null };
const camera = { ...PLAYER_START };
const otherPlayers = new Map();
let miniMapUpdatedAt = 0;
let playerHeading = 0;
let mapTiles = [];
let playerMotion = { heading: 0, vehicle: false, speed: 0 };
let nearbyPlayer = null;
let pendingInteraction = null;
let voicePeerId = null;
let voiceConnection = null;
let localVoiceStream = null;
let pendingIceCandidates = [];
let voiceIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
let voiceRestartAttempted = false;
let isPassenger = false;
let rideDriverId = null;
let voiceInviteTimer = null;
let voiceInviteTargetId = null;
const dayPresets = [
  { id: 'auto', label: 'தானியங்கு', hour: null },
  { id: 'morning', label: 'காலை', hour: 8 },
  { id: 'noon', label: 'நண்பகல்', hour: 12 },
  { id: 'evening', label: 'மாலை', hour: 17.5 },
  { id: 'night', label: 'இரவு', hour: 21 }
];
const savedDayPreset = localStorage.getItem('kovai-day-preset');
let dayPresetIndex = Math.max(0, dayPresets.findIndex(preset => preset.id === savedDayPreset));
let isRaining = localStorage.getItem('kovai-rain-mode') === 'true';

const places = [
  { name: 'Gandhipuram Bus Stand', type: 'TRANSIT', lat: 11.0162570, lon: 76.9693485 },
  { name: 'Brookefields Mall', type: 'SHOPPING', lat: 11.0036, lon: 76.9667 },
  { name: 'Coimbatore Junction Railway Station', type: 'RAILWAY', lat: 10.9975682, lon: 76.9663657 },
  { name: 'Race Course', type: 'LANDMARK', lat: 11.0056, lon: 76.9741 },
  { name: 'RS Puram', type: 'NEIGHBOURHOOD', lat: 11.0096, lon: 76.9487 },
  { name: 'Ukkadam Bus Stand', type: 'TRANSIT', lat: 10.9883471, lon: 76.9618799 },
  { name: 'Perur Pateeswarar Temple', type: 'TEMPLE', lat: 10.9705, lon: 76.9127 },
  { name: 'VOC Park & Zoo', type: 'PARK', lat: 11.0047, lon: 76.9661 },
  { name: 'TNAU', type: 'CAMPUS', lat: 11.0127, lon: 76.9354 },
  { name: 'Marudhamalai Temple', type: 'TEMPLE', lat: 11.0463, lon: 76.8595 },
  { name: 'Coimbatore Airport', type: 'AIRPORT', lat: 11.0300, lon: 77.0434 },
  { name: 'Singanallur Lake', type: 'NATURE', lat: 10.9943, lon: 77.0269 },
  { name: 'Kovai Kondattam', type: 'RECREATION', lat: 10.9907, lon: 76.8665 },
  { name: 'Gass Forest Museum', type: 'MUSEUM', lat: 11.0110, lon: 76.9440 },
  { name: 'Eachanari Vinayagar Temple', type: 'TEMPLE', lat: 10.9362, lon: 76.9648 },
  { name: 'Prozone Mall', type: 'SHOPPING', lat: 11.0520, lon: 76.9949 },
  { name: 'Codissia Trade Fair', type: 'VENUE', lat: 11.0336, lon: 77.0267 },
  { name: 'Vellalore Lake', type: 'NATURE', lat: 10.9638, lon: 77.0114 },
  { name: 'Isha Yoga Center', type: 'LANDMARK', lat: 10.9794, lon: 76.7366 },
  { name: 'Siruvani Viewpoint', type: 'NATURE', lat: 10.9900, lon: 76.7300 },
  { name: 'Rathinam Technical Campus, Eachanari', type: 'COLLEGE', lat: 10.9329868, lon: 76.9769453 },
  { name: 'Sri Krishna College, Kovaipudur', type: 'COLLEGE', lat: 10.9371249, lon: 76.9564045 },
  { name: 'Saaji Dress Shop, Kuniyamuthur', type: 'SHOPPING', lat: 10.9560206, lon: 76.9540742 },
  { name: 'Ukkadam Aathupalam Bridge', type: 'BRIDGE', lat: 10.9808, lon: 76.9583 },
  { name: 'Koniamman Temple', type: 'TEMPLE', lat: 10.9936861, lon: 76.9637249 },
  { name: 'Pothys, Town Hall', type: 'SHOPPING', lat: 10.9937012, lon: 76.9598308 },
  { name: 'The Chennai Silks, Five Corners', type: 'SHOPPING', lat: 10.9963631, lon: 76.9602814 },
  { name: 'Town Hall', type: 'NEIGHBOURHOOD', lat: 10.9967718, lon: 76.9556171 },
  { name: 'Ukkadam Lake', type: 'NATURE', lat: 10.9834540, lon: 76.9553928 },
  { name: 'Podanur Junction', type: 'RAILWAY', lat: 10.9640914, lon: 76.9886998 },
  { name: 'Saibaba Colony', type: 'NEIGHBOURHOOD', lat: 11.0243340, lon: 76.9447875 },
  { name: 'PSG College of Technology', type: 'COLLEGE', lat: 11.0246833, lon: 77.0028425 },
  { name: 'Kovaipudur', type: 'NEIGHBOURHOOD', lat: 10.9454149, lon: 76.9392603 },
  { name: 'Peelamedu', type: 'NEIGHBOURHOOD', lat: 11.0240, lon: 77.0100 },
  { name: 'Kuniyamuthur', type: 'NEIGHBOURHOOD', lat: 10.9560206, lon: 76.9540742 },
  { name: 'Coimbatore Medical College Hospital', type: 'HOSPITAL', lat: 10.9964193, lon: 76.9701960 },
  { name: 'Nehru Stadium', type: 'SPORTS', lat: 11.0059885, lon: 76.9701336 },
  { name: 'Gandhipuram Cross Cut Road', type: 'SHOPPING', lat: 11.0161, lon: 76.9671 },
  { name: 'Oppanakara Street', type: 'SHOPPING', lat: 10.9936, lon: 76.9602 },
  { name: 'Big Bazaar Street', type: 'SHOPPING', lat: 10.9937, lon: 76.9637 },
  { name: 'Valankulam Lake', type: 'NATURE', lat: 10.9921, lon: 76.9730 },
  { name: 'Lakshmi Mills Junction', type: 'LANDMARK', lat: 11.0090, lon: 77.0000 },
  { name: 'Fun Republic Mall', type: 'SHOPPING', lat: 11.0150, lon: 77.0260 },
  { name: 'TIDEL Park Coimbatore', type: 'LANDMARK', lat: 11.0182, lon: 77.0105 },
  { name: 'Codissia Trade Fair Complex', type: 'VENUE', lat: 11.0336, lon: 77.0267 },
  { name: 'Saravanampatti', type: 'NEIGHBOURHOOD', lat: 11.0770, lon: 77.0010 },
  { name: 'Vadavalli', type: 'NEIGHBOURHOOD', lat: 11.0330, lon: 76.9000 },
  { name: 'Coimbatore North Railway Station', type: 'RAILWAY', lat: 11.0150, lon: 76.9592 },
  { name: 'Ukkadam Fish Market', type: 'MARKET', lat: 10.9890, lon: 76.9590 },
  { name: 'Town Hall Market', type: 'MARKET', lat: 10.9940, lon: 76.9610 },
  { name: 'Race Course Walking Track', type: 'PARK', lat: 11.0059, lon: 76.9745 },
  { name: 'Coimbatore Mani Koondu', type: 'LANDMARK', lat: CITY_ORIGIN.lat, lon: CITY_ORIGIN.lon }
];

let destination = null;
let socket = null;
let hudUpdatedAt = 0;
let lastPositionSentAt = 0;
let gameEntryInProgress = false;

function readDiscoveredPlaces() {
  try {
    const saved = JSON.parse(localStorage.getItem('kovai-discovered') || '[]');
    return new Set(Array.isArray(saved)
      ? saved.filter(index => Number.isInteger(index) && index >= 0 && index < places.length)
      : []);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.warn('Ignoring invalid saved landmark data.');
    return new Set();
  }
}

const discovered = readDiscoveredPlaces();

function setAuthMessage(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'same-origin'
  });
  if (response.status === 204) return {};
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const result = isJson ? await response.json() : {};
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  if (!isJson) throw new Error('The server returned an invalid response. Please try again.');
  return result;
}

function showAuthView(view) {
  authStatus.textContent = '';
  authStatus.classList.remove('error');
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken && view === 'signin') view = 'reset';
  const templates = {
    signin: `<h2>Welcome back.</h2><p class="form-subtitle">The streets have missed you. Sign in to pick up where you left off.</p>
      <form data-action="signin"><div class="field"><label for="signin-email">Email address</label><input id="signin-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="254" required></div>
      <div class="field"><label for="signin-password">Password</label><input id="signin-password" name="password" type="password" placeholder="Your password" autocomplete="current-password" required></div>
      <div class="form-row"><button class="text-button" type="button" data-view="forgot">Forgot password?</button></div>
      <button class="primary-button" type="submit">SIGN IN <span aria-hidden="true">→</span></button></form>
      <p class="auth-switch">New around here? <button class="text-button" type="button" data-view="signup">Create an account</button></p>`,
    signup: `<h2>Claim your corner.</h2><p class="form-subtitle">One account, a whole city to explore. Your Kovai story starts here.</p>
      <form data-action="signup"><div class="field"><label for="signup-name">Your name</label><input id="signup-name" name="name" type="text" placeholder="What should we call you?" autocomplete="name" minlength="2" maxlength="40" required></div>
      <div class="field"><label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="254" required></div>
      <div class="field"><label for="signup-password">Password <span class="field-note">· 8 characters minimum</span></label><input id="signup-password" name="password" type="password" placeholder="Make it a good one" autocomplete="new-password" minlength="8" maxlength="72" required></div>
      <button class="primary-button" type="submit">CREATE ACCOUNT <span aria-hidden="true">→</span></button></form>
      <p class="auth-switch">Already know your way around? <button class="text-button" type="button" data-view="signin">Sign in</button></p>`,
    forgot: `<h2>Lost your way?</h2><p class="form-subtitle">It happens. Drop us your email and we'll send a password reset link.</p>
      <form data-action="forgot-password"><div class="field"><label for="forgot-email">Email address</label><input id="forgot-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="254" required></div>
      <button class="primary-button" type="submit">SEND RESET LINK <span aria-hidden="true">→</span></button></form>
      <p class="auth-switch"><button class="text-button" type="button" data-view="signin">← Back to sign in</button></p>`,
    reset: `<h2>New route, new key.</h2><p class="form-subtitle">Choose a new password for your account. This link is valid for one hour.</p>
      <form data-action="reset-password"><div class="field"><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" maxlength="72" required></div>
      <button class="primary-button" type="submit">UPDATE PASSWORD <span aria-hidden="true">→</span></button></form>
      <p class="auth-switch"><button class="text-button" type="button" data-view="signin">← Back to sign in</button></p>`
  };
  authContent.innerHTML = templates[view] || templates.signin;
  authContent.dataset.view = view;
  const form = authContent.querySelector('form[data-action]');
  form?.addEventListener('submit', submitAuth);
  form?.querySelector('input')?.focus({ preventScroll: true });
}

function distanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const arc = 2 * Math.asin(Math.sqrt(
    Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2
  ));
  return 6371000 * arc;
}

function refreshPlayerActions() {
  const now = performance.now();
  if (now - (refreshPlayerActions.lastUpdate || 0) < 250) return;
  refreshPlayerActions.lastUpdate = now;
  const closest = [...otherPlayers.values()]
    .map(player => ({ player, distance: distanceMeters(camera, player) }))
    .filter(item => item.distance <= 25)
    .sort((a, b) => a.distance - b.distance)[0];
  nearbyPlayer = closest?.player || null;
  if (!nearbyPlayer && !pendingInteraction) {
    playerActions.hidden = true;
    return;
  }
  playerActions.hidden = false;
  if (pendingInteraction) {
    nearbyPlayerName.textContent = pendingInteraction.name;
    playerActionStatus.textContent = pendingInteraction.kind === 'voice'
      ? 'WANTS TO TALK'
      : pendingInteraction.kind === 'ride-request'
        ? 'WANTS TO RIDE WITH YOU'
        : 'INVITED YOU INTO THEIR CAR';
    talkPlayerButton.hidden = true;
    ridePlayerButton.hidden = true;
    acceptPlayerButton.hidden = false;
    rejectPlayerButton.hidden = false;
    return;
  }
  nearbyPlayerName.textContent = nearbyPlayer.name;
  playerActionStatus.textContent = `${Math.round(closest.distance)} M AWAY`;
  talkPlayerButton.hidden = isPassenger || Boolean(voicePeerId);
  ridePlayerButton.hidden = isPassenger || !(
    (nearbyPlayer.vehicle && !nearbyPlayer.passenger) ||
    (playerMotion.vehicle && !nearbyPlayer.vehicle)
  );
  ridePlayerButton.textContent = playerMotion.vehicle ? 'INVITE' : 'RIDE';
  talkPlayerButton.textContent = `TALK TO ${nearbyPlayer.name.toUpperCase()}`;
  acceptPlayerButton.hidden = true;
  rejectPlayerButton.hidden = true;
}

async function acquireVoiceStream() {
  if (localVoiceStream) return localVoiceStream;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Voice chat needs microphone access and a secure HTTPS connection.');
  }
  localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  return localVoiceStream;
}

function closeVoiceConnection(notify = true) {
  if (notify && socket?.connected && voicePeerId) socket.emit('voice:end');
  voiceConnection?.close();
  voiceConnection = null;
  voicePeerId = null;
  pendingIceCandidates = [];
  voiceRestartAttempted = false;
  if (localVoiceStream) {
    for (const track of localVoiceStream.getTracks()) track.stop();
    localVoiceStream = null;
  }
  voiceAudio.srcObject = null;
  voiceAudio.muted = false;
  voiceControls.hidden = true;
  clearTimeout(voiceInviteTimer);
  voiceInviteTimer = null;
  voiceInviteTargetId = null;
  refreshPlayerActions.lastUpdate = 0;
  refreshPlayerActions();
}

function ensureVoiceConnection(peerId) {
  if (voiceConnection && voicePeerId === peerId) return voiceConnection;
  voiceConnection?.close();
  voicePeerId = peerId;
  voiceConnection = new RTCPeerConnection({
    iceServers: voiceIceServers
  });
  for (const track of localVoiceStream.getTracks()) voiceConnection.addTrack(track, localVoiceStream);
  voiceConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('voice:signal', {
        targetId: peerId,
        signal: { type: 'candidate', candidate: event.candidate.toJSON() }
      });
    }
  };
  voiceConnection.ontrack = event => {
    const [remoteStream] = event.streams;
    if (remoteStream) voiceAudio.srcObject = remoteStream;
    else {
      const stream = voiceAudio.srcObject instanceof MediaStream ? voiceAudio.srcObject : new MediaStream();
      stream.addTrack(event.track);
      voiceAudio.srcObject = stream;
    }
    voiceAudio.volume = 1;
    voiceAudio.muted = false;
    event.track.onunmute = () => { voiceStatus.textContent = 'REMOTE MIC ACTIVE'; };
    event.track.onmute = () => { voiceStatus.textContent = 'REMOTE MIC MUTED'; };
    voiceAudio.play().catch(error => {
      voiceStatus.textContent = `TAP SPEAKER ON · AUDIO BLOCKED (${error.name})`;
    });
  };
  voiceConnection.oniceconnectionstatechange = () => {
    if (!voiceConnection) return;
    const state = voiceConnection.iceConnectionState;
    if (state === 'checking') voiceStatus.textContent = 'CONNECTING AUDIO...';
    if (state === 'connected' || state === 'completed') voiceStatus.textContent = 'AUDIO LINK READY · TAP SPEAKER ON';
    if (state === 'disconnected') voiceStatus.textContent = 'AUDIO PAUSED · RECONNECTING...';
    if (state === 'failed' && !voiceRestartAttempted) {
      voiceRestartAttempted = true;
      voiceStatus.textContent = 'RETRYING AUDIO ROUTE...';
      voiceConnection.restartIce();
      voiceConnection.createOffer({ iceRestart: true })
        .then(offer => voiceConnection.setLocalDescription(offer))
        .then(() => {
          if (voiceConnection?.localDescription) {
            socket.emit('voice:signal', { targetId: peerId, signal: voiceConnection.localDescription.toJSON() });
          }
        })
        .catch(error => {
          voiceStatus.textContent = `NETWORK BLOCKED (${error.message}) · TURN RELAY NEEDED`;
        });
    }
  };
  voiceConnection.onconnectionstatechange = () => {
    if (!voiceConnection) return;
    if (voiceConnection.connectionState === 'connected') voiceStatus.textContent = 'VOICE CONNECTED · CHECK SPEAKER';
    if (voiceConnection.connectionState === 'failed') {
      voiceStatus.textContent = 'NETWORK BLOCKED · TURN RELAY NEEDED';
    }
    if (voiceConnection.connectionState === 'closed') closeVoiceConnection(false);
  };
  voiceControls.hidden = false;
  voiceStatus.textContent = 'CONNECTING VOICE...';
  return voiceConnection;
}

async function handleVoiceSignal({ id, signal }) {
  if (!signal || !id) return;
  if (signal.type === 'offer') {
    await acquireVoiceStream();
    const connection = ensureVoiceConnection(id);
    await connection.setRemoteDescription(signal);
    for (const candidate of pendingIceCandidates.splice(0)) await connection.addIceCandidate(candidate);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    socket.emit('voice:signal', { targetId: id, signal: connection.localDescription.toJSON() });
  } else if (signal.type === 'answer') {
    if (!voiceConnection || voicePeerId !== id) return;
    await voiceConnection.setRemoteDescription(signal);
    for (const candidate of pendingIceCandidates.splice(0)) await voiceConnection.addIceCandidate(candidate);
  } else if (signal.type === 'candidate') {
    if (!voiceConnection || voicePeerId !== id || !signal.candidate) return;
    const candidate = new RTCIceCandidate(signal.candidate);
    if (!voiceConnection.remoteDescription) pendingIceCandidates.push(candidate);
    else await voiceConnection.addIceCandidate(candidate);
  }
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`;
}

function renderPlaces() {
  placeList.innerHTML = places.map((place, index) => `<button class="place-button" type="button" data-place="${index}">
    <span class="place-index">${String(index + 1).padStart(2, '0')}</span><span class="place-name">${escapeHtml(place.name)}</span><span class="place-type">${discovered.has(index) ? 'FOUND' : place.type}</span></button>`).join('');
  document.querySelector('#places-count').textContent = `${String(discovered.size).padStart(2, '0')} / ${String(places.length).padStart(2, '0')}`;
}

function getNeighbourhood(position) {
  if (position.lat > 11.004 && position.lat < 11.019 && position.lon > 76.940 && position.lon < 76.963) return 'GANDHIPURAM';
  if (position.lat > 11.003 && position.lat < 11.022 && position.lon > 76.932 && position.lon < 76.953) return 'RS PURAM';
  if (position.lat > 10.997 && position.lat < 11.013 && position.lon > 76.965 && position.lon < 76.982) return 'RACE COURSE';
  if (position.lon > 76.99) return 'SINGANALLUR';
  if (position.lat < 10.99) return 'SOUTH KOVAI';
  if (position.lat > 11.03) return 'NORTH KOVAI';
  return 'COIMBATORE';
}

function updateHud(now = performance.now()) {
  if (now - hudUpdatedAt < 140) return;
  hudUpdatedAt = now;
  mapCoords.textContent = `${camera.lat.toFixed(5)}° N · ${camera.lon.toFixed(5)}° E`;
  const closest = places.map(place => ({ place, distance: distanceMeters(camera, place) }))
    .sort((a, b) => a.distance - b.distance)[0];
  currentArea.textContent = closest.distance < 900
    ? closest.place.name.toUpperCase()
    : getNeighbourhood(camera);
  if (closest.distance < 100) {
    const index = places.indexOf(closest.place);
    if (!discovered.has(index)) {
      discovered.add(index);
      localStorage.setItem('kovai-discovered', JSON.stringify([...discovered]));
      renderPlaces();
      tileStatus.textContent = `PLACE DISCOVERED · ${closest.place.name.toUpperCase()}`;
    }
  }
  if (destination) {
    const distance = distanceMeters(camera, destination);
    destinationDistance.textContent = distance < 45
      ? 'YOU MADE IT — PLACE DISCOVERED'
      : formatDistance(distance);
  }
}

function drawMiniMap(position = camera, motion = {}) {
  const now = performance.now();
  if (now - miniMapUpdatedAt < 120) return;
  miniMapUpdatedAt = now;
  const context = miniMapContext;
  const width = miniMap.width;
  const height = miniMap.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 8;
  const rangeMeters = motion.vehicle ? 450 : 390;
  const metersToPixels = radius / rangeMeters;
  const heading = Number.isFinite(motion.heading) ? motion.heading : 0;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#202b25';
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = '#25352e';
  context.fillRect(0, 0, width, height);
  const playerX = (position.lon - CITY_ORIGIN.lon) * 111320 * Math.cos(CITY_ORIGIN.lat * Math.PI / 180);
  const playerZ = (CITY_ORIGIN.lat - position.lat) * 111320;
  const toScreen = point => {
    const dx = (point.lon - position.lon) * 111320 * Math.cos(position.lat * Math.PI / 180);
    const dz = (position.lat - point.lat) * 111320;
    const right = dx * Math.cos(heading) + dz * Math.sin(heading);
    const forward = dx * Math.sin(heading) - dz * Math.cos(heading);
    return { x: centerX + right * metersToPixels, y: centerY - forward * metersToPixels, right, forward };
  };
  const worldToGeo = (x, z) => ({
    lat: CITY_ORIGIN.lat - z / 111320,
    lon: CITY_ORIGIN.lon + x / (111320 * Math.cos(CITY_ORIGIN.lat * Math.PI / 180))
  });
  const roadSpacing = 108;
  const roadStartX = Math.floor(playerX / roadSpacing);
  const roadStartZ = Math.floor(playerZ / roadSpacing);
  context.lineCap = 'square';
  context.lineWidth = 9 * metersToPixels;
  context.strokeStyle = 'rgba(34, 43, 37, .95)';
  for (let offset = -6; offset <= 6; offset++) {
    for (const xRoad of [true, false]) {
      const road = xRoad ? (roadStartX + offset) * roadSpacing : (roadStartZ + offset) * roadSpacing;
      const start = xRoad ? toScreen(worldToGeo(road, playerZ - rangeMeters * 1.5)) : toScreen(worldToGeo(playerX - rangeMeters * 1.5, road));
      const end = xRoad ? toScreen(worldToGeo(road, playerZ + rangeMeters * 1.5)) : toScreen(worldToGeo(playerX + rangeMeters * 1.5, road));
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
  }
  context.lineWidth = 3.2 * metersToPixels;
  context.strokeStyle = 'rgba(174, 178, 153, .75)';
  for (let offset = -6; offset <= 6; offset++) {
    for (const xRoad of [true, false]) {
      const road = xRoad ? (roadStartX + offset) * roadSpacing : (roadStartZ + offset) * roadSpacing;
      for (const side of [-1, 1]) {
        const offsetX = xRoad ? road + side * 7 : road;
        const offsetZ = xRoad ? road : road + side * 7;
        const start = xRoad ? toScreen(worldToGeo(offsetX, playerZ - rangeMeters * 1.5)) : toScreen(worldToGeo(playerX - rangeMeters * 1.5, offsetZ));
        const end = xRoad ? toScreen(worldToGeo(offsetX, playerZ + rangeMeters * 1.5)) : toScreen(worldToGeo(playerX + rangeMeters * 1.5, offsetZ));
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }
    }
  }
  context.lineWidth = Math.max(1, .7 * metersToPixels);
  context.strokeStyle = 'rgba(225, 205, 132, .8)';
  context.setLineDash([13 * metersToPixels, 12 * metersToPixels]);
  for (let offset = -6; offset <= 6; offset++) {
    for (const xRoad of [true, false]) {
      const road = xRoad ? (roadStartX + offset) * roadSpacing : (roadStartZ + offset) * roadSpacing;
      const start = xRoad ? toScreen(worldToGeo(road, playerZ - rangeMeters * 1.5)) : toScreen(worldToGeo(playerX - rangeMeters * 1.5, road));
      const end = xRoad ? toScreen(worldToGeo(road, playerZ + rangeMeters * 1.5)) : toScreen(worldToGeo(playerX + rangeMeters * 1.5, road));
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
  }
  context.setLineDash([]);
  for (const tile of mapTiles) {
    const { image } = tile;
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) continue;
    const unit = metersToPixels * tile.size / imageWidth;
    const a = unit * Math.cos(heading);
    const b = -unit * Math.sin(heading);
    const c = unit * Math.sin(heading);
    const d = unit * Math.cos(heading);
    const screen = toScreen(worldToGeo(tile.x, tile.z));
    context.setTransform(a, b, c, d, screen.x - (a * imageWidth + c * imageHeight) / 2, screen.y - (b * imageWidth + d * imageHeight) / 2);
    context.drawImage(image, 0, 0);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  let targetOnScreen = null;
  if (destination) {
    targetOnScreen = toScreen(destination);
    const distance = Math.hypot(targetOnScreen.right, targetOnScreen.forward);
    targetOnScreen = {
      ...targetOnScreen,
      distance,
      clipped: Math.hypot(targetOnScreen.x - centerX, targetOnScreen.y - centerY) > radius - 12
    };
    if (targetOnScreen.clipped) {
      const dx = targetOnScreen.x - centerX;
      const dy = targetOnScreen.y - centerY;
      const edgeScale = (radius - 14) / Math.max(1, Math.hypot(dx, dy));
      targetOnScreen.edgeX = centerX + dx * edgeScale;
      targetOnScreen.edgeY = centerY + dy * edgeScale;
    }
    const destinationX = (destination.lon - CITY_ORIGIN.lon) * 111320 * Math.cos(CITY_ORIGIN.lat * Math.PI / 180);
    const destinationZ = (CITY_ORIGIN.lat - destination.lat) * 111320;
    const spacing = 108;
    const startX = Math.round(playerX / spacing) * spacing;
    const startZ = Math.round(playerZ / spacing) * spacing;
    const endX = Math.round(destinationX / spacing) * spacing;
    const endZ = Math.round(destinationZ / spacing) * spacing;
    const route = [
      { x: playerX, z: playerZ },
      { x: startX, z: startZ },
      { x: endX, z: startZ },
      { x: endX, z: endZ },
      { x: destinationX, z: destinationZ }
    ];
    const routePoints = route.map(point => toScreen(worldToGeo(point.x, point.z)));
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(routePoints[0].x, routePoints[0].y);
    for (const point of routePoints.slice(1)) context.lineTo(point.x, point.y);
    context.strokeStyle = 'rgba(19, 22, 27, .9)';
    context.lineWidth = 7;
    context.stroke();
    context.strokeStyle = '#ff4f9a';
    context.lineWidth = 4;
    context.shadowColor = '#ff4f9a';
    context.shadowBlur = 9;
    context.stroke();
    context.shadowBlur = 0;
  }
  context.setLineDash([]);
  for (const place of places) {
    const point = toScreen(place);
    if (Math.hypot(point.right, point.forward) > rangeMeters * .93) continue;
    context.beginPath();
    context.fillStyle = destination === place ? '#ffbd63' : '#aab79f';
    context.arc(point.x, point.y, destination === place ? 5 : 3, 0, Math.PI * 2);
    context.fill();
  }
  for (const player of otherPlayers.values()) {
    const point = toScreen(player);
    if (point.x < 10 || point.x > width - 10 || point.y < 10 || point.y > height - 10) continue;
    context.beginPath();
    context.fillStyle = '#55c7ff';
    context.shadowColor = '#55c7ff';
    context.shadowBlur = 8;
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(Number.isFinite(player.heading) ? player.heading - heading : 0);
    context.beginPath();
    context.moveTo(0, -8);
    context.lineTo(4, 3);
    context.lineTo(0, 1);
    context.lineTo(-4, 3);
    context.closePath();
    context.fillStyle = '#e8f8ff';
    context.fill();
    context.restore();
  }
  if (destination && targetOnScreen && !targetOnScreen.clipped) {
    context.beginPath();
    context.fillStyle = '#ff4f9a';
    context.arc(targetOnScreen.x, targetOnScreen.y, 6, 0, Math.PI * 2);
    context.fill();
  } else if (destination && targetOnScreen?.clipped) {
    const angle = Math.atan2(targetOnScreen.edgeY - centerY, targetOnScreen.edgeX - centerX);
    context.save();
    context.translate(targetOnScreen.edgeX, targetOnScreen.edgeY);
    context.rotate(angle + Math.PI / 2);
    context.beginPath();
    context.moveTo(0, -9);
    context.lineTo(7, 8);
    context.lineTo(-7, 8);
    context.closePath();
    context.fillStyle = '#ff4f9a';
    context.shadowColor = '#ff4f9a';
    context.shadowBlur = 8;
    context.fill();
    context.restore();
  }
  const playerCount = socket?.connected ? otherPlayers.size + 1 : 0;
  miniMapPlayerCount.textContent = String(playerCount);
  miniMapOnline.textContent = socket?.connected ? `${playerCount} ONLINE` : 'OFFLINE';
  miniMapOnline.classList.toggle('connected', socket?.connected === true);
  miniMapPlace.textContent = destination ? destination.name.toUpperCase() : 'CITY NAVIGATION';
  context.restore();
  context.save();
  context.translate(centerX, centerY);
  context.beginPath();
  context.moveTo(0, -11);
  context.lineTo(8, 8);
  context.lineTo(0, 5);
  context.lineTo(-8, 8);
  context.closePath();
  context.fillStyle = '#d4f36a';
  context.shadowColor = '#d4f36a';
  context.shadowBlur = 10;
  context.fill();
  context.restore();

  const cardinal = ['N', 'E', 'S', 'W'][Math.round(((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2)) % 4];
  miniMapHeading.textContent = `${cardinal} ↑`;
  miniMapTargetKey.hidden = !destination;
}

function connectMultiplayer() {
  if (typeof window.io !== 'function') {
    tileStatus.textContent = 'MULTIPLAYER UNAVAILABLE · RELOAD TO RETRY';
    return;
  }
  socket?.disconnect();
  socket = window.io();
  socket.on('players:snapshot', players => {
    otherPlayers.clear();
    for (const player of players) otherPlayers.set(player.id, player);
    cityWorld.current?.updatePlayers([...otherPlayers.values()]);
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
    drawMiniMap(camera, playerMotion);
  });
  socket.on('players:joined', player => {
    otherPlayers.set(player.id, player);
    cityWorld.current?.updatePlayers([...otherPlayers.values()]);
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
    drawMiniMap(camera, playerMotion);
  });
  socket.on('players:update', player => {
    if (player.id === socket.id) return;
    otherPlayers.set(player.id, player);
    cityWorld.current?.setPlayer(player);
    if (isPassenger && player.id === rideDriverId) {
      cityWorld.current?.setPassengerPosition(player);
      camera.lat = player.lat;
      camera.lon = player.lon;
      playerHeading = player.heading;
      playerMotion = { heading: player.heading, vehicle: true, speed: player.speed };
      updateHud();
    }
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
    drawMiniMap(camera, playerMotion);
  });
  socket.on('players:left', id => {
    otherPlayers.delete(id);
    if (id === rideDriverId) {
      cityWorld.current?.setPassengerMode(null);
      isPassenger = false;
      rideDriverId = null;
      passengerControls.hidden = true;
    }
    cityWorld.current?.updatePlayers([...otherPlayers.values()]);
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
    drawMiniMap(camera, playerMotion);
  });
  socket.on('voice:incoming', player => {
    pendingInteraction = { kind: 'voice', ...player };
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('voice:accepted', async ({ id, initiator }) => {
    if (!id || !initiator) return;
    clearTimeout(voiceInviteTimer);
    voiceInviteTimer = null;
    voiceInviteTargetId = null;
    try {
      voicePeerId = id;
      const connection = ensureVoiceConnection(id);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit('voice:signal', { targetId: id, signal: connection.localDescription.toJSON() });
    } catch (error) {
      playerActionStatus.textContent = `VOICE FAILED: ${error.message}`;
      closeVoiceConnection();
    }
  });
  socket.on('voice:signal', message => {
    handleVoiceSignal(message).catch(error => {
      playerActionStatus.textContent = `VOICE FAILED: ${error.message}`;
      closeVoiceConnection();
    });
  });
  socket.on('voice:rejected', ({ name }) => {
    pendingInteraction = null;
    closeVoiceConnection(false);
    playerActionStatus.textContent = `${name} DECLINED THE CALL`;
  });
  socket.on('voice:cancelled', ({ id }) => {
    if (pendingInteraction?.id === id) pendingInteraction = null;
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('voice:invite-sent', ({ name }) => {
    voiceStatus.textContent = `CALLING ${name.toUpperCase()}...`;
    voiceControls.hidden = false;
  });
  socket.on('voice:invite-failed', ({ message }) => {
    playerActionStatus.textContent = message.toUpperCase();
    closeVoiceConnection(false);
  });
  socket.on('voice:ended', ({ name } = {}) => {
    closeVoiceConnection(false);
    playerActionStatus.textContent = name ? `${name} LEFT VOICE CHAT` : 'VOICE CHAT ENDED';
  });
  socket.on('car:ride-requested', player => {
    pendingInteraction = { kind: 'ride-request', ...player };
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('car:ride-invited', player => {
    pendingInteraction = { kind: 'ride-invite', ...player };
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('car:request-sent', ({ name }) => {
    playerActionStatus.textContent = `RIDE REQUEST SENT TO ${name.toUpperCase()}`;
  });
  socket.on('car:ride-declined', ({ name }) => {
    pendingInteraction = null;
    playerActionStatus.textContent = `${name} DECLINED`;
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('car:joined', ride => {
    pendingInteraction = null;
    if (ride.role === 'passenger') {
      isPassenger = true;
      rideDriverId = ride.otherId;
      cityWorld.current?.setPassengerMode(ride);
      camera.lat = ride.lat;
      camera.lon = ride.lon;
      playerMotion = { heading: ride.heading || 0, vehicle: true, speed: ride.speed || 0 };
      updateTravelMode(true, ride.speed || 0);
      passengerLabel.textContent = `RIDING WITH ${ride.otherName.toUpperCase()}`;
      passengerControls.hidden = false;
    } else {
      passengerLabel.textContent = `${ride.otherName.toUpperCase()} IS RIDING WITH YOU`;
      passengerControls.hidden = false;
      document.querySelector('#leave-car').textContent = 'DROP PASSENGER';
    }
    playerActionStatus.textContent = ride.role === 'driver' ? 'PASSENGER JOINED' : 'RIDE STARTED';
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('car:left', () => {
    if (isPassenger) {
      cityWorld.current?.setPassengerMode(null);
      cityWorld.current?.setPosition(camera);
      isPassenger = false;
      rideDriverId = null;
      updateTravelMode(false, 0);
    }
    passengerControls.hidden = true;
    document.querySelector('#leave-car').textContent = 'LEAVE CAR';
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('connect', () => {
    socket.emit('player:move', { lat: camera.lat, lon: camera.lon, ...playerMotion, vehicle: playerMotion.vehicle });
    tileStatus.textContent = 'ONLINE CITY · YOU ARE LIVE';
    drawMiniMap(camera, playerMotion);
  });
  socket.on('disconnect', () => {
    closeVoiceConnection(false);
    pendingInteraction = null;
    drawMiniMap(camera, playerMotion);
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
  });
  socket.on('connect_error', error => {
    tileStatus.textContent = error.message.toUpperCase();
    drawMiniMap(camera, playerMotion);
  });
}

function updatePlayer(position, motion = {}) {
  camera.lat = position.lat;
  camera.lon = position.lon;
  if (Number.isFinite(motion.heading)) playerHeading = motion.heading;
  playerMotion = { ...playerMotion, ...motion, heading: playerHeading };
  updateHud();
  refreshPlayerActions();
  drawMiniMap(position, playerMotion);
  const now = performance.now();
  if (socket?.connected && now - lastPositionSentAt > 90) {
    socket.emit('player:move', { ...position, ...playerMotion });
    lastPositionSentAt = now;
  }
}

function updateTravelMode(isDriving, speed) {
  playerMotion.vehicle = isDriving;
  playerMotion.speed = speed;
  const mode = isDriving ? 'DRIVING' : 'ON FOOT';
  const speedText = `${Math.round(Math.abs(speed) * (isDriving ? 3.6 : 1))} ${isDriving ? 'KM/H' : 'M/S'}`;
  const modeElement = document.querySelector('#travel-mode');
  const speedElement = document.querySelector('#speed-readout');
  if (modeElement.textContent !== mode) modeElement.textContent = mode;
  if (speedElement.textContent !== speedText) speedElement.textContent = speedText;
  document.querySelector('#mobile-enter-car').textContent = isPassenger ? 'LEAVE CAR' : isDriving ? 'EXIT CAR' : 'CAR';
  refreshPlayerActions();
}

async function enterGame(user) {
  if (gameEntryInProgress) return;
  gameEntryInProgress = true;
  try {
    authScreen.hidden = true;
    gameScreen.hidden = false;
    document.querySelector('#player-name').textContent = user.name;
    const soundToggle = document.querySelector('#sound-toggle');
    soundToggle.textContent = 'SOUND ON';
    soundToggle.setAttribute('aria-label', 'Mute game sound');
    tileStatus.textContent = 'THIRD-PERSON CITY · BUILDING THE STREETS';
    cityWorld.current?.destroy();
    cityWorld.current = createCityWorld({
      canvas,
      places,
      onPosition: updatePlayer,
      onMapTiles: tiles => {
        mapTiles = tiles;
        drawMiniMap(camera, playerMotion);
      },
      onStatus: message => { tileStatus.textContent = message; },
      onMode: updateTravelMode
    });
    updateClock();
    updateTravelMode(false, 0);
    canvas.focus({ preventScroll: true });
    connectMultiplayer();
    renderPlaces();
    updateHud(0);
  } catch (error) {
    gameScreen.hidden = true;
    authScreen.hidden = false;
    throw error;
  } finally {
    gameEntryInProgress = false;
  }
}

async function submitAuth(event) {
  const form = event.target.closest('form[data-action]');
  if (!form) return;
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  const data = Object.fromEntries(new FormData(form));
  const action = form.dataset.action;
  const token = new URLSearchParams(location.search).get('reset');
  if (action === 'reset-password') data.token = token;
  submitButton.disabled = true;
  setAuthMessage('');
  try {
    const result = await api(`/api/auth/${action}`, { method: 'POST', body: JSON.stringify(data) });
    if (action === 'signin' || action === 'signup') {
      await enterGame(result.user);
    } else if (action === 'forgot-password') {
      setAuthMessage(result.message);
      form.reset();
    } else {
      history.replaceState({}, '', '/');
      showAuthView('signin');
      setAuthMessage(result.message);
    }
  } catch (error) {
    setAuthMessage(error.message, true);
  } finally {
    if (submitButton.isConnected) submitButton.disabled = false;
  }
}

authContent.addEventListener('click', event => {
  const button = event.target.closest('button[data-view]');
  if (!button) return;
  if (button.dataset.view === 'signin' && new URLSearchParams(location.search).has('reset')) {
    history.replaceState({}, '', '/');
  }
  showAuthView(button.dataset.view);
});
placeList.addEventListener('click', event => {
  const button = event.target.closest('[data-place]');
  if (!button) return;
  destination = places[Number(button.dataset.place)];
  destinationName.textContent = destination.name.toUpperCase();
  destinationCard.hidden = false;
  cityWorld.current?.setTarget(destination);
  updateHud(0);
  drawMiniMap(camera, playerMotion);
});

document.querySelector('#clear-destination').addEventListener('click', () => {
  destination = null;
  destinationCard.hidden = true;
  cityWorld.current?.setTarget(null);
  drawMiniMap(camera, playerMotion);
});

document.querySelector('#signout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/signout', { method: 'POST', body: '{}' });
    closeVoiceConnection();
    socket?.disconnect();
    cityWorld.current?.destroy();
    cityWorld.current = null;
    otherPlayers.clear();
    gameScreen.hidden = true;
    authScreen.hidden = false;
    showAuthView('signin');
  } catch (error) {
    tileStatus.textContent = error.message;
  }
});

document.querySelector('#zoom-in').addEventListener('click', () => cityWorld.current?.setZoom(-1));
document.querySelector('#zoom-out').addEventListener('click', () => cityWorld.current?.setZoom(1));
document.querySelector('#sound-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const soundOn = cityWorld.current?.toggleSound() || false;
  button.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
  button.setAttribute('aria-label', soundOn ? 'Mute game sound' : 'Enable game sound');
});
talkPlayerButton.addEventListener('click', async () => {
  if (!nearbyPlayer || !socket?.connected) return;
  const targetId = nearbyPlayer.id;
  const targetName = nearbyPlayer.name;
  try {
    await acquireVoiceStream();
    voiceInviteTargetId = targetId;
    voiceStatus.textContent = `CALLING ${targetName.toUpperCase()}...`;
    voiceControls.hidden = false;
    pendingInteraction = null;
    socket.emit('voice:invite', targetId);
    clearTimeout(voiceInviteTimer);
    voiceInviteTimer = setTimeout(() => {
      if (!voicePeerId) {
        socket.emit('voice:cancel', voiceInviteTargetId);
        closeVoiceConnection(false);
        playerActionStatus.textContent = 'NO ANSWER · TRY AGAIN';
      }
    }, 30_000);
  } catch (error) {
    playerActionStatus.textContent = error.name === 'NotAllowedError'
      ? 'ALLOW MICROPHONE ACCESS TO TALK'
      : error.message.toUpperCase();
  }
});
ridePlayerButton.addEventListener('click', () => {
  if (!nearbyPlayer || !socket?.connected) return;
  if (playerMotion.vehicle) socket.emit('car:invite', nearbyPlayer.id);
  else socket.emit('car:request', nearbyPlayer.id);
});
acceptPlayerButton.addEventListener('click', async () => {
  if (!pendingInteraction || !socket?.connected) return;
  const interaction = pendingInteraction;
  try {
    if (interaction.kind === 'voice') await acquireVoiceStream();
    pendingInteraction = null;
    refreshPlayerActions.lastUpdate = 0;
    refreshPlayerActions();
    if (interaction.kind === 'voice') {
      socket.emit('voice:accept', interaction.id);
      voiceStatus.textContent = 'CONNECTING VOICE...';
      voiceControls.hidden = false;
    } else {
      socket.emit('car:accept', interaction.id);
    }
  } catch (error) {
    playerActionStatus.textContent = error.name === 'NotAllowedError'
      ? 'ALLOW MICROPHONE ACCESS TO TALK'
      : error.message.toUpperCase();
  }
});
rejectPlayerButton.addEventListener('click', () => {
  if (!pendingInteraction || !socket?.connected) return;
  if (pendingInteraction.kind === 'voice') socket.emit('voice:reject', pendingInteraction.id);
  else socket.emit('car:decline', pendingInteraction.id);
  pendingInteraction = null;
  refreshPlayerActions.lastUpdate = 0;
  refreshPlayerActions();
});
document.querySelector('#voice-mic').addEventListener('click', event => {
  const muted = localVoiceStream?.getAudioTracks().every(track => !track.enabled) || false;
  if (!localVoiceStream) return;
  for (const track of localVoiceStream.getAudioTracks()) track.enabled = muted;
  event.currentTarget.textContent = muted ? 'MIC ON' : 'MIC OFF';
});
document.querySelector('#voice-speaker').addEventListener('click', event => {
  const muteOutput = !voiceAudio.muted && !voiceAudio.paused;
  voiceAudio.muted = muteOutput;
  event.currentTarget.textContent = muteOutput ? 'SPEAKER OFF' : 'SPEAKER ON';
  if (!muteOutput) {
    voiceAudio.volume = 1;
    voiceAudio.play().catch(error => {
      voiceStatus.textContent = `AUDIO UNAVAILABLE (${error.name}) · CHECK PHONE VOLUME`;
    });
  }
});
document.querySelector('#voice-end').addEventListener('click', () => closeVoiceConnection());
document.querySelector('#leave-car').addEventListener('click', () => socket?.emit('car:leave'));
document.querySelector('#mobile-enter-car').addEventListener('click', () => {
  if (isPassenger) {
    socket?.emit('car:leave');
    return;
  }
  cityWorld.current?.toggleVehicle();
});
document.querySelector('#recenter').addEventListener('click', () => {
  destination = null;
  destinationCard.hidden = true;
  cityWorld.current?.reset();
  cityWorld.current?.setTarget(null);
  drawMiniMap(camera, playerMotion);
  if (socket?.connected) socket.emit('player:return-to-start');
});

async function checkSession() {
  if (new URLSearchParams(location.search).has('reset')) {
    showAuthView('reset');
    return;
  }
  try {
    const { user } = await api('/api/auth/me');
    await enterGame(user);
  } catch (error) {
    if (!error.message.includes('sign in') && !error.message.includes('session has expired')) {
      setAuthMessage(error.message, true);
    }
  }
}

function updateClock() {
  const now = new Date();
  const timeZone = 'Asia/Kolkata';
  document.querySelector('#city-time').textContent = new Intl.DateTimeFormat('en-IN', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now);
  const timeParts = new Intl.DateTimeFormat('en-IN', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const hour = Number(timeParts.find(part => part.type === 'hour')?.value);
  const minute = Number(timeParts.find(part => part.type === 'minute')?.value);
  const preset = dayPresets[dayPresetIndex];
  cityWorld.current?.setEnvironment(preset.hour ?? hour + minute / 60, isRaining);
  dayCycleButton.textContent = `நேரம் · ${preset.label}`;
  dayCycleButton.setAttribute('aria-label', `நேர அமைப்பு: ${preset.label}. மாற்ற அழுத்தவும்`);
  rainToggleButton.textContent = isRaining ? 'மழை · ஆம்' : 'மழை · இல்லை';
  rainToggleButton.setAttribute('aria-pressed', String(isRaining));
  rainToggleButton.setAttribute('aria-label', isRaining ? 'மழையை நிறுத்து' : 'மழையை இயக்கு');
}

showAuthView('signin');
updateClock();
setInterval(updateClock, 30_000);
dayCycleButton.addEventListener('click', () => {
  dayPresetIndex = (dayPresetIndex + 1) % dayPresets.length;
  localStorage.setItem('kovai-day-preset', dayPresets[dayPresetIndex].id);
  updateClock();
});
rainToggleButton.addEventListener('click', () => {
  isRaining = !isRaining;
  localStorage.setItem('kovai-rain-mode', String(isRaining));
  updateClock();
});
checkSession();

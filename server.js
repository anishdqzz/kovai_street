import 'dotenv/config';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookie from 'cookie';
import cookieParser from 'cookie-parser';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { Server } from 'socket.io';
import { PLAYER_START } from './public/map-config.js';

const app = express();
const server = createServer(app);
const io = new Server(server);
const activePlayers = new Map();
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? undefined : 'kovai-streets-local-development-secret');
const requestedPort = process.env.PORT ? Number(process.env.PORT) : undefined;
if (requestedPort !== undefined && (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535)) {
  throw new Error('PORT must be a valid port number between 1 and 65535.');
}

async function findAvailablePort() {
  for (let candidate = 4173; candidate < 4200; candidate++) {
    const probe = createServer();
    const available = await new Promise((resolve, reject) => {
      probe.once('error', error => {
        if (error.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      });
      probe.listen(candidate, () => resolve(true));
    });
    if (!available) continue;
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    return candidate;
  }
  const probe = createServer();
  const port = await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, () => resolve(probe.address().port));
  });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

const port = requestedPort || await findAvailablePort();
const appOrigin = new URL(
  process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`
).origin;
const root = path.dirname(fileURLToPath(import.meta.url));

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('Set JWT_SECRET to a value of at least 32 characters.');
}
if (isProduction && !process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is required in production. Configure MongoDB in your deployment environment.');
}

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true },
  resetTokenHash: { type: String, default: null },
  resetExpiresAt: { type: Date, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const voiceIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
  voiceIceServers.push({
    urls: process.env.TURN_URLS.split(',').map(url => url.trim()).filter(Boolean),
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL
  });
}
const localUsers = new Map();
const localDataDirectory = path.join(root, '.data');
const localUsersFile = path.join(localDataDirectory, 'users.json');
let localWriteQueue = Promise.resolve();

function persistLocalUsers() {
  const snapshot = JSON.stringify([...localUsers.values()], null, 2);
  localWriteQueue = localWriteQueue.then(async () => {
    await mkdir(localDataDirectory, { recursive: true });
    const temporaryFile = `${localUsersFile}.tmp`;
    await writeFile(temporaryFile, snapshot, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryFile, localUsersFile);
  });
  return localWriteQueue;
}

async function connectDatabase() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');
    return;
  }

  try {
    const savedUsers = JSON.parse(await readFile(localUsersFile, 'utf8'));
    if (!Array.isArray(savedUsers) || savedUsers.some(user =>
      !user || typeof user._id !== 'string' || typeof user.email !== 'string' || typeof user.passwordHash !== 'string'
    )) {
      throw new Error(`Local user data is invalid. Check ${localUsersFile}.`);
    }
    for (const user of savedUsers) localUsers.set(user._id, user);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.warn('MONGODB_URI is not set. Using local development storage in .data/users.json; configure MongoDB for production.');
  if (!process.env.JWT_SECRET) {
    console.warn('Using a development-only session secret. Set JWT_SECRET before deployment.');
  }
}

async function createUser(data) {
  if (process.env.MONGODB_URI) return User.create(data);
  if ([...localUsers.values()].some(user => user.email === data.email)) {
    const error = new Error('An account with this email already exists.');
    error.code = 11000;
    throw error;
  }
  const user = { ...data, _id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date() };
  localUsers.set(user._id, user);
  await persistLocalUsers();
  return user;
}

async function seedDevelopmentTestAccount() {
  if (isProduction) return;
  const email = 'admin@gmail.com';
  if (await findUserByEmail(email)) return;
  await createUser({
    name: 'Admin',
    email,
    passwordHash: await bcrypt.hash('admin', 12)
  });
  console.warn('Local development test account created: admin@gmail.com / admin. Do not use in production.');
}

async function findUserByEmail(email) {
  if (process.env.MONGODB_URI) return User.findOne({ email });
  return [...localUsers.values()].find(user => user.email === email) || null;
}

async function findUserById(id) {
  if (process.env.MONGODB_URI) {
    if (!mongoose.isValidObjectId(id)) return null;
    return User.findById(id).select('name email');
  }
  const user = localUsers.get(id);
  return user ? { _id: user._id, id: user._id, name: user.name, email: user.email } : null;
}

async function findUserByResetToken(tokenHash) {
  if (process.env.MONGODB_URI) {
    return User.findOne({
      resetTokenHash: tokenHash,
      resetExpiresAt: { $gt: new Date() }
    });
  }
  return [...localUsers.values()].find(user =>
    user.resetTokenHash === tokenHash && new Date(user.resetExpiresAt) > new Date()
  ) || null;
}

async function saveUser(user) {
  if (process.env.MONGODB_URI) return user.save();
  user.updatedAt = new Date();
  localUsers.set(user._id, user);
  await persistLocalUsers();
  return user;
}

const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = hasSmtp ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

app.disable('x-powered-by');
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' },
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", appOrigin.replace(/^http/, 'ws')]
    }
  }
}));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three', 'build')));
app.use(express.static(path.join(root, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function issueSession(user, res) {
  const userId = user.id || user._id;
  if (!userId) throw new Error('Cannot create a session without a user ID.');
  const token = jwt.sign({ sub: String(userId) }, jwtSecret, { expiresIn: '7d' });
  res.cookie('kovai_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function publicUser(user) {
  return { name: user.name, email: user.email };
}

function requireSession(req, res, next) {
  const token = req.cookies?.kovai_session;
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    req.userId = jwt.verify(token, jwtSecret).sub;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
    next(error);
  }
}

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== appOrigin) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
});

app.post('/api/auth/signup', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = normalizeEmail(body.email);
    const password = body.password;
    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ error: 'Name must be between 2 and 40 characters.' });
    }
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes.' });
    }

    const user = await createUser({ name, email, passwordHash: await bcrypt.hash(password, 12) });
    issueSession(user, res);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
    next(error);
  }
});

app.post('/api/auth/signin', authLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = body.password;
    const user = validEmail(email) && typeof password === 'string'
      ? await findUserByEmail(email)
      : null;
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    issueSession(user, res);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/signout', (req, res) => {
  res.clearCookie('kovai_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
  res.status(204).end();
});

app.get('/api/auth/me', requireSession, async (req, res, next) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res, next) => {
  try {
    if (!mailer) {
      return res.status(503).json({ error: 'Password reset email is not configured. Set the SMTP settings in .env.' });
    }
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await findUserByEmail(email);
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await saveUser(user);
      const resetUrl = new URL('/', appOrigin);
      resetUrl.searchParams.set('reset', rawToken);
      await mailer.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: user.email,
        subject: 'Reset your Kovai Streets password',
        text: `Use this link within one hour to reset your password:\n\n${resetUrl.href}\n\nIf you did not request this, you can ignore this email.`
      });
    }
    res.json({ message: 'If an account exists for that email, a password reset link is on its way.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes.' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await findUserByResetToken(tokenHash);
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetTokenHash = null;
    user.resetExpiresAt = null;
    await saveUser(user);
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

io.use(async (socket, next) => {
  try {
    const token = cookie.parse(socket.handshake.headers.cookie || '').kovai_session;
    if (!token) return next(new Error('Please sign in to join the city.'));
    const claims = jwt.verify(token, jwtSecret);
    const user = await findUserById(claims.sub);
    if (!user) return next(new Error('Account not found. Please sign in again.'));
    socket.data.playerName = user.name;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) return next(new Error('Your session has expired. Please sign in again.'));
    next(error);
  }
});

function distanceBetweenPlayers(first, second) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(second.lat - first.lat);
  const dLon = radians(second.lon - first.lon);
  const arc = 2 * Math.asin(Math.sqrt(
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(dLon / 2) ** 2
  ));
  return arc * 6371000;
}

function arePlayersNearby(first, second, limit = 35) {
  return first && second && distanceBetweenPlayers(first, second) <= limit;
}

io.on('connection', socket => {
  socket.emit('voice:config', voiceIceServers);
  const player = {
    id: socket.id,
    name: socket.data.playerName,
    lat: PLAYER_START.lat,
    lon: PLAYER_START.lon,
    heading: 0,
    vehicle: false,
    speed: 0,
    passengerId: null,
    rideDriverId: null
  };
  activePlayers.set(socket.id, player);
  socket.emit('players:snapshot', [...activePlayers.values()].filter(item => item.id !== socket.id));
  socket.broadcast.emit('players:joined', player);

  let lastPositionAt = 0;
  socket.on('player:move', position => {
    const now = Date.now();
    if (now - lastPositionAt < 75 || !position ||
      !Number.isFinite(position.lat) || !Number.isFinite(position.lon) ||
      position.lat < 10.75 || position.lat > 11.15 ||
      position.lon < 76.65 || position.lon > 77.15) return;
    const latitudeRadians = player.lat * Math.PI / 180;
    const deltaLatitude = (position.lat - player.lat) * Math.PI / 180;
    const deltaLongitude = (position.lon - player.lon) * Math.PI / 180;
    const arc = 2 * Math.asin(Math.sqrt(
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(latitudeRadians) * Math.cos(position.lat * Math.PI / 180) * Math.sin(deltaLongitude / 2) ** 2
    ));
    const maxTravelMeters = 20 + (now - lastPositionAt) / 1000 * 16;
    if (arc * 6371000 > maxTravelMeters) return;
    lastPositionAt = now;
    player.lat = position.lat;
    player.lon = position.lon;
    if (Number.isFinite(position.heading)) player.heading = Math.atan2(Math.sin(position.heading), Math.cos(position.heading));
    if (typeof position.vehicle === 'boolean') player.vehicle = position.vehicle;
    if (Number.isFinite(position.speed)) player.speed = Math.max(-8, Math.min(30, position.speed));
    io.emit('players:update', player);
    if (player.passengerId) {
      const passenger = activePlayers.get(player.passengerId);
      if (passenger && player.vehicle) {
        passenger.lat = player.lat;
        passenger.lon = player.lon;
        passenger.heading = player.heading;
        passenger.vehicle = true;
        passenger.passenger = true;
        io.emit('players:update', passenger);
      } else if (passenger) {
        player.passengerId = null;
        passenger.rideDriverId = null;
        passenger.vehicle = false;
        passenger.passenger = false;
        io.to(passenger.id).emit('car:left');
        io.emit('players:update', passenger);
        io.to(socket.id).emit('car:left');
      } else {
        player.passengerId = null;
      }
    }
    const voicePeerId = socket.data.voicePeerId;
    const voicePeer = voicePeerId ? activePlayers.get(voicePeerId) : null;
    if (voicePeerId && !arePlayersNearby(player, voicePeer, 50)) {
      socket.data.voicePeerId = null;
      const voicePeerSocket = io.sockets.sockets.get(voicePeerId);
      if (voicePeerSocket) {
        voicePeerSocket.data.voicePeerId = null;
        voicePeerSocket.emit('voice:ended', { id: socket.id, name: player.name });
      }
      socket.emit('voice:ended', { id: voicePeerId, name: voicePeer?.name });
    }
  });

  socket.on('voice:invite', targetId => {
    const target = activePlayers.get(targetId);
    const targetSocket = typeof targetId === 'string' ? io.sockets.sockets.get(targetId) : null;
    if (typeof targetId !== 'string' || targetId === socket.id ||
      !arePlayersNearby(player, target, 35) || socket.data.voicePeerId || targetSocket?.data.voicePeerId) {
      socket.emit('voice:invite-failed', { message: 'That player is no longer nearby or is busy.' });
      return;
    }
    socket.data.pendingVoiceId = targetId;
    targetSocket.data.pendingVoiceId = socket.id;
    socket.to(targetId).emit('voice:incoming', { id: socket.id, name: player.name });
    socket.emit('voice:invite-sent', { id: targetId, name: target.name });
  });

  socket.on('voice:accept', callerId => {
    const caller = activePlayers.get(callerId);
    if (socket.data.pendingVoiceId !== callerId || !arePlayersNearby(player, caller, 35)) return;
    const callerSocket = io.sockets.sockets.get(callerId);
    if (!callerSocket || callerSocket.data.voicePeerId || socket.data.voicePeerId) return;
    socket.data.pendingVoiceId = null;
    callerSocket.data.pendingVoiceId = null;
    callerSocket.data.voicePeerId = socket.id;
    socket.data.voicePeerId = callerId;
    io.to(callerId).emit('voice:accepted', { id: socket.id, initiator: true });
    socket.emit('voice:accepted', { id: callerId, initiator: false });
  });

  socket.on('voice:reject', callerId => {
    if (socket.data.pendingVoiceId !== callerId) return;
    socket.data.pendingVoiceId = null;
    const callerSocket = io.sockets.sockets.get(callerId);
    if (callerSocket?.data.pendingVoiceId === socket.id) callerSocket.data.pendingVoiceId = null;
    io.to(callerId).emit('voice:rejected', { id: socket.id, name: player.name });
  });

  socket.on('voice:cancel', targetId => {
    if (socket.data.pendingVoiceId !== targetId) return;
    socket.data.pendingVoiceId = null;
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket?.data.pendingVoiceId === socket.id) targetSocket.data.pendingVoiceId = null;
    io.to(targetId).emit('voice:cancelled', { id: socket.id });
  });

  socket.on('voice:signal', ({ targetId, signal } = {}) => {
    const target = activePlayers.get(targetId);
    if (socket.data.voicePeerId !== targetId || io.sockets.sockets.get(targetId)?.data.voicePeerId !== socket.id ||
      !arePlayersNearby(player, target, 50) || !signal ||
      !['offer', 'answer', 'candidate'].includes(signal.type)) return;
    io.to(targetId).emit('voice:signal', { id: socket.id, signal });
  });

  socket.on('voice:end', () => {
    socket.data.pendingVoiceId = null;
    const peerId = socket.data.voicePeerId;
    if (!peerId) return;
    socket.data.voicePeerId = null;
    const peerSocket = io.sockets.sockets.get(peerId);
    if (peerSocket) {
      peerSocket.data.voicePeerId = null;
      peerSocket.emit('voice:ended', { id: socket.id });
    }
  });

  socket.on('car:request', driverId => {
    const driver = activePlayers.get(driverId);
    if (typeof driverId !== 'string' || driverId === socket.id || !driver?.vehicle || driver.passenger ||
      driver.passengerId || player.rideDriverId || !arePlayersNearby(player, driver, 18)) return;
    const driverSocket = io.sockets.sockets.get(driverId);
    if (!driverSocket) return;
    driverSocket.data.pendingRideId = socket.id;
    io.to(driverId).emit('car:ride-requested', { id: socket.id, name: player.name });
    socket.emit('car:request-sent', { id: driverId, name: driver.name });
  });

  socket.on('car:invite', passengerId => {
    const passenger = activePlayers.get(passengerId);
    const passengerSocket = typeof passengerId === 'string' ? io.sockets.sockets.get(passengerId) : null;
    if (!player.vehicle || player.passengerId || passenger?.vehicle || passenger?.rideDriverId ||
      !arePlayersNearby(player, passenger, 18) || !passengerSocket) return;
    passengerSocket.data.pendingRideId = socket.id;
    io.to(passengerId).emit('car:ride-invited', { id: socket.id, name: player.name });
  });

  socket.on('car:decline', driverId => {
    if (socket.data.pendingRideId !== driverId) return;
    socket.data.pendingRideId = null;
    io.to(driverId).emit('car:ride-declined', { id: socket.id, name: player.name });
  });

  socket.on('car:accept', passengerId => {
    const passenger = activePlayers.get(passengerId);
    const passengerSocket = typeof passengerId === 'string' ? io.sockets.sockets.get(passengerId) : null;
    const isDriverAcceptingRequest = player.vehicle && socket.data.pendingRideId === passengerId;
    const isPassengerAcceptingInvite = player.rideDriverId === null && socket.data.pendingRideId === passengerId &&
      passenger?.vehicle;
    if ((!isDriverAcceptingRequest && !isPassengerAcceptingInvite) || !passengerSocket) return;
    const driver = isDriverAcceptingRequest ? player : passenger;
    const rider = isDriverAcceptingRequest ? passenger : player;
    const driverSocket = isDriverAcceptingRequest ? socket : passengerSocket;
    const riderSocket = isDriverAcceptingRequest ? passengerSocket : socket;
    if (driver.passengerId || rider.rideDriverId || rider.vehicle ||
      !arePlayersNearby(driver, rider, 18)) return;
    driverSocket.data.pendingRideId = null;
    riderSocket.data.pendingRideId = null;
    driver.passengerId = rider.id;
    rider.rideDriverId = driver.id;
    rider.lat = driver.lat;
    rider.lon = driver.lon;
    rider.heading = driver.heading;
    rider.vehicle = true;
    rider.passenger = true;
    io.emit('players:update', driver);
    io.emit('players:update', rider);
    io.to(driver.id).emit('car:joined', { role: 'driver', otherId: rider.id, otherName: rider.name });
    io.to(rider.id).emit('car:joined', { role: 'passenger', otherId: driver.id, otherName: driver.name, ...driver });
  });

  socket.on('car:leave', () => {
    const driverId = player.rideDriverId || socket.id;
    const driver = activePlayers.get(driverId);
    const passengerId = player.rideDriverId ? socket.id : player.passengerId;
    const passenger = activePlayers.get(passengerId);
    if (driver) driver.passengerId = null;
    if (passenger) {
      passenger.rideDriverId = null;
      passenger.vehicle = false;
      passenger.passenger = false;
      io.to(passengerId).emit('car:left');
      io.emit('players:update', passenger);
    }
    if (driver) io.to(driverId).emit('car:left');
  });

  socket.on('player:return-to-start', () => {
    player.lat = PLAYER_START.lat;
    player.lon = PLAYER_START.lon;
    player.heading = 0;
    player.vehicle = false;
    player.speed = 0;
    lastPositionAt = Date.now();
    io.emit('players:update', player);
  });

  socket.on('disconnect', () => {
    const pendingVoiceId = socket.data.pendingVoiceId;
    if (pendingVoiceId) {
      const pendingVoiceSocket = io.sockets.sockets.get(pendingVoiceId);
      if (pendingVoiceSocket?.data.pendingVoiceId === socket.id) {
        pendingVoiceSocket.data.pendingVoiceId = null;
        pendingVoiceSocket.emit('voice:cancelled', { id: socket.id });
      }
    }
    const voicePeerId = socket.data.voicePeerId;
    if (voicePeerId) {
      const peerSocket = io.sockets.sockets.get(voicePeerId);
      if (peerSocket) {
        peerSocket.data.voicePeerId = null;
        peerSocket.emit('voice:ended', { id: socket.id });
      }
    }
    if (player.rideDriverId) {
      const driver = activePlayers.get(player.rideDriverId);
      if (driver) driver.passengerId = null;
      io.to(player.rideDriverId).emit('car:left');
    }
    if (player.passengerId) {
      const passenger = activePlayers.get(player.passengerId);
      if (passenger) {
        passenger.rideDriverId = null;
        passenger.vehicle = false;
        passenger.passenger = false;
        io.to(passenger.id).emit('car:left');
        io.emit('players:update', passenger);
      }
    }
    activePlayers.delete(socket.id);
    io.emit('players:left', socket.id);
  });
});

await connectDatabase();
await seedDevelopmentTestAccount();
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
} catch (error) {
  if (process.env.MONGODB_URI) await mongoose.disconnect();
  if (error.code === 'EADDRINUSE') {
    throw new Error(`Port ${port} is already in use. Stop the other app or choose another PORT in .env.`);
  }
  throw error;
}
console.log(`Kovai Streets is running at ${appOrigin}`);

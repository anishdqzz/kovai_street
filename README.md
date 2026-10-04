# Kovai Streets

A browser-based, third-person 3D multiplayer city exploration game set in Coimbatore. The camera follows a visible walking character through streets with sidewalks, shopfronts, a tea kadai, a temple, a bus stop, a moving town bus, and pedestrians. The scene uses live OpenStreetMap tiles, streamed 3D buildings, a driveable car, and landmarks positioned at their Coimbatore coordinates. Walk using **W/S**, turn with **A/D**, sprint with **Shift**, jump with **Space**, and press **E** near the car to drive. Use the touch controls on phones. The zoom buttons move the third-person camera closer or further away.

The game map uses OpenStreetMap tiles and includes a curated city-wide directory of 51 Coimbatore neighbourhoods, colleges, temples, shops, markets, hospitals, bus stops, railway stations, and landmarks as discoverable destinations. The heading-up navigation mini-map resembles a compact in-car HUD: it shows local streets, a highlighted destination route, the player's direction, nearby places, other signed-in players, and an online-player count. Streamed districts also have connected, cross-tile 3D roads, sidewalks, lane markings, and collision-aware building placement. The destination list includes Rathinam Technical Campus, Sri Krishna College, Saaji Dress Shop in Kuniyamuthur, Ukkadam/Aathupalam, Town Hall, Pothys, Chennai Silks, and Koniamman Temple. Nearby destinations are represented by category-based 3D landmark models; these are game approximations, not photogrammetric replicas of the real buildings. The Coimbatore Airport landmark includes a long runway, terminal, and animated passenger plane. Coimbatore Junction has two animated game trains between Coimbatore and Palakkad, with Tamil/Malayalam route signage. The Ukkadam bus stand and Aathupalam crossing are modelled as 3D stops; an elevated flyover follows the Ukkadam–Kuniyamuthur corridor. Trees, flowers, pedestrians, NPC motorcycles, a temple elephant, a cow, and dogs populate the streets; pedestrians and dogs move aside from the player's vehicle. Building collisions prevent walking and driving through solid walls. Procedural Web Audio provides footsteps, jump, car, bus, motorcycle, train, and airplane sounds and can be muted in-game. Car steering, acceleration, braking, reverse, and turning are speed-sensitive. The underlying street map is continuous, so players can explore beyond the listed places. Place coordinates for named features use OpenStreetMap where mapped; Saaji Dress Shop and Aathupalam are placed approximately within their requested neighbourhoods.

Players within a short distance can request one-to-one voice chat or ask to ride in/invite someone into a driven car. Voice uses browser WebRTC and requires HTTPS plus microphone permission from both players; browser/network restrictions can prevent peer-to-peer audio without a TURN relay. The passenger view follows the driver's live position. On phones, the destination strip is compact, with touch movement and car controls.

## Run locally

Requirements: Node.js 20+. The game can run locally without installing MongoDB; it saves development accounts in `.data/users.json`. For deployment or shared accounts across servers, use MongoDB Atlas or a MongoDB instance.

1. Run `npm install`.
2. Run `npm start` and open the URL printed in the terminal (the server selects an available port starting at 4173).

For a local test, the development server creates **`admin@gmail.com` / `admin`** automatically. This low-security test password is never seeded in production; use it only on your local development server.

To connect MongoDB Atlas, create a database user and allow your server's IP in Atlas Network Access. Copy `.env.example` to `.env` and set `MONGODB_URI` to the Atlas connection string, replacing its username, password, and database placeholders with your values. Keep `.env` private and restart the server. The connection URI must be in `.env`, not just `.env.example`. Set a unique `JWT_SECRET` of at least 32 characters and configure `APP_ORIGIN` before deployment. Production mode refuses to start without a MongoDB connection string and a configured JWT secret. An Atlas database user is only for the server-to-database connection; each player must separately sign up or sign in through the game's login page. The server authenticates each Socket.IO connection with the player's game session. Online positions are broadcast live from the running Node.js process and are intentionally kept in server memory, not saved in MongoDB; all players must connect to the same deployed server to see each other.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in `.env` with an email provider to enable password-reset emails. The real-time player map is served by the same Node.js process.

Password reset uses one-time links that expire after one hour. Without SMTP configured, sign-in and signup continue to work, but password-reset requests return a configuration error.

## Deploy with Render

Vercel's serverless functions do not keep the Socket.IO server running for live multiplayer. Use a persistent Node.js web service instead. This repository includes a `render.yaml` Blueprint for Render:

1. In MongoDB Atlas, create a new database user and ensure the cluster is running. Allow the Render service to connect through Atlas Network Access; prefer the hosting provider's outbound IPs when available.
2. In Render, choose **New → Blueprint**, connect the `anishdqzz/kovai_street` GitHub repository, and deploy the `render.yaml` service.
3. In the Render service's environment settings, set `MONGODB_URI` to the new Atlas connection URI, including your intended database name. Render generates `JWT_SECRET`; keep it private. `APP_ORIGIN` can be left unset because the server uses Render's external URL.
4. Redeploy, then open the Render URL and test signup/sign-in and live players from two browsers.
5. Share the Render URL with friends. They must all use this same URL to join the same live game.

Do not commit `.env` or paste database credentials into GitHub, chat, or screenshots. If a database credential was ever committed to a public repository, rotate that database user's password in Atlas immediately and update the hosting secret.

## Map attribution

Map tiles are provided by [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. An internet connection is needed to load the street map.

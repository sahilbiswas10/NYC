# NYC

NYC is a full-stack learning management system built with HTML, CSS, vanilla JavaScript, Node.js, Express, MongoDB/Mongoose, and a self-hosted FFmpeg/HLS media pipeline.

## Requirements

- Node.js 18 or newer and npm
- MongoDB, either local or MongoDB Atlas
- FFmpeg installed and available on `PATH` for video/audio processing

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create your local environment file:

   ```sh
   cp .env.example .env
   ```

   Set `MONGO_URI` to your own MongoDB database. Set `JWT_SECRET` to a long, random value for any deployed environment. Do not commit `.env`.

3. Start the server:

   ```sh
   npm start
   ```

   The Express server serves both the website and API at `http://localhost:5000` by default. Check the API and database connection at `http://localhost:5000/api/health`.

4. To create the first administrator, follow [ADMIN_SETUP.md](ADMIN_SETUP.md). The bootstrap command requires credentials supplied through environment variables and will not create or change an administrator if one already exists.

## Payments

Paid course checkout requires Razorpay server credentials. Configure them in the server environment using [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md). Use test-mode credentials while developing.

## Media storage

Uploaded originals, generated HLS playlists/segments, course images, instructor photos, and module notes are stored under `storage/`. This directory is intentionally excluded from Git. Back it up separately if you need to preserve uploaded content. For production, use a host with persistent disk storage or adapt storage to a durable private object store while preserving the protected streaming routes.

## Deployment note

GitHub Pages can host static files only; it cannot run this Express server, connect to MongoDB, process uploads with FFmpeg, or protect HLS streams. Use GitHub to store the source code, then deploy the Node.js app to a server that supports Node.js, MongoDB connectivity, FFmpeg, environment variables, and persistent media storage. Do not expose MongoDB or payment secrets in frontend code.

## Repository hygiene

`.env`, the local JWT key, installed packages, and uploaded/generated media are excluded by `.gitignore`. Copy `.env.example` for local setup and put production secrets in your hosting provider's environment settings.

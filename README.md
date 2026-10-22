
# Dugout Hitting League

A comprehensive management system for youth baseball hitting leagues, designed for 3v3 match scoring, team management, and real-time statistical analysis.

## Features

### ⚾ League & Season Management
- **Multi-Year Support:** Automated season lifecycles with dynamic archiving, seamless transitions across any future year (e.g., 2026, 2027, 2028+), and automatic division rollover with preserved historical records.
- **Dynamic Leagues:** Create custom leagues (9u, 10u, Varsity, etc.) on the fly per season.
- **Season Isolation:** Historical seasons remain immutable in archives while active seasons operate with fresh rosters and schedules.

### 👥 Role-Based Access Control
- **Fan Mode (Default):** Read-only access. Fans can view live scores (auto-refreshing), standings, and season stats without logging in.
- **Umpire Mode:** Password-protected. Allows starting matches, scoring games, and editing rosters.
- **Admin Mode:** Password-protected. Full control to create leagues, reset seasons, manage passwords, and export data.

### 📝 Match Scoring & Roster Logic
- **Flexible Lineups:** Supports standard 3-player teams and 2-player short-handed teams.
- **2-Player Ghost Logic:** In 2-player mode, players get 15 pitches. Pitches 1-10 count for the player; pitches 11-15 are automatically attributed to a "Ghost" Player 3 for team totals.
- **Substitutes:** Ability to add one-time substitutes or "Restore Roster" mid-game if a late player arrives (resetting the scoring format for the remainder of the game).
- **Live Scoreboard:** Color-coded pitch results (4s, 3s, 2s, 1s, 0s) with distinct visuals.

### 📊 Statistics & AI
- **Automatic Standings:** Real-time calculation of Wins, Losses, Ties, Points For, and Points Against.
- **Player Leaderboards:** Sortable season stats for Total Points, Hit Types (4/3/2/1), and Pitches Seen.
- **AI Reports:** Integration with Google Gemini to generate executive summaries of league activity.

---

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS
- **Backend:** Vercel Serverless Functions (Node.js)
- **Database:** Neon (PostgreSQL)
- **AI:** Google Gemini API

---

## Local Development Setup

### 1. Prerequisites
- Node.js installed
- Vercel CLI installed globally: `npm i -g vercel`
- A Neon PostgreSQL database
- A Google Gemini API Key

### 2. Installation
```bash
git clone <your-repo-url>
cd dugout-hitting-league
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory:
```env
DATABASE_URL="postgres://user:password@your-neon-db-url.neondatabase.app/neondatabase?sslmode=require"
API_KEY="your_google_gemini_api_key"
```

### 4. Database Initialization
The application uses **Lazy Migrations**. You do not need to run a manual SQL script. 
The first time you run the app and hit an API endpoint (like creating a league or loading teams), the backend will automatically create the necessary tables (`leagues`, `teams`, `matches`, `app_settings`) if they don't exist.

### 5. Running the App
**Important:** Do not use `npm run dev`. You must use the Vercel CLI to emulate the serverless backend locally.

```bash
vercel dev
```
Access the app at `http://localhost:3000`.

---

## Deployment (Vercel)

1. Push your code to a GitHub repository.
2. Log in to Vercel and click **"Add New Project"**.
3. Import your repository.
4. **Framework Preset:** Select **Vite**.
5. **Environment Variables:** Add the following in the Vercel Project Settings:
   - `DATABASE_URL`: Your Neon connection string.
   - `API_KEY`: Your Google Gemini API key.
6. Click **Deploy**.

---

## Usage Guide

### Default Passwords
When the database is first initialized, the default passwords are:
- **Admin:** `admin`
- **Umpire:** `umpire`
*These can be changed in the Admin Dashboard.*

### 2-Player Mode Scoring
When scoring a game with only 2 players:
1. The scoreboard will generate a 3rd row labeled "Player 3".
2. Player 1 hits 15 times. 
   - Inputs 1-10 appear on Player 1's row.
   - Inputs 11-15 appear on the Ghost Row (Slots 1-5).
3. Player 2 hits 15 times.
   - Inputs 1-10 appear on Player 2's row.
   - Inputs 11-15 appear on the Ghost Row (Slots 6-10).
4. The system automatically attributes the ghost row points to "Player 3 (Team Stats)" for statistical purposes.

### Late Player Arrival
If a 3rd player arrives during a 2-player game:
1. In the Scoreboard, click **"+ Player Arrived? (Reset)"** (Visible in Innings 2-6).
2. This resets the scoring format to standard 3-player/10-pitch mode for the **remainder** of the game.
3. Stats for the new innings will be attributed correctly to the individual players.

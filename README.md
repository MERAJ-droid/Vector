<div align="center">
  <br />
  <h1>⚡ Vector</h1>
  <p>
    <strong>A high-performance, real-time collaborative code editor built for the web.</strong>
  </p>
  <br />
</div>

## ✨ Overview

Vector is a production-ready, real-time collaborative code editor designed to provide a seamless pair-programming experience. Built on top of the powerful Monaco Editor (the engine behind VS Code) and powered by Conflict-free Replicated Data Types (CRDTs), Vector ensures conflict-free syncing across multiple clients with zero merge conflicts.

With a robust architecture utilizing WebSockets, Redis, and PostgreSQL, Vector guarantees low-latency collaboration, resilient state recovery, and persistent document history.

## 🚀 Key Features

- **Real-Time Collaboration:** Millisecond-latency code synchronization using Yjs and WebSockets.
- **Monaco Editor Engine:** Full syntax highlighting, auto-completion, and VS Code-like keybindings.
- **Live Cursors & Awareness:** See exactly where your teammates are typing in real-time.
- **Robust Persistence:** Two-tier caching strategy (Redis for hot state, Supabase PostgreSQL for persistent truth) ensuring data integrity and fast cold starts.
- **Version History & Checkpoints:** Intelligent auto-saving and checkpointing system allowing you to restore previous document states.
- **Modern IDE Interface:** Complete with an Activity Bar, File Explorer, Editor Tabs, and Search Panel for a familiar developer experience.

## 🛠️ Tech Stack

### Frontend
- **React 18** — Component architecture and UI state
- **Monaco Editor** — Core editing engine
- **Yjs & y-monaco** — CRDT implementation and editor binding

### Backend
- **Node.js & Express** — RESTful API services
- **y-websocket** — Real-time collaboration server
- **Redis** — High-throughput, low-latency CRDT state caching
- **Supabase (PostgreSQL)** — Persistent storage and version history

## 🏗️ Architecture Highlight

Vector's synchronization architecture is built to handle connection drops, tab-switching, and concurrent room loads elegantly:
- **Non-Blocking Staleness Eviction:** Validates Redis state against PostgreSQL asynchronously, preventing connection timeouts during cold starts.
- **Strict Binding Lifecycle:** Enforces a single-owner model for editor bindings, utilizing React 18 strict mode and keyed component unmounting to prevent memory leaks and cross-file state bleeding.
- **Atomic Operations:** Uses Redis pipelines and PostgreSQL `pgcrypto` hashes to maintain strict synchronization integrity between the caching layer and the database.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Redis instance
- PostgreSQL (Supabase recommended)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/MERAJ-droid/Vector.git
   cd Vector
   ```

2. **Install dependencies:**
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the root directory and configure your database and Redis URLs (see `server/.env.example`).

4. **Run the services:**
   Open three terminal windows and run the following:
   ```bash
   # Terminal 1: REST API
   cd server && npm run dev

   # Terminal 2: YJS Collaboration Server
   cd server && npm run dev:yjs

   # Terminal 3: React Client
   cd client && npm start
   ```

## 📜 License

This project is licensed under the MIT License.

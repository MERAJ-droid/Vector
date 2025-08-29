<!-- # Vector - Real-Time Collaborative Code Editor

A modern, real-time collaborative code editor built with Node.js, React, and PostgreSQL.

## 🚀 Features

- **Real-time Collaboration**: Multiple users can edit the same file simultaneously
- **Project Management**: Create and organize coding projects
- **File Management**: Create, edit, and manage files within projects
- **User Authentication**: Secure JWT-based authentication system
- **Monaco Editor**: Powered by the same editor as VS Code
- **WebSocket Support**: Real-time updates via Socket.IO
- **Phase 2 Ready**: Prepared for Yjs CRDT integration

## 🛠️ Tech Stack

### Backend
- **Node.js** with **TypeScript**
- **Express.js** for REST APIs
- **PostgreSQL** for data persistence
- **Socket.IO** for real-time communication
- **JWT** for authentication
- **bcrypt** for password hashing

### Frontend (Coming Soon)
- **React** with **TypeScript**
- **Monaco Editor** for code editing
- **Socket.IO Client** for real-time features

## 📁 Project Structure

```
vector/
├── .env                          # Environment variables
├── server/                       # Backend Node.js server
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts       # PostgreSQL connection
│   │   ├── middleware/
│   │   │   └── auth.ts           # JWT authentication
│   │   ├── routes/
│   │   │   ├── auth.ts           # Authentication routes
│   │   │   ├── files.ts          # File management
│   │   │   └── projects.ts       # Project management
│   │   └── index.ts              # Server entry point
│   ├── package.json
│   └── tsconfig.json
└── client/                       # Frontend React app (TBD)
```

## 🗄️ Database Schema

### Users
- `id`, `username`, `email`, `password_hash`, `created_at`

### Projects
- `id`, `owner_id`, `project_name`, `created_at`, `updated_at`

### Files
- `id`, `project_id`, `filename`, `content`, `is_collaborative`, `language`, `created_at`, `updated_at`

### Yjs Snapshots (Phase 2)
- `id`, `file_id`, `snapshot_data`, `sequence_number`, `created_at`

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd vector
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Install backend dependencies**
   ```bash
   cd server
   npm install
   ```

4. **Set up PostgreSQL database**
   - Create a database named `vector`
   - Run the SQL schema (provided separately)

5. **Start the development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:5000`

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Projects
- `GET /api/projects` - Get user projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project details
- `GET /api/projects/:id/files` - Get project files
- `POST /api/projects/:id/files` - Create file in project

### Files
- `GET /api/files/:id` - Get file content
- `PUT /api/files/:id` - Update file content
- `POST /api/files/:id/snapshot` - Save Yjs snapshot (Phase 2)
- `GET /api/files/:id/snapshot` - Get Yjs snapshot (Phase 2)

### Health
- `GET /api/health` - Server health check

## 🔌 WebSocket Events

- `join-file` - Join file room for collaboration
- `leave-file` - Leave file room
- `text-change` - Broadcast text changes (Phase 1)

## 🗺️ Roadmap

### Phase 1 (Current) ✅
- [x] Backend API with authentication
- [x] Basic project and file management
- [x] Simple real-time text sync
- [x] Database schema and connection
- [ ] Frontend React application
- [ ] Monaco Editor integration

### Phase 2 (Future)
- [ ] Yjs CRDT integration
- [ ] Advanced collaborative features
- [ ] Conflict resolution
- [ ] User presence indicators
- [ ] File permissions and sharing

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with inspiration from VS Code and collaborative editors
- Monaco Editor for the excellent code editing experience
- Yjs for future CRDT implementation -->

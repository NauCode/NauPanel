# Naupanel

Panel Minecraft perso (Angular + Express + Docker).

## 📁 Structure

```
naupanel/
├── frontend/          # App Angular LTS
├── backend/           # API REST + WebSocket (Express + TypeScript)
├── docker/            # Dockerfiles et docker-compose
└── README.md
```

## 🚀 Installation & Lancer le projet

### Dev (sans Docker)

```bash
# Backend (Terminal 1)
cd backend
npm install
npm run dev

# Frontend (Terminal 2)
cd frontend
npm install
npm start
```

Backend accessible : `http://localhost:3000`  
Frontend accessible : `http://localhost:4200`

### Docker

```bash
cd docker
docker-compose up --build
```

## 📡 Routes Backend (API)

- `GET /api/health` - Health check

## 🛣️ Frontend Routes

À configurer dans `src/app/app.routes.ts`

## 📝 Prochaines étapes

1. ✅ Monorepo init
2. ✅ Backend Express + TypeScript
3. ✅ Frontend Angular LTS
4. ✅ Docker setup
5. ✅ Server status endpoint
6. ✅ Console WebSocket
7. ✅ File management
8. 🔳 Backups

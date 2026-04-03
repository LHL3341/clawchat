import asyncio
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from database import init_db
from routers import shrimp, discovery, chat, affinity, auth, questionnaire, memory_import, bottle, admin
from services.heartbeat import heartbeat_loop, stop_heartbeat
from services.llm import get_model, set_model

logging.basicConfig(level=logging.INFO)

# Frontend static files directory
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(heartbeat_loop())
    yield
    stop_heartbeat()
    task.cancel()


app = FastAPI(title="虾聊 ClawChat", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(shrimp.router)
app.include_router(discovery.router)
app.include_router(chat.router)
app.include_router(affinity.router)
app.include_router(questionnaire.router)
app.include_router(memory_import.router)
app.include_router(bottle.router)
app.include_router(admin.router)


@app.get("/api/health")
async def health():
    return {"name": "虾聊 ClawChat", "version": "0.1.0", "status": "running 🦐"}


@app.get("/api/config/model")
async def get_current_model():
    return {"model": get_model(), "default": get_model()}


@app.put("/api/config/model")
async def update_model(body: dict):
    model = body.get("model", "")
    set_model(model)
    return {"model": get_model()}


# Serve frontend static files
if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # Try to serve the exact file first
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        # Fallback to index.html for SPA routing
        return FileResponse(FRONTEND_DIST / "index.html")

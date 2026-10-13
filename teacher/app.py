"""Local-only Teacher HTTP API and static Studio UI."""
from __future__ import annotations
from contextlib import asynccontextmanager
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import secrets
from urllib.parse import urlsplit
from fastapi import FastAPI, File, UploadFile, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool
from teacher import config
from teacher.models import StrictModel, Settings, SourceModel, Question, Blueprint, Profile
from teacher.provider import ProviderError
from teacher.publishing import now_iso
from teacher.service import TeacherService
from teacher.store import JobStore, expected_revision, StaleRevisionError

class SourceEdit(StrictModel):
    sourceModel: SourceModel
class QuestionEdit(StrictModel):
    question: Question
    enabled: bool = True
class BlueprintEdit(StrictModel):
    blueprint: Blueprint
class Approval(StrictModel):
    acknowledgeWarnings: bool = False
class ProfileEdit(Profile):
    createdAt: str = Field(default_factory=now_iso)

class RequestTooLarge(HTTPException):
    def __init__(self):
        super().__init__(status_code=413,detail="Die Anfrage überschreitet das Größenlimit.")

class BodyLimitMiddleware:
    def __init__(self, app, limit: int):
        self.app,self.limit=app,limit
    async def __call__(self,scope,receive,send):
        if scope["type"]!="http":
            return await self.app(scope,receive,send)
        headers=dict(scope.get("headers",[]))
        try:
            announced=int(headers.get(b"content-length",b"0"))
        except ValueError:
            announced=self.limit+1
        if announced>self.limit:
            return await JSONResponse({"detail":"Die Anfrage ist zu groß (maximal 45 MiB Quelldateien)."},status_code=413)(scope,receive,send)
        count=0
        started=False
        async def limited_receive():
            nonlocal count
            event=await receive()
            count+=len(event.get("body",b""))
            if count>self.limit:
                raise RequestTooLarge()
            return event
        async def observed_send(event):
            nonlocal started
            if event["type"]=="http.response.start":
                started=True
            await send(event)
        try:
            return await self.app(scope,limited_receive,observed_send)
        except RequestTooLarge:
            if not started:
                await JSONResponse({"detail":"Die Anfrage überschreitet das Größenlimit."},status_code=413)(scope,receive,send)


def create_app(*, data_dir: Path | None = None, content_dir: Path | None = None, provider=None) -> FastAPI:
    store=JobStore(data_dir or config.DATA_DIR)
    service=TeacherService(store,content_dir or config.CONTENT_DIR,provider)
    token=secrets.token_urlsafe(32)
    logger=logging.getLogger("teacher")
    if not any(isinstance(h,RotatingFileHandler) and h.baseFilename==str(store.directory/"teacher.log") for h in logger.handlers):
        handler=RotatingFileHandler(store.directory/"teacher.log",maxBytes=1_000_000,backupCount=3,encoding="utf-8")
        handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    app=FastAPI(title="École Teacher Studio",docs_url=None,redoc_url=None,openapi_url=None)
    app.state.service=service
    app.state.csrf_token=token
    app.add_middleware(BodyLimitMiddleware,limit=config.MAX_TOTAL_BYTES+1024*1024)
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=["localhost","127.0.0.1","[::1]"])

    @app.middleware("http")
    async def local_security(request: Request,call_next):
        origin=request.headers.get("origin")
        if origin:
            parsed=urlsplit(origin)
            if parsed.scheme not in ("http","https") or parsed.netloc!=request.headers.get("host") or parsed.path or parsed.query or parsed.fragment:
                return JSONResponse({"detail":"Zugriff ist nur aus dem lokalen Teacher Studio möglich."},status_code=403)
        if request.method not in ("GET","HEAD","OPTIONS"):
            if request.headers.get("sec-fetch-site")=="cross-site" or not secrets.compare_digest(request.headers.get("x-csrf-token",""),token):
                return JSONResponse({"detail":"Die lokale Sitzung ist abgelaufen. Bitte Teacher Studio neu laden."},status_code=403)
        revision_token=expected_revision.set(request.headers.get("x-job-revision") if request.method not in ("GET","HEAD","OPTIONS") else None)
        try:
            response=await call_next(request)
        finally:
            expected_revision.reset(revision_token)
        response.headers["X-Content-Type-Options"]="nosniff"
        response.headers["X-Frame-Options"]="DENY"
        response.headers["Referrer-Policy"]="no-referrer"
        response.headers["Cache-Control"]="no-store"
        response.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
        return response

    @app.exception_handler(RequestValidationError)
    async def request_error(request,error):
        locations=[".".join(map(str,item["loc"])) for item in error.errors()[:5]]
        return JSONResponse({"detail":"Bitte die Eingaben prüfen: "+", ".join(locations)},status_code=422)

    @app.exception_handler(StaleRevisionError)
    async def stale_error(request,error):
        return JSONResponse({"detail":str(error)},status_code=409)

    @app.exception_handler(ValueError)
    async def expected_error(request,error):
        logger.warning(json.dumps({"event":"request_rejected","path":request.url.path,"errorType":type(error).__name__}))
        return JSONResponse({"detail":str(error)},status_code=422)

    @app.exception_handler(FileNotFoundError)
    async def missing_error(request,error):
        return JSONResponse({"detail":str(error)},status_code=404)

    @app.exception_handler(Exception)
    async def unexpected_error(request,error):
        logger.error(json.dumps({"event":"request_failed","path":request.url.path,"errorType":type(error).__name__}))
        return JSONResponse({"detail":"Der lokale Vorgang konnte nicht abgeschlossen werden. Entwurf bleibt gespeichert; Details stehen im lokalen Teacher-Log."},status_code=500)

    @app.get("/api/config")
    def get_config():
        return {"model":getattr(service.provider,"model",config.MODEL),"keyConfigured":bool(os.environ.get("OPENAI_API_KEY","").strip()),"csrfToken":token,"limits":{"maxFileBytes":config.MAX_FILE_BYTES,"maxTotalBytes":config.MAX_TOTAL_BYTES,"maxFiles":config.MAX_FILES,"maxPdfPages":config.MAX_PDF_PAGES,"extensions":sorted(config.ALLOWED_EXTENSIONS)},"durations":config.DURATIONS,"difficultyFactors":config.DIFFICULTY_FACTORS}

    @app.get("/api/profiles")
    def profiles(): return store.profiles()
    @app.post("/api/profiles",status_code=201)
    def create_profile(profile: ProfileEdit): return store.save_profile(profile,create=True)
    @app.put("/api/profiles/{profile_id}")
    def edit_profile(profile_id: str,profile: ProfileEdit):
        if profile.id!=profile_id:
            raise ValueError("Profil-ID darf nicht verändert werden.")
        return store.save_profile(profile)
    @app.get("/api/jobs")
    def jobs(): return store.list()
    @app.post("/api/jobs",status_code=201)
    def create_job(settings: Settings): return service.create_job(settings)
    @app.get("/api/jobs/{job_id}")
    def job(job_id: str): return store.load(job_id)
    @app.post("/api/jobs/{job_id}/sources")
    async def upload(job_id: str, files: list[UploadFile] = File()):
        if len(files)>config.MAX_FILES:
            raise ValueError("Höchstens 20 Dateien pro Auftrag.")
        uploaded=[]
        try:
            for file in files:
                uploaded.append((file.filename or "",await file.read(config.MAX_FILE_BYTES+1)))
        finally:
            for file in files:
                await file.close()
        return await run_in_threadpool(service.add_sources,job_id,uploaded)
    @app.delete("/api/jobs/{job_id}/sources/{file_id}")
    def remove(job_id: str,file_id: str): return service.remove_source(job_id,file_id)
    @app.get("/api/jobs/{job_id}/sources/{file_id}")
    def get_source(job_id: str,file_id: str):
        job=store.load(job_id)
        source=next((item for item in job.sources if item.id==file_id),None)
        if source is None:
            raise FileNotFoundError("Datei nicht gefunden.")
        return FileResponse(store.source_path(job_id,source),media_type=source.mediaType,filename=source.filename,content_disposition_type="inline")
    @app.post("/api/jobs/{job_id}/extract")
    def extract(job_id: str): return service.extract(job_id)
    @app.put("/api/jobs/{job_id}/source")
    def edit_source(job_id: str,body: SourceEdit): return service.edit_source(job_id,body.sourceModel)
    @app.post("/api/jobs/{job_id}/confirm-source")
    def confirm(job_id: str): return service.confirm_source(job_id)
    @app.post("/api/jobs/{job_id}/generate")
    def generate(job_id: str): return service.generate(job_id)
    @app.post("/api/jobs/{job_id}/validate")
    def validate(job_id: str): return service.validate(job_id)
    @app.put("/api/jobs/{job_id}/questions/{question_id}")
    def edit_question(job_id: str,question_id: str,body: QuestionEdit): return service.edit_question(job_id,question_id,body.question,body.enabled)
    @app.post("/api/jobs/{job_id}/questions/{question_id}/regenerate")
    def regenerate(job_id: str,question_id: str): return service.regenerate(job_id,question_id)
    @app.put("/api/jobs/{job_id}/blueprint")
    def blueprint(job_id: str,body: BlueprintEdit): return service.set_blueprint(job_id,body.blueprint)
    @app.post("/api/jobs/{job_id}/approve")
    def approve(job_id: str,body: Approval): return service.approve(job_id,body.acknowledgeWarnings)
    @app.post("/api/jobs/{job_id}/publish")
    def publish(job_id: str): return service.publish(job_id)

    static=Path(__file__).parent/"static"
    if static.exists():
        app.mount("/",StaticFiles(directory=static,html=True),name="studio")
    return app

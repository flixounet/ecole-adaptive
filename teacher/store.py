"""Private local authoring state; atomic snapshots, no personal data in static assets."""
from pathlib import Path
from contextvars import ContextVar
import json
import re
from teacher.models import StrictModel, Settings, SourceFile, SourceModel, QuestionBank, ValidationReport, Blueprint, Profile
from teacher.publishing import atomic_json, now_iso, file_lock

expected_revision: ContextVar[str | None] = ContextVar("expected_job_revision", default=None)

class StaleRevisionError(ValueError):
    pass

class Job(StrictModel):
    id: str
    revision: int = 0
    settings: Settings
    sources: list[SourceFile] = []
    sourceModel: SourceModel | None = None
    sourceConfirmed: bool = False
    questionBank: QuestionBank | None = None
    disabledQuestionIds: list[str] = []
    validation: ValidationReport | None = None
    aiValidationHash: str | None = None
    blueprint: Blueprint | None = None
    approved: bool = False
    approvalHash: str | None = None
    published: dict | None = None
    status: str = "draft"
    updatedAt: str

class JobStore:
    def __init__(self, directory: Path):
        self.directory=directory.resolve()
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        (self.directory/"jobs").mkdir(exist_ok=True,mode=0o700)
        (self.directory/"uploads").mkdir(exist_ok=True,mode=0o700)

    def job_path(self, job_id: str):
        if not re.fullmatch(r"job-[a-f0-9]{32}",job_id):
            raise ValueError("Ungültige Auftrags-ID.")
        return self.directory/"jobs"/(job_id+".json")

    def lock(self, job_id):
        return file_lock(self.job_path(job_id).with_suffix(".lock"))

    def load(self, job_id) -> Job:
        path=self.job_path(job_id)
        if not path.exists():
            raise FileNotFoundError("Der Auftrag wurde nicht gefunden.")
        job=Job.model_validate_json(path.read_text(encoding="utf-8"))
        if job.id!=job_id:
            raise ValueError("Auftragsdatei und gespeicherte ID stimmen nicht überein.")
        revision=expected_revision.get()
        if revision is not None and revision != str(job.revision):
            raise StaleRevisionError("Dieser Auftrag wurde inzwischen geändert. Der aktuelle Stand wird geladen; bitte prüfe ihn vor der nächsten Aktion.")
        return job

    def save(self, job: Job):
        job.updatedAt=now_iso()
        job.revision+=1
        atomic_json(self.job_path(job.id),job.model_dump(exclude_none=True))
        return job

    def list(self):
        # Persisted jobs are validated on read; no silently dropped corrupted jobs.
        jobs=[Job.model_validate_json(p.read_text(encoding="utf-8")) for p in (self.directory/"jobs").glob("job-*.json")]
        return sorted(jobs,key=lambda job:job.updatedAt,reverse=True)

    def source_path(self, job_id: str, source: SourceFile):
        self.job_path(job_id)
        if not re.fullmatch(r"src-[a-f0-9]{32}\.(jpg|jpeg|png|webp|pdf)",source.storedName):
            raise ValueError("Ungültiger gespeicherter Dateiname.")
        return self.directory/"uploads"/job_id/source.storedName

    def profiles(self):
        path=self.directory/"profiles.json"
        if path.exists():
            return [Profile.model_validate(raw) for raw in json.loads(path.read_text(encoding="utf-8"))]
        return [Profile(id=id,name=name,grade=grade,preferredLanguage="de",subjects=["maths","english","french","svt","history_geography"],createdAt=now_iso()) for id,name,grade in (("max","Max","3eme"),("lutz","Lutz","5eme"),("ben","Ben","CM1"))]

    def save_profile(self, profile: Profile, *, create=False):
        with file_lock(self.directory/"profiles.lock"):
            profiles=self.profiles()
            found=next((item for item in profiles if item.id==profile.id),None)
            if create and found:
                raise ValueError("Diese Profil-ID ist bereits vorhanden.")
            if not create and found is None:
                raise FileNotFoundError("Dieses Profil ist nicht vorhanden.")
            if found:
                profile=profile.model_copy(update={"createdAt":found.createdAt})
            profiles=[item for item in profiles if item.id!=profile.id]+[profile]
            atomic_json(self.directory/"profiles.json",[item.model_dump() for item in profiles])
            return profile

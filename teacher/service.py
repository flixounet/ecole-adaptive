"""Explicit authoring state machine: sources → review → questions → approval → publish."""
from __future__ import annotations
from collections import Counter
import hashlib
import random
from pathlib import Path
import uuid
from teacher import config
from teacher.models import Settings, SourceReference, SourceModel, Question, QuestionBank, Blueprint
from teacher.provider import AIProvider, OpenAIProvider
from teacher.publishing import canonical_hash, now_iso, publish_bank
from teacher.quality import check_source_model, local_report, combine_reports
from teacher.store import JobStore, Job
from teacher.uploads import inspect_upload, UploadError

class TeacherService:
    def __init__(self, store: JobStore, content_dir: Path, provider: AIProvider | None = None):
        self.store=store
        self.content_dir=content_dir
        self.provider=provider or OpenAIProvider()

    def create_job(self, settings: Settings):
        profile=next((p for p in self.store.profiles() if p.id==settings.studentId and not p.archived),None)
        if profile is None:
            raise ValueError("Bitte ein vorhandenes aktives Schülerprofil auswählen.")
        return self.store.save(Job(id="job-"+uuid.uuid4().hex,settings=settings,updatedAt=now_iso()))

    def _invalidate(self, job, *, source=False, questions=False):
        job.approved=False
        job.approvalHash=None
        # A prior publication remains discoverable in content/. The current draft
        # must pass the pipeline again before a new version may be published.
        job.published=None
        if source:
            job.sourceModel=None
            job.sourceConfirmed=False
            job.questionBank=None
            job.disabledQuestionIds=[]
            job.blueprint=None
        if source or questions:
            job.validation=None
            job.aiValidationHash=None
        job.status="draft" if source else "question_review"

    def add_sources(self, job_id, uploaded: list[tuple[str,bytes]]):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            if not uploaded:
                raise UploadError("Bitte mindestens eine Datei auswählen.")
            inspected=[(inspect_upload(name,data),data) for name,data in uploaded]
            if len(job.sources)+len(inspected)>config.MAX_FILES:
                raise UploadError("Pro Auftrag sind höchstens 20 Dateien möglich.")
            if sum(s.size for s in job.sources)+sum(s.size for s,_ in inspected)>config.MAX_TOTAL_BYTES:
                raise UploadError("Alle Quelldateien zusammen dürfen höchstens 45 MiB groß sein.")
            if sum(s.pages for s in job.sources)+sum(s.pages for s,_ in inspected)>500:
                raise UploadError("Höchstens 500 Quellenseiten pro Auftrag sind möglich.")
            hashes={s.sha256 for s in job.sources}
            for source,_ in inspected:
                if source.sha256 in hashes:
                    raise UploadError(f"{source.filename}: Diese Datei ist bereits vorhanden oder doppelt ausgewählt. Keine Datei wurde hinzugefügt.")
                hashes.add(source.sha256)
            saved=[]
            try:
                for source,data in inspected:
                    path=self.store.source_path(job_id,source)
                    path.parent.mkdir(exist_ok=True,mode=0o700)
                    with path.open("xb") as stream:
                        stream.write(data)
                    path.chmod(0o600)
                    saved.append(path)
                job.sources.extend(source for source,_ in inspected)
                self._invalidate(job,source=True)
                return self.store.save(job)
            except Exception:
                for path in saved:
                    path.unlink(missing_ok=True)
                raise

    def remove_source(self,job_id,file_id):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            source=next((s for s in job.sources if s.id==file_id),None)
            if source is None:
                raise FileNotFoundError("Datei nicht gefunden.")
            job.sources=[s for s in job.sources if s.id!=file_id]
            self._invalidate(job,source=True)
            self.store.save(job)
            self.store.source_path(job_id,source).unlink(missing_ok=True)
            return job

    def references(self,job):
        return [SourceReference(id=f"{source.id}-p{page}",fileId=source.id,filename=source.filename,kind=source.kind,page=page) for source in job.sources for page in range(1,source.pages+1)]

    def extract(self,job_id):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            if not job.sources:
                raise ValueError("Bitte zuerst Unterrichtsunterlagen hochladen.")
            paths=[(source,self.store.source_path(job_id,source)) for source in job.sources]
            for source,path in paths:
                if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=source.sha256:
                    raise ValueError("Eine Quelldatei fehlt oder wurde verändert. Bitte erneut hochladen.")
            refs=self.references(job)
            source=self.provider.extract_source(job.settings,job.id,paths,refs)
            check_source_model(source,job.settings,job.id,refs)
            self._invalidate(job,source=True)
            job.sourceModel=source
            job.status="source_review"
            return self.store.save(job)

    def edit_source(self,job_id,source):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            if not job.sources:
                raise ValueError("Bitte zuerst Unterrichtsunterlagen hochladen.")
            check_source_model(source,job.settings,job.id,self.references(job))
            self._invalidate(job,source=True)
            job.sourceModel=source
            job.status="source_review"
            return self.store.save(job)

    def confirm_source(self,job_id):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            if job.sourceModel is None:
                raise ValueError("Bitte zuerst die Quellenanalyse durchführen.")
            check_source_model(job.sourceModel,job.settings,job.id,self.references(job))
            if not job.sourceModel.skills or not job.sourceModel.learningObjectives or not job.sourceModel.exerciseTypes:
                raise ValueError("Die Quellen liefern noch nicht genügend sichere Lernziele, Skills und Aufgabentypen. Bitte lesbare Unterlagen ergänzen.")
            job.sourceConfirmed=True
            job.status="confirmed"
            return self.store.save(job)

    def _require_source(self,job):
        if job.sourceModel is None or not job.sourceConfirmed:
            raise ValueError("Bitte zuerst das Quellenmodell prüfen und ausdrücklich bestätigen.")

    def active_bank(self,job) -> QuestionBank:
        if job.questionBank is None:
            raise ValueError("Bitte zuerst Aufgaben generieren.")
        questions=[q for q in job.questionBank.questions if q.id not in job.disabledQuestionIds]
        if not questions:
            raise ValueError("Mindestens eine Aufgabe muss aktiv bleiben.")
        return job.questionBank.model_copy(update={"questions":questions,"questionCount":min(job.questionBank.questionCount,len(questions))})

    def _check_bank_context(self,job,bank):
        if bank.id!=self.bank_id(job) or bank.studentIds!=[job.settings.studentId] or any(getattr(bank,key)!=getattr(job.settings,key) for key in ("subject","grade","language")) or bank.chapter!=job.sourceModel.chapter:
            raise ValueError("Die generierte Question Bank passt nicht zu Auftrag und bestätigtem Quellenmodell.")
        if bank.version!=1 or bank.durationMinutes!=job.settings.durationMinutes or bank.questionCount>job.settings.questionCount:
            raise ValueError("Paketversion, Rundendauer oder Aufgabenanzahl widersprechen den gewählten Einstellungen.")
        if len(bank.questions)>job.settings.poolSize:
            raise ValueError("Der generierte Pool überschreitet die eingestellte maximale Aufgabenzahl.")

    def bank_id(self,job):
        # Short safe IDs leave room for versioned filenames and preserve identity
        # across editing/publication of this job; no personal name in generated ID.
        return "course-"+job.id.removeprefix("job-")

    def _validate(self,job):
        self._require_source(job)
        bank=self.active_bank(job)
        local=local_report(bank,job.sourceModel)
        if not local.valid:
            job.validation=local
            job.aiValidationHash=None
        else:
            remote=self.provider.validate_question_bank(job.sourceModel,bank)
            job.validation=combine_reports(local,remote)
            job.aiValidationHash=canonical_hash(bank.model_dump(exclude_none=True))
        job.approved=False
        job.approvalHash=None
        return job

    def generate(self,job_id):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            self._require_source(job)
            bank=self.provider.generate_question_bank(job.settings,job.sourceModel,self.bank_id(job))
            self._check_bank_context(job,bank)
            self._invalidate(job,questions=True)
            job.questionBank=bank
            job.disabledQuestionIds=[]
            job.blueprint=self.default_blueprint(job) if job.settings.mode!="learn" else None
            # Save the generated draft before the second network call; validation
            # failures never lose the expensive generation result.
            self.store.save(job)
            try:
                self._validate(job)
            except Exception:
                job.validation=local_report(self.active_bank(job),job.sourceModel)
                job.aiValidationHash=None
                self.store.save(job)
                raise
            return self.store.save(job)

    def validate(self,job_id):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            self._validate(job)
            return self.store.save(job)

    def edit_question(self,job_id,qid,question,enabled):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            self._require_source(job)
            if job.questionBank is None or not any(q.id==qid for q in job.questionBank.questions):
                raise FileNotFoundError("Aufgabe nicht gefunden.")
            if question.id!=qid or question.subject!=job.settings.subject or question.chapter!=job.sourceModel.chapter:
                raise ValueError("Aufgaben-ID, Fach und Kapitel dürfen nicht verändert werden.")
            self._invalidate(job,questions=True)
            job.questionBank=job.questionBank.model_copy(update={"questions":[question if q.id==qid else q for q in job.questionBank.questions]})
            disabled=set(job.disabledQuestionIds)
            disabled.discard(qid) if enabled else disabled.add(qid)
            job.disabledQuestionIds=sorted(disabled)
            bank=self.active_bank(job)
            if job.blueprint and not set(job.blueprint.questionIds)<={q.id for q in bank.questions}:
                job.blueprint=self.default_blueprint(job)
            job.validation=local_report(bank,job.sourceModel)
            return self.store.save(job)

    def regenerate(self,job_id,qid):
        # Keep the lock across provider call and save; another request cannot
        # edit the source while a replacement is being generated.
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            self._require_source(job)
            bank=self.active_bank(job)
            original=next((q for q in bank.questions if q.id==qid),None)
            if original is None:
                raise ValueError("Nur aktive vorhandene Aufgaben können neu generiert werden.")
            replacement=self.provider.regenerate_question(job.settings,job.sourceModel,original)
            if replacement.id!=original.id or replacement.subject!=original.subject or replacement.chapter!=original.chapter or set(replacement.skillIds)!=set(original.skillIds):
                raise ValueError("Die Ersatzaufgabe passt nicht zu ID, Fach, Kapitel oder Skills der ursprünglichen Aufgabe.")
            self._invalidate(job,questions=True)
            job.questionBank=job.questionBank.model_copy(update={"questions":[replacement if q.id==qid else q for q in job.questionBank.questions]})
            self.store.save(job)
            self._validate(job)
            return self.store.save(job)

    def default_blueprint(self,job):
        bank=self.active_bank(job)
        seed=int(job.id[4:12],16)
        rng=random.Random(seed)
        remaining=list(bank.questions)
        rng.shuffle(remaining)
        counts=Counter()
        chosen=[]
        target_level=min(4,max(1,2+(job.settings.difficultyFactor-1)*4))
        for _ in range(min(job.settings.questionCount,len(remaining))):
            # Prefer skills not yet represented, then the requested level.
            question=min(remaining,key=lambda q:(sum(counts[s] for s in q.skillIds)/len(q.skillIds),abs(q.difficulty-target_level)))
            remaining.remove(question)
            chosen.append(question.id)
            counts.update(question.skillIds)
        return Blueprint(id="exam-1",title=bank.title+" – Klassenarbeit",durationMinutes=job.settings.durationMinutes,questionIds=chosen,seed=seed)

    def set_blueprint(self,job_id,blueprint):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            if job.settings.mode=="learn":
                raise ValueError("Dieser Auftrag ist nur für Lerntraining vorgesehen.")
            bank=self.active_bank(job)
            if not set(blueprint.questionIds)<={q.id for q in bank.questions} or blueprint.skillDistribution and not set(blueprint.skillDistribution)<={s.id for s in bank.skills}:
                raise ValueError("Blueprint enthält unbekannte oder deaktivierte Aufgaben/Skills.")
            self._invalidate(job)
            job.blueprint=blueprint
            return self.store.save(job)

    def approval_digest(self,job):
        return canonical_hash({"bank":self.active_bank(job).model_dump(exclude_none=True),"blueprint":job.blueprint.model_dump(exclude_none=True) if job.blueprint else None,"source":job.sourceModel.model_dump(),"settings":job.settings.model_dump()})

    def approve(self,job_id,acknowledge_warnings=False):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            self._require_source(job)
            bank=self.active_bank(job)
            local=local_report(bank,job.sourceModel)
            if not local.valid or job.validation is None or not job.validation.valid or job.aiValidationHash!=canonical_hash(bank.model_dump(exclude_none=True)):
                raise ValueError("Vor der Freigabe ist eine erfolgreiche aktuelle automatische Validierung nötig.")
            if any(issue.severity=="warning" for issue in job.validation.issues) and not acknowledge_warnings:
                raise ValueError("Bitte die angezeigten Warnungen prüfen und ihre Freigabe ausdrücklich bestätigen.")
            if job.settings.mode!="learn" and job.blueprint is None:
                raise ValueError("Bitte einen gültigen Klassenarbeits-Blueprint festlegen.")
            job.approvalHash=self.approval_digest(job)
            job.approved=True
            job.status="approved"
            return self.store.save(job)

    def publish(self,job_id):
        with self.store.lock(job_id):
            job=self.store.load(job_id)
            if not job.approved or job.approvalHash!=self.approval_digest(job):
                raise ValueError("Nur die unveränderte freigegebene Fassung kann veröffentlicht werden.")
            if job.published:
                return job
            modes=["learn","exam"] if job.settings.mode=="both" else [job.settings.mode]
            tests=[job.blueprint.model_dump(exclude_none=True)] if job.blueprint else []
            job.published=publish_bank(self.content_dir,self.active_bank(job).model_dump(exclude_none=True),modes,tests)
            job.status="published"
            return self.store.save(job)

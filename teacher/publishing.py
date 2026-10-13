"""Validated immutable packages and atomic catalog publication.

Catalog replacement is the commit point. A crash before it leaves an unlisted
valid package, recoverable with `python -m teacher publish`.
"""
from __future__ import annotations
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from importlib.resources import files
import rfc8785
from jsonschema import Draft7Validator
from referencing import Registry, Resource
from teacher.generator.validation import validate_question_bank
from teacher.models import Blueprint

class PublishError(ValueError):
    pass

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")

def canonical_hash(value: dict) -> str:
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()

def content_hash(package: dict) -> str:
    return canonical_hash({k:v for k,v in package.items() if k!="contentHash"})

def atomic_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode="w",encoding="utf-8",dir=path.parent,delete=False) as stream:
            temporary=Path(stream.name)
            json.dump(data,stream,ensure_ascii=False,indent=2,allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

@contextmanager
def file_lock(path: Path):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("a") as stream:
        fcntl.flock(stream.fileno(),fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(),fcntl.LOCK_UN)

def _schema(name: str, value):
    schemas=files("shared").joinpath("schemas")
    bank=json.loads(schemas.joinpath("question-bank.schema.json").read_text())
    schema=json.loads(schemas.joinpath(name).read_text())
    registry=Registry().with_resource(bank["$id"],Resource.from_contents(bank))
    errors=list(Draft7Validator(schema,registry=registry).iter_errors(value))
    if errors:
        error=errors[0]
        raise PublishError(f"Ungültiges Paket/Catalog: /{'/'.join(map(str,error.absolute_path))}: {error.message}")

def _date(value):
    try:
        datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError as error:
        raise PublishError("Ungültiger Zeitpunkt.") from error

def validate_content_package(package: dict) -> dict:
    _schema("content-package.schema.json",package)
    _date(package["createdAt"])
    bank=validate_question_bank(package["questionBank"])
    for key in ("id","version","title","subject","grade","chapter"):
        if package[key] != bank[key]:
            raise PublishError(f"Paket und QuestionBank unterscheiden sich in {key}.")
    if set(package["studentIds"]) != set(bank["studentIds"]):
        raise PublishError("Paket und QuestionBank unterscheiden sich in studentIds.")
    if content_hash(package)!=package["contentHash"]:
        raise PublishError("Der Paket-Hash stimmt nicht; Inhalt wurde verändert oder beschädigt.")
    if ("exam" in package["modes"]) != bool(package["tests"]):
        raise PublishError("Klassenarbeitsmodus benötigt mindestens einen Blueprint; reine Lernpakete dürfen keinen enthalten.")
    seen=set()
    for raw in package["tests"]:
        blueprint=Blueprint.model_validate(raw)
        if blueprint.id in seen:
            raise PublishError("Doppelte Blueprint-ID.")
        seen.add(blueprint.id)
        if not set(blueprint.questionIds) <= {q["id"] for q in bank["questions"]}:
            raise PublishError("Blueprint enthält unbekannte Aufgaben.")
        if blueprint.skillDistribution and not set(blueprint.skillDistribution) <= {s["id"] for s in bank["skills"]}:
            raise PublishError("Blueprint enthält unbekannte Skills.")
    return package

def catalog_entry(package):
    return {**{k:deepcopy(package[k]) for k in ("id","version","contentHash","createdAt","studentIds","subject","grade","chapter","title","modes")},"url":f"packages/{package['id']}-v{package['version']}.json"}

def validate_catalog(catalog: dict) -> dict:
    _schema("content-catalog.schema.json",catalog)
    _date(catalog["updatedAt"])
    seen=set()
    for item in catalog["packages"]:
        _date(item["createdAt"])
        if item["id"] in seen:
            raise PublishError("Catalog enthält mehrere Einträge derselben Paket-ID.")
        seen.add(item["id"])
        if item["url"]!=f"packages/{item['id']}-v{item['version']}.json":
            raise PublishError("Catalog-Dateiname passt nicht zu Paket-ID und Version.")
    return catalog

def make_package(bank: dict, modes: list[str], blueprints: list[dict], *, version: int, created_at: str | None = None):
    bank=deepcopy(bank)
    bank["version"]=version
    package={"packageVersion":1,**{k:deepcopy(bank[k]) for k in ("id","version","title","subject","grade","chapter","studentIds")},"createdAt":created_at or now_iso(),"modes":modes,"questionBank":bank,"tests":blueprints}
    package["contentHash"]=content_hash(package)
    return validate_content_package(package)

def _read_json(path: Path):
    if path.is_symlink() or path.stat().st_size > 10_000_000:
        raise PublishError("Paket ist zu groß oder verweist auf eine andere Datei.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError,json.JSONDecodeError) as error:
        raise PublishError(f"{path.name} enthält kein gültiges UTF-8 JSON.") from error

def read_catalog(directory: Path):
    path=directory/"catalog.json"
    return validate_catalog(_read_json(path)) if path.exists() else {"catalogVersion":1,"updatedAt":now_iso(),"packages":[]}

def _publish_unlocked(directory: Path, package: dict):
    validate_content_package(package)
    catalog=read_catalog(directory)
    target=directory/"packages"/f"{package['id']}-v{package['version']}.json"
    if target.exists():
        existing=validate_content_package(_read_json(target))
        if existing!=package:
            raise PublishError("Eine bereits veröffentlichte Paketversion darf nicht verändert werden.")
    else:
        atomic_json(target,package)
    previous=next((p for p in catalog["packages"] if p["id"]==package["id"]),None)
    if previous and previous["version"]>package["version"]:
        raise PublishError("Ein neuerer Paketstand ist bereits veröffentlicht.")
    entries=[item for item in catalog["packages"] if item["id"]!=package["id"]]+[catalog_entry(package)]
    catalog={"catalogVersion":1,"updatedAt":now_iso(),"packages":sorted(entries,key=lambda item:item["id"])}
    atomic_json(directory/"catalog.json",validate_catalog(catalog))
    return {"packageId":package["id"],"version":package["version"],"contentHash":package["contentHash"],"packagePath":str(target),"catalogPath":str(directory/"catalog.json"),"questionCount":len(package["questionBank"]["questions"]),"blueprintQuestionCount":sum(len(t["questionIds"]) for t in package["tests"]),"publishedAt":package["createdAt"],"message":"Lokal veröffentlicht. Für das iPad die statische Website anschließend bauen und bereitstellen."}

def publish_bank(directory: Path, bank: dict, modes: list[str], blueprints: list[dict]):
    with file_lock(directory/".publish.lock"):
        versions=[]
        for path in (directory/"packages").glob(f"{bank['id']}-v*.json"):
            match=re.fullmatch(re.escape(bank["id"])+r"-v([1-9][0-9]*)\.json",path.name)
            if match:
                old=validate_content_package(_read_json(path))
                if old["id"]!=bank["id"] or old["version"]!=int(match.group(1)):
                    raise PublishError("Dateiname und gespeichertes Paket stimmen nicht überein.")
                versions.append(old["version"])
        package=make_package(bank,modes,blueprints,version=max([bank["version"]-1,*versions])+1)
        return _publish_unlocked(directory,package)

def rebuild_catalog(directory: Path):
    with file_lock(directory/".publish.lock"):
        latest={}
        for path in sorted((directory/"packages").glob("*.json")):
            package=validate_content_package(_read_json(path))
            if path.name!=f"{package['id']}-v{package['version']}.json":
                raise PublishError("Dateiname und Paket stimmen nicht überein.")
            previous=latest.get(package["id"])
            if previous is None or previous["version"]<package["version"]:
                latest[package["id"]]=catalog_entry(package)
        catalog=validate_catalog({"catalogVersion":1,"updatedAt":now_iso(),"packages":sorted(latest.values(),key=lambda item:item["id"])})
        atomic_json(directory/"catalog.json",catalog)
        return catalog

def git_status(root: Path) -> str:
    try:
        result=subprocess.run(["git","status","--short","--","content"],cwd=root,text=True,capture_output=True,timeout=10,check=False)
        return result.stdout.strip() if result.returncode==0 else "Git-Status nicht verfügbar."
    except (OSError,subprocess.TimeoutExpired):
        return "Git-Status nicht verfügbar."

"""Mac launcher supervisor. Uses only the Python standard library.

A cache outside iCloud avoids blocking on evicted .pyc files. Readiness is
verified before a browser opens; no provider API or source upload is invoked.
"""
from __future__ import annotations
from datetime import datetime
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

ROOT=Path(__file__).resolve().parents[1]
# Readiness probes target loopback only and must never use system/environment proxies.
LOCAL_HTTP = build_opener(ProxyHandler({}))


def is_teacher(url: str) -> bool:
    try:
        with LOCAL_HTTP.open(url+"/api/config",timeout=1) as response:
            if response.status!=200:
                return False
            data=json.loads(response.read(100_000))
        # Read only the existing local API; do not print configuration or tokens.
        return isinstance(data,dict) and isinstance(data.get("csrfToken"),str) and isinstance(data.get("keyConfigured"),bool) and isinstance(data.get("limits"),dict) and isinstance(data.get("model"),str)
    except (OSError,URLError,ValueError,TimeoutError):
        return False


def port_in_use(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1",port),timeout=.5):
            return True
    except OSError:
        return False


def open_browser(url: str):
    if os.environ.get("ECOLE_NO_OPEN")!="1":
        try:
            subprocess.run(["/usr/bin/open",url],check=False,timeout=5)
        except (OSError,subprocess.TimeoutExpired):
            print("Bitte diese Adresse im Browser öffnen:",url,flush=True)


def stop_child(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main() -> int:
    try:
        port=int(os.environ.get("ECOLE_TEACHER_PORT","8000"))
        if not 1<=port<=65535:
            raise ValueError()
    except ValueError:
        print("ECOLE_TEACHER_PORT muss eine Portnummer zwischen 1 und 65535 sein.",flush=True)
        return 1
    url=f"http://127.0.0.1:{port}"
    if is_teacher(url):
        print("Teacher Studio läuft bereits:",url,flush=True)
        open_browser(url)
        return 0
    if port_in_use(port):
        print(f"Port {port} wird bereits von einem anderen Dienst verwendet. Diesen Dienst beenden oder ECOLE_TEACHER_PORT auf einen freien Port setzen.",flush=True)
        return 1
    cache=Path(os.environ.get("ECOLE_TEACHER_CACHE_DIR",str(Path.home()/"Library/Caches/EcoleAdaptive/teacher")))
    try:
        cache.mkdir(parents=True,exist_ok=True)
        log_path=cache/"start.log"
        log=log_path.open("a",encoding="utf-8")
    except OSError:
        print("Der lokale Start-Log konnte nicht angelegt werden. Bitte Zugriffsrechte und freien Speicher prüfen.",flush=True)
        return 1
    environment={**os.environ,"PYTHONPYCACHEPREFIX":str(cache/"pycache"),"PYTHONUNBUFFERED":"1"}
    print("Prüfe den lokalen Server …",flush=True)
    process=None
    def interrupted(signum,frame):
        raise KeyboardInterrupt
    for signum in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):
        signal.signal(signum,interrupted)
    try:
        log.write("\n--- Teacher-Start "+datetime.now().isoformat(timespec="seconds")+" ---\n")
        log.flush()
        process=subprocess.Popen([sys.executable,"-X",f"pycache_prefix={cache/'pycache'}","-u","-m","teacher","--port",str(port)],cwd=ROOT,env=environment,stdout=log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            if process.poll() is not None:
                print("Der Teacher-Server wurde beim Start beendet. Details stehen lokal in:",log_path,flush=True)
                return 1
            if is_teacher(url):
                print("Teacher Studio ist bereit:",url,flush=True)
                open_browser(url)
                return process.wait()
            time.sleep(.25)
        print("Der Start dauert länger als 45 Sekunden. Häufig sind Projekt- oder Python-Dateien noch nicht vollständig aus iCloud geladen. Im Finder den Projektordner dauerhaft lokal verfügbar machen und erneut starten.",flush=True)
        print("Lokaler Start-Log:",log_path,flush=True)
        return 1
    except KeyboardInterrupt:
        print("\nTeacher Studio wird beendet.",flush=True)
        return 0
    except OSError as error:
        print("Teacher Studio konnte nicht gestartet werden ("+type(error).__name__+"). Log:",log_path,flush=True)
        return 1
    finally:
        if process is not None:
            stop_child(process)
        log.close()

if __name__=="__main__":
    raise SystemExit(main())

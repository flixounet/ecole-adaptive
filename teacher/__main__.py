"""Run the localhost studio or validate/rebuild the publication catalog."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys

def main(argv=None):
    # Bytecode inside a synced Desktop checkout can be an iCloud placeholder.
    # -B only disables writes; moving the cache also avoids blocking reads.
    if sys.platform == "darwin" and sys.pycache_prefix is None:
        cache_root = Path(os.environ.get("ECOLE_TEACHER_CACHE_DIR", str(Path.home() / "Library/Caches/EcoleAdaptive/teacher")))
        sys.pycache_prefix = str(cache_root / "pycache")
    parser=argparse.ArgumentParser(description="École Teacher Studio (lokal)")
    parser.add_argument("command",nargs="?",choices=("serve","publish"),default="serve")
    parser.add_argument("--port",type=int,default=8000)
    parser.add_argument("--job",help="Bereits im Studio freigegebenen Auftrag veröffentlichen")
    args=parser.parse_args(argv)
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1]/".env",override=False)
    from teacher import config
    if args.command=="serve":
        import uvicorn
        from teacher.app import create_app
        print(f"École Teacher Studio: http://127.0.0.1:{args.port}")
        uvicorn.run(create_app(),host="127.0.0.1",port=args.port,log_level="warning")
        return 0
    from teacher.publishing import rebuild_catalog, git_status
    try:
        if args.job:
            from teacher.service import TeacherService
            from teacher.store import JobStore
            result=TeacherService(JobStore(config.DATA_DIR),config.CONTENT_DIR).publish(args.job).published
        else:
            result=rebuild_catalog(config.CONTENT_DIR)
        print(json.dumps(result,ensure_ascii=False,indent=2))
        print("Git-Status (keine automatische Übertragung):")
        print(git_status(config.ROOT) or "Keine Änderungen an content/.")
        return 0
    except (ValueError,OSError) as error:
        print(f"Veröffentlichung nicht möglich: {error}",file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())

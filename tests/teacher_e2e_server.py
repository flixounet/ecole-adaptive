"""Isolated browser-test server. Never used by `python -m teacher`.

Only the paid provider is replaced. FastAPI, static Studio UI, upload parsing,
validation, persistence, publishing and hashing are the production implementation.
Both private files and published packages are discarded on normal shutdown.
"""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/"tests"))
from test_teacher import FakeProvider
from teacher.app import create_app
import uvicorn

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Isolated Teacher browser-test server; no OpenAI calls")
    parser.add_argument("--port",type=int,default=8137)
    args=parser.parse_args()
    # The UI indicates an available key, but the injected provider has no OpenAI
    # client and never reads this sentinel. It exists only in this test process.
    os.environ["OPENAI_API_KEY"]="isolated-test-sentinel-no-real-key"
    with TemporaryDirectory(prefix="ecole-teacher-e2e-") as temporary:
        directory=Path(temporary)
        print(f"TEST ONLY — isolated data in {directory}",flush=True)
        uvicorn.run(create_app(data_dir=directory/"private",content_dir=directory/"content",provider=FakeProvider()),host="127.0.0.1",port=args.port,log_level="warning")

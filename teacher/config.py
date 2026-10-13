"""Central limits for the localhost authoring application."""
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("ECOLE_TEACHER_DATA", ROOT / ".teacher-data")).resolve()
CONTENT_DIR = ROOT / "content"
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 45 * 1024 * 1024
MAX_FILES = 20
MAX_PDF_PAGES = 40
MAX_IMAGE_PIXELS = 25_000_000
DEFAULT_POOL_SIZE = 48
DEFAULT_QUESTION_COUNT = 18
DEFAULT_DURATION_MINUTES = 30
DURATIONS = (10, 20, 30, 40, 45, 60)
DIFFICULTY_FACTORS = (0.9, 1.0, 1.1, 1.15, 1.25, 1.3)
PACKAGE_VERSION = 1

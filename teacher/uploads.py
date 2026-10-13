"""Inspect actual file bytes before storing any untrusted upload."""
import hashlib
import io
from pathlib import Path
import re
import uuid
import warnings
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from teacher import config
from teacher.models import SourceFile

class UploadError(ValueError):
    pass

def inspect_upload(filename: str, data: bytes) -> SourceFile:
    # Paths are never derived from submitted names. The sanitized name is display-only.
    filename = re.sub(r"[\x00-\x1f\x7f]", "", filename.replace("\\", "/").split("/")[-1])[:180]
    suffix = Path(filename).suffix.lower()
    if suffix not in config.ALLOWED_EXTENSIONS:
        raise UploadError("Erlaubt sind JPG, JPEG, PNG, WEBP und PDF.")
    if not data or len(data) > config.MAX_FILE_BYTES:
        raise UploadError("Die Datei ist leer oder größer als 20 MiB.")
    pages = 1
    if suffix == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise UploadError("Die Datei enthält kein gültiges PDF.")
        try:
            reader = PdfReader(io.BytesIO(data), strict=True)
            if reader.is_encrypted:
                raise UploadError("Passwortgeschützte PDFs bitte zuerst lokal entsperren.")
            pages = len(reader.pages)
            if not 1 <= pages <= config.MAX_PDF_PAGES:
                raise UploadError("Ein PDF muss 1 bis 40 Seiten enthalten.")
        except UploadError:
            raise
        except Exception as error:
            raise UploadError("Das PDF ist beschädigt oder nicht lesbar.") from error
        kind, media = "pdf", "application/pdf"
    else:
        expected={".jpg":"JPEG",".jpeg":"JPEG",".png":"PNG",".webp":"WEBP"}
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    if image.format != expected[suffix] or image.width * image.height > config.MAX_IMAGE_PIXELS:
                        raise UploadError("Bildformat oder Bildgröße ist ungültig (höchstens 25 Megapixel).")
                    if getattr(image,"n_frames",1) != 1:
                        raise UploadError("Animierte Bilder werden nicht unterstützt; bitte eine einzelne Seite hochladen.")
                    image.verify()
                with Image.open(io.BytesIO(data)) as decoded:
                    decoded.load()
        except UploadError:
            raise
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise UploadError("Das Bild ist beschädigt oder hat kein unterstütztes Format.") from error
        kind, media = "image", "image/jpeg" if suffix in (".jpg",".jpeg") else "image/"+suffix[1:]
    file_id = "src-"+uuid.uuid4().hex
    return SourceFile(id=file_id,filename=filename,storedName=file_id+suffix,kind=kind,mediaType=media,size=len(data),pages=pages,sha256=hashlib.sha256(data).hexdigest())

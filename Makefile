.PHONY: check student teacher
PYTHON ?= .venv/bin/python
check:
	node scripts/check.mjs
	$(PYTHON) -m pytest
student:
	npm run dev
teacher:
	$(PYTHON) -m teacher

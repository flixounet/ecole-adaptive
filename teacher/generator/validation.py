"""Strict local QuestionBank validation, reused by the Teacher authoring pipeline.

The browser and Python use the same JSON Schema and semantic checks. Python
additionally checks numeric questions whose complete prompt is ``Berechne: ...``
with a bounded arithmetic parser. It never evaluates arbitrary code.
"""

from __future__ import annotations

import ast
import json
import math
import re
import unicodedata
from decimal import Decimal, DecimalException, localcontext
from importlib.resources import files
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator

SCHEMA = json.loads(files("shared").joinpath("schemas/question-bank.schema.json").read_text(encoding="utf-8"))
Draft7Validator.check_schema(SCHEMA)
_VALIDATOR = Draft7Validator(SCHEMA)
_NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$")


class PackageValidationError(ValueError):
    """One or more explicit shape, reference, or arithmetic failures."""


def _normalize(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", value).lower()).translate(
        str.maketrans({"−": "-", "–": "-", "×": "*", "·": "*", ",": "."})
    )


def _duplicates(values: list[str], label: str, errors: list[str]) -> None:
    if len(set(values)) != len(values):
        errors.append(f"{label}: duplicate entries")


def safe_arithmetic(expression: str) -> Decimal:
    """Parse bounded numeric arithmetic only. No calls, attributes, or variables.

    Accepted symbols: + - × * · ÷ /, parentheses, decimals and small powers.
    Input is length/depth/value limited to keep untrusted imports inexpensive.
    """
    if re.search(r"[0-9]\s+[0-9]", expression):
        raise ValueError("Digits must not be joined across whitespace")
    expression = _normalize(expression).replace("÷", "/").replace("²", "**2").replace("³", "**3").replace("^", "**")
    if not expression or len(expression) > 200 or not re.fullmatch(r"[0-9.+*/()\-]+", expression):
        raise ValueError("Unsupported arithmetic expression")
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, RecursionError) as error:
        raise ValueError("Invalid arithmetic expression") from error
    if len(list(ast.walk(tree))) > 100:
        raise ValueError("Arithmetic expression too complex")

    def visit(node: ast.AST, depth: int = 0) -> Decimal:
        if depth > 20:
            raise ValueError("Arithmetic expression too deep")
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            result = Decimal(ast.get_source_segment(expression, node) or str(node.value))
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            operand = visit(node.operand, depth + 1)
            result = operand if isinstance(node.op, ast.UAdd) else -operand
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)):
            left, right = visit(node.left, depth + 1), visit(node.right, depth + 1)
            if isinstance(node.op, ast.Add):
                result = left + right
            elif isinstance(node.op, ast.Sub):
                result = left - right
            elif isinstance(node.op, ast.Mult):
                result = left * right
            elif isinstance(node.op, ast.Div):
                result = left / right
            else:
                if right != right.to_integral_value() or not 0 <= right <= 12:
                    raise ValueError("Power must be an integer between 0 and 12")
                result = left ** int(right)
        else:
            raise ValueError("Unsupported arithmetic operation")
        if not result.is_finite() or abs(result) > Decimal("1e12"):
            raise ValueError("Arithmetic result out of bounds")
        return result

    try:
        with localcontext() as context:
            context.prec = 40
            return visit(tree.body)
    except (DecimalException, OverflowError, ZeroDivisionError) as error:
        raise ValueError("Invalid arithmetic calculation") from error


def validate_question_bank(data: Any, *, verify_arithmetic: bool = True) -> dict[str, Any]:
    """Return validated data, or raise a readable, aggregate validation error."""
    shape_errors = sorted(_VALIDATOR.iter_errors(data), key=lambda error: str(list(error.absolute_path)))
    if shape_errors:
        details = [f"/{'/'.join(map(str, error.absolute_path))}: {error.message}" for error in shape_errors]
        raise PackageValidationError("Invalid question bank: " + "; ".join(details))
    errors: list[str] = []
    skill_ids = {skill["id"] for skill in data["skills"]}
    source_ids = {source["id"] for source in data["sourceRefs"]}
    _duplicates([skill["id"] for skill in data["skills"]], "skills", errors)
    _duplicates([source["id"] for source in data["sourceRefs"]], "sourceRefs", errors)
    _duplicates([question["id"] for question in data["questions"]], "questions.id", errors)
    _duplicates([_normalize(question["question"]) for question in data["questions"]], "questions.question", errors)
    if data["questionCount"] > len(data["questions"]):
        errors.append("questionCount exceeds question pool size")
    if not data["isDemo"] and any(source["kind"] == "fixture" for source in data["sourceRefs"]):
        errors.append("A package containing fixture sources must be marked isDemo")
    for skill in data["skills"]:
        if "subject" in skill and skill["subject"] != data["subject"]:
            errors.append(f"{skill['id']}: skill subject differs from bank")
    for question in data["questions"]:
        label = question["id"]
        if not math.isfinite(question["points"]):
            errors.append(f"{label}: points must be finite")
        if question["subject"] != data["subject"]:
            errors.append(f"{label}: subject differs from bank")
        errors.extend(f"{label}: unknown skill {id}" for id in question["skillIds"] if id not in skill_ids)
        errors.extend(f"{label}: unknown source {id}" for id in question["sourceRefs"] if id not in source_ids)
        correct = _normalize(question["correctAnswer"])
        accepted = [_normalize(answer) for answer in question["acceptedAnswers"]]
        if question["correctAnswer"] not in question["acceptedAnswers"]:
            errors.append(f"{label}: correctAnswer is missing from acceptedAnswers")
        if question["questionType"] == "expression" and any(
            re.search(r"[0-9]\s+[0-9]", answer) for answer in [*question["acceptedAnswers"], question["correctAnswer"]]
        ):
            errors.append(f"{label}: expression answers must not separate digits with whitespace")
        if question["questionType"] in ("numeric", "decimal"):
            raw_values = [*question["acceptedAnswers"], question["correctAnswer"]]
            numeric_values = [*accepted, correct]
            if any(re.search(r"\s", answer.strip()) for answer in raw_values) or any(
                not _NUMBER.fullmatch(answer) or not math.isfinite(float(Decimal(answer))) for answer in numeric_values
            ):
                errors.append(f"{label}: numeric acceptedAnswers must contain finite numbers")
            elif not _NUMBER.fullmatch(correct) or any(Decimal(answer) != Decimal(correct) for answer in accepted):
                errors.append(f"{label}: numeric acceptedAnswers disagree with correctAnswer")
            if verify_arithmetic and question["question"].startswith("Berechne: "):
                try:
                    calculated = safe_arithmetic(question["question"].removeprefix("Berechne: "))
                    if calculated != Decimal(correct):
                        errors.append(f"{label}: arithmetic solution is {calculated}, not {question['correctAnswer']}")
                except (ValueError, DecimalException) as error:
                    errors.append(f"{label}: arithmetic could not be verified: {error}")
        if question["questionType"] == "multiple_choice":
            choices = question["choices"]
            ids = [choice["id"] for choice in choices]
            _duplicates([_normalize(id) for id in ids], f"{label}.choices.id", errors)
            _duplicates([_normalize(choice["text"]) for choice in choices], f"{label}.choices.text", errors)
            if question["correctAnswer"] not in ids or any(answer != question["correctAnswer"] for answer in question["acceptedAnswers"]):
                errors.append(f"{label}: multiple-choice answers must use exactly one correct choice ID")
    if errors:
        raise PackageValidationError("Invalid question bank: " + "; ".join(errors))
    return data


def load_question_bank(path: str | Path) -> dict[str, Any]:
    """Load UTF-8 JSON and validate before content can be distributed."""
    path = Path(path)
    if path.stat().st_size > 5_000_000:
        raise PackageValidationError("Question bank exceeds the 5 MB import limit")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PackageValidationError(f"Invalid UTF-8 JSON: {error}") from error
    return validate_question_bank(data)

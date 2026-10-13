"""Content quality, shared contract, and bounded arithmetic checks."""

from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from teacher.generator.validation import PackageValidationError, load_question_bank, safe_arithmetic, validate_question_bank

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "shared/fixtures/lutz-maths-demo.json"


@pytest.fixture
def bank():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_demo_bank_is_valid_and_honestly_labelled(bank):
    assert validate_question_bank(bank) is bank
    assert load_question_bank(FIXTURE) == bank
    assert bank["isDemo"] is True
    assert bank["studentIds"] == ["lutz"]
    assert len(bank["questions"]) == 48
    assert set(question["questionType"] for question in bank["questions"]) == {
        "numeric", "decimal", "short_text", "expression", "multiple_choice"
    }


def test_profiles_match_schema():
    schema = json.loads((ROOT / "shared/schemas/student-profile.schema.json").read_text())
    profiles = json.loads((ROOT / "shared/fixtures/profiles.json").read_text())
    assert [profile["id"] for profile in profiles] == ["max", "lutz", "ben"]
    for profile in profiles:
        Draft7Validator(schema).validate(profile)


@pytest.mark.parametrize(("field", "value"), [
    ("points", 0), ("points", -1), ("points", float("nan")), ("points", float("inf")), ("difficulty", 5),
    ("explanationSteps", []), ("sourceRefs", []), ("acceptedAnswers", []),
    ("hint", "   "), ("estimatedSeconds", 0), ("surprise", "unknown field"),
])
def test_question_schema_rejects_missing_quality_fields(bank, field, value):
    bank["questions"][0][field] = value
    with pytest.raises(PackageValidationError):
        validate_question_bank(bank)


@pytest.mark.parametrize(("field", "value", "error"), [
    ("skillIds", ["unseen_skill"], "unknown skill"),
    ("sourceRefs", ["missing_page"], "unknown source"),
    ("correctAnswer", "20", "correctAnswer"),
    ("acceptedAnswers", ["19", "20"], "disagree"),
    ("acceptedAnswers", ["19", "1 9"], "finite numbers"),
    ("subject", "svt", "subject differs"),
])
def test_semantic_integrity(bank, field, value, error):
    bank["questions"][0][field] = value
    with pytest.raises(PackageValidationError, match=error):
        validate_question_bank(bank)


def test_duplicate_prompt_is_detected_after_typographical_normalization(bank):
    bank["questions"][1]["question"] = "  Berechne: 7+3 · 4  "
    with pytest.raises(PackageValidationError, match="duplicate"):
        validate_question_bank(bank)


@pytest.mark.parametrize("collection", ["questions", "skills", "sourceRefs"])
def test_duplicate_ids_rejected(bank, collection):
    bank[collection].append(deepcopy(bank[collection][0]))
    with pytest.raises(PackageValidationError, match="duplicate"):
        validate_question_bank(bank)


def test_exam_cannot_request_more_questions_than_pool(bank):
    bank["questionCount"] = len(bank["questions"]) + 1
    with pytest.raises(PackageValidationError, match="pool size"):
        validate_question_bank(bank)


def test_fixture_cannot_silently_become_real_course_content(bank):
    bank["isDemo"] = False
    with pytest.raises(PackageValidationError, match="isDemo"):
        validate_question_bank(bank)


def test_numeric_answer_checked_against_calculation(bank):
    bank["questions"][0]["correctAnswer"] = "20"
    bank["questions"][0]["acceptedAnswers"] = ["20"]
    with pytest.raises(PackageValidationError, match="arithmetic solution is 19"):
        validate_question_bank(bank)


def test_multiple_choice_requires_ids_and_one_correct_choice(bank):
    choice = next(question for question in bank["questions"] if question["questionType"] == "multiple_choice")
    choice["acceptedAnswers"] = ["a", "b"]
    with pytest.raises(PackageValidationError, match="one correct choice ID"):
        validate_question_bank(bank)


@pytest.mark.parametrize(("expression", "expected"), [
    ("3 + 2 × (7 − 4)²", "21"), ("24 ÷ 6 × 2", "8"),
    ("(4,8 − 1,2) ÷ 3", "1.2"), ("−3 + 5", "2"),
    ("2^3 + 3²", "17"), ("0.1 + 0.2", "0.3"),
    ("0.10000000000000001 + 0.2", "0.30000000000000001"),
])
def test_safe_arithmetic(expression, expected):
    assert safe_arithmetic(expression) == Decimal(expected)


@pytest.mark.parametrize("expression", [
    "__import__('os').system('echo unsafe')", "x + 1", "1/0", "2**10000",
    "2**-1", "1e6", "[1][0]", "2//1", "2%1", "9" * 201, "1 2 + 7",
])
def test_safe_arithmetic_rejects_unbounded_or_non_arithmetic_input(expression):
    with pytest.raises(ValueError):
        safe_arithmetic(expression)


def test_expression_fixture_answers_are_verified_algebraically(bank):
    # Independent equivalence checks across zero, positive, and negative values.
    expected = {
        12: lambda x: 4 * (x + 3), 13: lambda x: 3 * (2 * x - 5), 14: lambda x: 6 * x + 18,
        30: lambda x: 5 * (x + 4), 31: lambda x: 2 * (3 * x - 4) + x,
        32: lambda x: 3 * (2 * x + 5) - 2 * (x - 4),
        33: lambda x: 4 * (2 * x - 3) - 3 * (x + 2) + 5,
        34: lambda x: 4 * x + 12, 35: lambda x: 5 * x - 15,
        36: lambda x: 8 * x + 12, 37: lambda x: 9 * x - 6,
        38: lambda x: 12 * x + 18, 39: lambda x: 10 * x - 25,
        40: lambda x: 12 * x + 18 + 6 * x,
    }
    assert {q["id"] for q in bank["questions"] if q["questionType"] == "expression"} == {
        f"demo_math_{number:03d}" for number in expected
    }
    for number, calculate in expected.items():
        question = next(q for q in bank["questions"] if q["id"] == f"demo_math_{number:03d}")
        for answer in question["acceptedAnswers"]:
            for x in (-3, 0, 2, 7):
                term = answer.replace(" ", "").replace("x", f"({x})")
                # Insert explicit multiplication at the fixture's implicit products.
                import re
                term = re.sub(r"(?<=\d)\(", "*(", term)
                assert safe_arithmetic(term) == calculate(x)


def test_multiple_choice_math_fixture_has_the_correct_display_value(bank):
    question = next(q for q in bank["questions"] if q["questionType"] == "multiple_choice")
    choice = next(choice for choice in question["choices"] if choice["id"] == question["correctAnswer"])
    assert Decimal(choice["text"]) == safe_arithmetic("20 ÷ 5 × 2")


def test_phase_1_package_still_valid_without_modification():
    source = ROOT / "shared/fixtures/lutz-maths-demo-v1.json"
    bank = json.loads(source.read_text(encoding="utf-8"))
    original = deepcopy(bank)
    assert validate_question_bank(bank)["version"] == 1
    assert len(bank["questions"]) == 20
    assert bank == original


def test_all_six_namespaced_skills_have_varied_fixture_coverage(bank):
    expected = {
        "math.order_operations", "math.parentheses", "math.powers",
        "math.distributivity", "math.factorization", "math.word_problems",
    }
    assert {skill["id"] for skill in bank["skills"]} == expected
    for skill in bank["skills"]:
        questions = [question for question in bank["questions"] if skill["id"] in question["skillIds"]]
        assert len(questions) >= 5
        assert {question["difficulty"] for question in questions} == {1, 2, 3, 4}
        assert skill["subject"] == bank["subject"]


def test_subject_metadata_cannot_cross_contaminate_skills(bank):
    bank["skills"][0]["subject"] = "english"
    with pytest.raises(PackageValidationError, match="skill subject differs"):
        validate_question_bank(bank)


@pytest.mark.parametrize(("number", "calculation", "expected"), [
    (41, "3*2+1", "7"), (42, "4*6+3", "27"), (43, "5*8-6", "34"),
    (44, "24/4+2", "8"), (45, "6**2-8", "28"),
    (46, "2*12.50+3*7.50-5", "42.50"),
    (47, "(3*4*6-9)/7", "9"), (48, "(4*5*6-3*28)/4", "9"),
])
def test_word_problem_fixture_answers_independently_checked(bank, number, calculation, expected):
    # These authored equations were independently matched to the units and text.
    question = next(q for q in bank["questions"] if q["id"] == f"demo_math_{number:03d}")
    assert "math.word_problems" in question["skillIds"]
    calculated = safe_arithmetic(calculation)
    assert calculated == Decimal(expected)
    assert all(Decimal(answer.replace(",", ".")) == calculated for answer in question["acceptedAnswers"])


def test_every_numeric_fixture_has_deterministic_verification_coverage(bank):
    word_problem_ids = {f"demo_math_{number:03d}" for number in range(41, 49)}
    for question in bank["questions"]:
        if question["questionType"] in ("numeric", "decimal"):
            assert question["question"].startswith("Berechne: ") or question["id"] in word_problem_ids

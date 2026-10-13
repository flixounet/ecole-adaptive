"""Strict structured contracts shared by the UI, provider and local pipeline.

Optional provider properties use nullable fields; model_dump(exclude_none=True)
converts them to the existing QuestionBank JSON representation.
"""
from typing import Annotated, Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator
from teacher.config import DEFAULT_POOL_SIZE, DEFAULT_QUESTION_COUNT, DEFAULT_DURATION_MINUTES

Id = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")]
Text = Annotated[str, Field(min_length=1, max_length=10000, pattern=r"\S")]
Language = Annotated[str, Field(pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")]

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)

class Settings(StrictModel):
    studentId: Id
    subject: Id
    grade: Text
    language: Language = "de"
    chapter: str = Field(default="", max_length=10000)
    mode: Literal["learn", "exam", "both"] = "both"
    durationMinutes: Literal[10,20,30,40,45,60] = DEFAULT_DURATION_MINUTES
    difficultyFactor: Literal[0.9,1.0,1.1,1.15,1.25,1.3] = 1.0
    questionCount: int = Field(default=DEFAULT_QUESTION_COUNT, ge=1, le=60)
    poolSize: int = Field(default=DEFAULT_POOL_SIZE, ge=1, le=60)
    @model_validator(mode="after")
    def count_fits(self):
        if self.questionCount > self.poolSize:
            raise ValueError("Die Testlänge darf den Aufgabenpool nicht überschreiten.")
        return self

class Profile(StrictModel):
    id: Id
    name: Annotated[str, Field(min_length=1,max_length=100,pattern=r"\S")]
    grade: Text
    preferredLanguage: Language
    subjects: list[Id] = Field(min_length=1,max_length=100)
    createdAt: str
    archived: bool = False
    @model_validator(mode="after")
    def valid_profile(self):
        try:
            timestamp=datetime.fromisoformat(self.createdAt.replace("Z","+00:00"))
            if timestamp.tzinfo is None:
                raise ValueError("Timestamp requires a timezone")
        except ValueError as error:
            raise ValueError("Profil-Datum muss einen gültigen Zeitpunkt mit Zeitzone enthalten.") from error
        if len(set(self.subjects))!=len(self.subjects):
            raise ValueError("Aktive Fächer müssen eindeutig sein.")
        return self

class SourceFile(StrictModel):
    id: Id
    filename: Text
    storedName: Id
    kind: Literal["image","pdf"]
    mediaType: str
    size: int = Field(gt=0)
    pages: int = Field(ge=1,le=40)
    sha256: str

class SourceReference(StrictModel):
    id: Id
    fileId: Id
    filename: Text
    kind: Literal["image","pdf"]
    page: int = Field(ge=1,le=40)

class Evidence(StrictModel):
    text: Text
    sourceRefs: list[Id] = Field(min_length=1,max_length=100)

class SourceSkill(StrictModel):
    id: Id
    name: Text
    description: Text
    sourceRefs: list[Id] = Field(min_length=1,max_length=100)

class SourceModel(StrictModel):
    sourceId: Id
    studentId: Id
    subject: Id
    grade: Text
    language: Language
    chapter: Text
    learningObjectives: list[Evidence] = Field(max_length=100)
    skills: list[SourceSkill] = Field(max_length=100)
    definitions: list[Evidence] = Field(max_length=200)
    rules: list[Evidence] = Field(max_length=200)
    examples: list[Evidence] = Field(max_length=200)
    exerciseTypes: list[Evidence] = Field(max_length=100)
    difficultyObservations: list[Evidence] = Field(max_length=100)
    commonMistakes: list[Evidence] = Field(max_length=100)
    sourceReferences: list[SourceReference] = Field(min_length=1,max_length=500)
    uncertainties: list[Evidence] = Field(max_length=100)
    @model_validator(mode="after")
    def references_exist(self):
        refs={ref.id for ref in self.sourceReferences}
        if len(refs)!=len(self.sourceReferences):
            raise ValueError("Quellenreferenzen müssen eindeutig sein.")
        if len({s.id for s in self.skills}) != len(self.skills):
            raise ValueError("Skill-IDs müssen eindeutig sein.")
        for group in (self.skills,self.learningObjectives,self.definitions,self.rules,self.examples,self.exerciseTypes,self.difficultyObservations,self.commonMistakes,self.uncertainties):
            for item in group:
                if len(set(item.sourceRefs)) != len(item.sourceRefs) or not set(item.sourceRefs) <= refs:
                    raise ValueError("Unbekannte oder doppelte Quellenreferenz im Quellenmodell.")
        return self

class Choice(StrictModel):
    id: Id
    text: Text
class Question(StrictModel):
    id: Id
    subject: Id
    chapter: Text
    skillIds: list[Id] = Field(min_length=1,max_length=50)
    difficulty: Literal[1,2,3,4]
    points: float = Field(gt=0,le=100)
    questionType: Literal["numeric","decimal","short_text","expression","multiple_choice"]
    question: Text
    instruction: Text
    acceptedAnswers: list[Text] = Field(min_length=1,max_length=30)
    correctAnswer: Text
    explanationSteps: list[Text] = Field(min_length=1,max_length=50)
    hint: Text
    secondHint: Text
    memoryRule: Text
    commonMistake: Text
    sourceRefs: list[Id] = Field(min_length=1,max_length=100)
    estimatedSeconds: int = Field(ge=1,le=7200)
    choices: list[Choice] | None = None
class BankSkill(StrictModel):
    id: Id
    name: Text
    subject: Id | None = None
    chapter: Text | None = None
    description: Text | None = None
class BankSource(StrictModel):
    id: Id
    label: Text
    kind: Literal["fixture","image","pdf"]
class QuestionBank(StrictModel):
    schemaVersion: Literal["1.0"]
    id: Id
    version: int = Field(ge=1)
    title: Text
    subject: Id
    chapter: Text
    grade: Text
    language: Language
    studentIds: list[Id] = Field(min_length=1,max_length=100)
    isDemo: bool
    sourceNotice: Text
    skills: list[BankSkill] = Field(min_length=1,max_length=100)
    sourceRefs: list[BankSource] = Field(min_length=1,max_length=500)
    durationMinutes: int = Field(ge=1,le=240)
    questionCount: int = Field(ge=1,le=1000)
    questions: list[Question] = Field(min_length=1,max_length=1000)

class ValidationIssue(StrictModel):
    severity: Literal["error","warning"]
    code: Id
    questionId: Id | None = None
    message: Text
class ValidationReport(StrictModel):
    valid: bool
    checkedQuestionIds: list[Id] = Field(max_length=1000)
    issues: list[ValidationIssue] = Field(max_length=1000)
    summary: Text
    @model_validator(mode="after")
    def validity_consistent(self):
        if self.valid == any(i.severity == "error" for i in self.issues):
            raise ValueError("Prüfstatus stimmt nicht mit den Fehlern überein.")
        return self

class Blueprint(StrictModel):
    id: Id
    title: Text
    mode: Literal["exam"] = "exam"
    durationMinutes: Literal[10,20,30,40,45,60]
    questionIds: list[Id] = Field(min_length=1,max_length=1000)
    seed: int | None = Field(default=None,ge=0,le=4294967295)
    skillDistribution: dict[Id,float] | None = None
    difficultyDistribution: dict[Literal["1","2","3","4"],float] | None = None
    @model_validator(mode="after")
    def unique_and_percentages(self):
        if len(set(self.questionIds)) != len(self.questionIds):
            raise ValueError("Blueprint enthält doppelte Aufgaben.")
        for distribution in (self.skillDistribution,self.difficultyDistribution):
            if distribution is not None and (not distribution or any(v < 0 or v > 100 for v in distribution.values()) or abs(sum(distribution.values())-100) > 1e-7):
                raise ValueError("Verteilungen müssen 100 Prozent ergeben.")
        return self

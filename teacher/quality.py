"""Local deterministic validation plus explicit review warnings."""
import re
from difflib import SequenceMatcher
from teacher.generator.validation import PackageValidationError, validate_question_bank
from teacher.models import QuestionBank, SourceModel, ValidationIssue, ValidationReport
from teacher.math_checks import polynomial

def check_source_model(source: SourceModel, settings, source_id: str, references) -> SourceModel:
    if source.sourceId != source_id or any(getattr(source,k) != getattr(settings,k) for k in ("studentId","subject","grade","language")):
        raise ValueError("Das Quellenmodell passt nicht zu Schüler, Fach, Klasse oder Sprache dieses Auftrags.")
    expected={ref.id:ref.model_dump() for ref in references}
    actual={ref.id:ref.model_dump() for ref in source.sourceReferences}
    if actual != expected:
        raise ValueError("Quellenreferenzen müssen exakt auf die hochgeladenen Dateien und Seiten verweisen.")
    return source

def local_report(bank: QuestionBank, source: SourceModel) -> ValidationReport:
    issues=[]
    def add(severity,code,message,qid=None):
        issues.append(ValidationIssue(severity=severity,code=code,message=message,questionId=qid))
    try:
        validate_question_bank(bank.model_dump(exclude_none=True))
    except PackageValidationError as error:
        add("error","schema_or_math",str(error))
    source_skills={skill.id for skill in source.skills}
    source_refs={ref.id:ref for ref in source.sourceReferences}
    if not {s.id for s in bank.skills} <= source_skills:
        add("error","new_skill","Der Pool enthält Skills außerhalb des bestätigten Quellenmodells.")
    if bank.isDemo or any(ref.kind == "fixture" for ref in bank.sourceRefs):
        add("error","source_boundary","Echte Unterlagen dürfen nicht mit Demoquellen vermischt werden.")
    if {ref.id for ref in bank.sourceRefs} != set(source_refs):
        add("error","source_boundary","Bank-Quellen müssen den bestätigten Quellenreferenzen entsprechen.")
    for ref in bank.sourceRefs:
        if ref.id in source_refs and ref.kind != source_refs[ref.id].kind:
            add("error","source_boundary","Quellenart wurde verändert.")
    for q in bank.questions:
        if q.chapter != source.chapter:
            add("error","source_boundary","Das Aufgabenkapitel passt nicht zum bestätigten Quellenmodell.",q.id)
        if not set(q.skillIds) <= source_skills or not set(q.sourceRefs) <= set(source_refs):
            add("error","source_boundary","Aufgabe verwendet unbekannte Skills oder Quellen.",q.id)
        if q.questionType == "expression":
            try:
                expected=polynomial(q.correctAnswer)
                for answer in q.acceptedAnswers:
                    if polynomial(answer) != expected:
                        add("error","expression_answer","Eine akzeptierte Ausdrucksvariante ist nicht mathematisch gleichwertig zur richtigen Antwort.",q.id)
                        break
            except ValueError:
                add("warning","expression_unverified","Der Ausdruck liegt außerhalb der begrenzten exakten Polynomprüfung; Antwort und Varianten fachlich prüfen.",q.id)
        if q.questionType in ("short_text","expression"):
            add("warning","answer_variants","Bitte akzeptierte Schreibweisen prüfen; die lokale Bewertung erkennt nur hinterlegte normalisierte Varianten.",q.id)
    # Limited to small authoring pools (at most 60 via Settings); normalized text is
    # bounded to 1000 characters to avoid expensive matching of large imports.
    prompts=[re.sub(r"\s+"," ",q.question.lower()).strip()[:1000] for q in bank.questions]
    for i, text in enumerate(prompts):
        for j in range(i):
            if text != prompts[j] and SequenceMatcher(None,text,prompts[j],autojunk=False).ratio() >= .93:
                add("warning","near_duplicate",f"Aufgabe ähnelt {bank.questions[j].id} sehr stark; Variation bitte prüfen.",bank.questions[i].id)
                break
    if len(bank.questions) < 40:
        add("warning","small_pool",f"Nur {len(bank.questions)} aktive Aufgaben: Für abwechslungsreiches Training sind bei ausreichender Quelle 40–60 sinnvoll.")
    for uncertainty in source.uncertainties:
        add("warning","source_uncertainty",uncertainty.text)
    return ValidationReport(valid=not any(i.severity=="error" for i in issues),checkedQuestionIds=[q.id for q in bank.questions],issues=issues,summary="Lokale Schema-, Referenz-, Duplikat- und verfügbare Rechenprüfungen abgeschlossen.")

def combine_reports(local: ValidationReport, remote: ValidationReport) -> ValidationReport:
    if len(remote.checkedQuestionIds)!=len(set(remote.checkedQuestionIds)) or set(remote.checkedQuestionIds)!=set(local.checkedQuestionIds):
        raise ValueError("Die KI-Prüfung hat nicht alle aktiven Aufgaben eindeutig geprüft.")
    if any(issue.questionId is not None and issue.questionId not in local.checkedQuestionIds for issue in remote.issues):
        raise ValueError("Die KI-Prüfung bezieht sich auf unbekannte Aufgaben.")
    issues=local.issues+remote.issues
    return ValidationReport(valid=not any(i.severity=="error" for i in issues),checkedQuestionIds=local.checkedQuestionIds,issues=issues,summary=local.summary+" "+remote.summary)

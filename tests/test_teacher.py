"""Offline provider doubles exercise the real authoring/publish state machine."""
from copy import deepcopy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from PIL import Image
from pydantic import ValidationError
from pypdf import PdfWriter
from fastapi.testclient import TestClient
from teacher.models import Settings, SourceModel, QuestionBank, Question, ValidationReport, Evidence, Blueprint
from teacher.app import create_app
from teacher.provider import OpenAIProvider, ProviderError
from teacher.publishing import canonical_hash, content_hash, make_package, publish_bank, rebuild_catalog, validate_catalog, validate_content_package, PublishError
from teacher.quality import local_report, check_source_model, combine_reports
from teacher.service import TeacherService
from teacher.store import JobStore
from teacher.uploads import inspect_upload, UploadError

ROOT=Path(__file__).resolve().parents[1]
DEMO=json.loads((ROOT/"shared/fixtures/lutz-maths-demo.json").read_text())

def image_bytes(format="PNG",color="white"):
    output=io.BytesIO();Image.new("RGB",(20,20),color).save(output,format=format);return output.getvalue()

def pdf_bytes(pages=2,encrypted=False):
    writer=PdfWriter()
    for _ in range(pages): writer.add_blank_page(width=100,height=100)
    if encrypted: writer.encrypt("test-password")
    output=io.BytesIO();writer.write(output);return output.getvalue()

class FakeProvider:
    def __init__(self): self.validations=0;self.generations=0;self.fail_validation=False
    def extract_source(self,settings,source_id,files,refs):
        evidence={"text":"Reihenfolge der Rechenarten, ohne neue Konzepte.","sourceRefs":[refs[0].id]}
        return SourceModel(sourceId=source_id,studentId=settings.studentId,subject=settings.subject,grade=settings.grade,language=settings.language,chapter="Bekannte Rechenregeln",learningObjectives=[evidence],skills=[{"id":s["id"],"name":s["name"],"description":s["description"],"sourceRefs":[refs[0].id]} for s in DEMO["skills"]],definitions=[],rules=[evidence],examples=[evidence],exerciseTypes=[evidence],difficultyObservations=[],commonMistakes=[],sourceReferences=refs,uncertainties=[])
    def generate_question_bank(self,settings,source,bank_id):
        self.generations+=1
        data=deepcopy(DEMO)
        data.update(id=bank_id,version=1,title="Quellenbasierte Rechenregeln",grade=settings.grade,chapter=source.chapter,studentIds=[settings.studentId],isDemo=False,sourceNotice="Vom Testprovider aus expliziten Testquellen erzeugt.",questionCount=settings.questionCount,durationMinutes=settings.durationMinutes)
        data["questions"]=data["questions"][:settings.poolSize]
        data["sourceRefs"]=[{"id":r.id,"label":r.filename+f" Seite {r.page}","kind":r.kind} for r in source.sourceReferences]
        for question in data["questions"]: question.update(chapter=source.chapter,sourceRefs=[source.sourceReferences[0].id])
        return QuestionBank.model_validate(data)
    def validate_question_bank(self,source,bank):
        self.validations+=1
        if self.fail_validation: raise ProviderError("Test: Verbindung unterbrochen")
        return ValidationReport(valid=True,checkedQuestionIds=[q.id for q in bank.questions],issues=[],summary="Alle Testaufgaben kontrolliert.")
    def regenerate_question(self,settings,source,question):
        data=question.model_dump()
        data.update(question="Berechne: 9 + 2",acceptedAnswers=["11"],correctAnswer="11")
        return Question.model_validate(data)

@pytest.fixture
def service(tmp_path): return TeacherService(JobStore(tmp_path/"private"),tmp_path/"content",FakeProvider())

@pytest.fixture
def draft(service):
    job=service.create_job(Settings(studentId="max",subject="maths",grade="3eme",poolSize=6,questionCount=3))
    service.add_sources(job.id,[("worksheet.png",image_bytes())])
    service.extract(job.id)
    service.confirm_source(job.id)
    return service.generate(job.id)

@pytest.mark.parametrize("extension,format",[("jpg","JPEG"),("jpeg","JPEG"),("png","PNG"),("webp","WEBP")])
def test_actual_image_formats(extension,format):
    result=inspect_upload("../original."+extension,image_bytes(format))
    assert result.kind=="image" and result.filename=="original."+extension
    assert "original" not in result.storedName and "/" not in result.storedName

@pytest.mark.parametrize("name,data",[("bad.svg",b"<svg/>"),("wrong.png",image_bytes("JPEG")),("bad.pdf",b"fake"),("empty.jpg",b""),("bad.png",b"\x89PNG\r\n\x1a\n")])
def test_corrupt_mismatched_or_unsupported_uploads(name,data):
    with pytest.raises(UploadError): inspect_upload(name,data)

def test_pdf_page_count_and_encryption():
    assert inspect_upload("pages.pdf",pdf_bytes()).pages==2
    with pytest.raises(UploadError,match="Passwort"): inspect_upload("locked.pdf",pdf_bytes(encrypted=True))
    with pytest.raises(UploadError,match="40"): inspect_upload("many.pdf",pdf_bytes(pages=41))

def test_upload_limits_and_control_characters(monkeypatch):
    monkeypatch.setattr("teacher.config.MAX_FILE_BYTES",10)
    with pytest.raises(UploadError): inspect_upload("file.png",image_bytes())
    monkeypatch.setattr("teacher.config.MAX_FILE_BYTES",2000)
    assert inspect_upload("..\\folder\\photo\x00.png",image_bytes()).filename=="photo.png"

def test_batch_upload_is_all_or_nothing(service):
    job=service.create_job(Settings(studentId="max",subject="maths",grade="3eme"))
    with pytest.raises(UploadError): service.add_sources(job.id,[("good.png",image_bytes()),("bad.pdf",b"bad")])
    assert service.store.load(job.id).sources==[]
    assert not list((service.store.directory/"uploads").rglob("*.png"))
    with pytest.raises(UploadError,match="doppelt"): service.add_sources(job.id,[("a.png",image_bytes()),("b.png",image_bytes())])

def test_settings_and_profile_scope(service):
    with pytest.raises(ValidationError): Settings(studentId="max",subject="maths",grade="3eme",durationMinutes=17)
    with pytest.raises(ValidationError): Settings(studentId="max",subject="maths",grade="3eme",questionCount=20,poolSize=10)
    with pytest.raises(ValueError,match="Schülerprofil"): service.create_job(Settings(studentId="foreign",subject="maths",grade="3eme"))
    profiles=service.store.profiles()
    assert [(p.id,p.grade) for p in profiles]==[("max","3eme"),("lutz","5eme"),("ben","CM1")]

def test_source_must_be_reviewed_before_generation(service):
    job=service.create_job(Settings(studentId="max",subject="maths",grade="3eme"))
    with pytest.raises(ValueError,match="bestätigen"): service.generate(job.id)
    assert service.provider.generations==0

def test_source_model_references_must_be_concrete_and_known(service,draft):
    model=draft.sourceModel.model_dump()
    model["rules"][0]["sourceRefs"]=["imaginary-page"]
    with pytest.raises(ValidationError): SourceModel.model_validate(model)
    model=draft.sourceModel.model_dump();model["sourceReferences"][0]["page"]=2
    with pytest.raises(ValueError,match="Seiten"): service.edit_source(draft.id,SourceModel.model_validate(model))
    model=draft.sourceModel.model_dump();model["studentId"]="ben"
    with pytest.raises(ValueError,match="Schüler"): service.edit_source(draft.id,SourceModel.model_validate(model))

def test_source_edit_and_new_file_invalidate_downstream(service,draft):
    edited=service.edit_source(draft.id,draft.sourceModel)
    assert not edited.sourceConfirmed and edited.questionBank is None and not edited.approved
    service.confirm_source(draft.id);service.generate(draft.id)
    changed=service.add_sources(draft.id,[("next.png",image_bytes(color="black"))])
    assert changed.sourceModel is None and changed.questionBank is None

def test_real_workflow_requires_warning_review_then_publishes_immutable_content(service,draft):
    with pytest.raises(ValueError,match="freigegebene"): service.publish(draft.id)
    with pytest.raises(ValueError,match="Warnungen"): service.approve(draft.id)
    service.approve(draft.id,True)
    published=service.publish(draft.id)
    package=json.loads(Path(published.published["packagePath"]).read_text())
    assert validate_content_package(package)==package
    assert package["studentIds"]==["max"] and not package["questionBank"]["isDemo"]
    assert len(package["tests"][0]["questionIds"])==3
    assert service.publish(draft.id).published==published.published
    assert len(list(service.content_dir.glob("packages/*.json")))==1

def test_edit_invalidates_validation_and_approval_then_version_increases(service,draft):
    service.approve(draft.id,True);first=service.publish(draft.id)
    q=draft.questionBank.questions[0].model_copy(update={"hint":"Bearbeiteter Hinweis."})
    edited=service.edit_question(draft.id,q.id,q,True)
    assert not edited.approved and edited.aiValidationHash is None
    with pytest.raises(ValueError,match="Validierung"): service.approve(draft.id,True)
    service.validate(draft.id);service.approve(draft.id,True)
    second=service.publish(draft.id)
    assert second.published["version"]==first.published["version"]+1
    assert Path(first.published["packagePath"]).exists()
    old=json.loads(Path(first.published["packagePath"]).read_text())
    assert old["questionBank"]["questions"][0]["hint"]!=q.hint

def test_disabling_question_rebuilds_blueprint_and_excludes_from_publish(service,draft):
    qid=draft.blueprint.questionIds[0]
    q=next(q for q in draft.questionBank.questions if q.id==qid)
    job=service.edit_question(draft.id,qid,q,False)
    assert qid not in job.blueprint.questionIds
    assert qid not in [q.id for q in service.active_bank(job).questions]
    service.validate(draft.id);service.approve(draft.id,True)
    published=service.publish(draft.id)
    assert published.published["questionCount"]==5

def test_generated_questions_survive_validation_network_error(service,draft):
    service.provider.fail_validation=True
    with pytest.raises(ProviderError): service.generate(draft.id)
    saved=service.store.load(draft.id)
    assert len(saved.questionBank.questions)==6 and saved.aiValidationHash is None and not saved.approved

def test_unknown_source_or_skill_is_blocking(service,draft):
    q=draft.questionBank.questions[0].model_copy(update={"skillIds":["new.stuff"]})
    edited=service.edit_question(draft.id,q.id,q,True)
    assert not edited.validation.valid
    before=service.provider.validations
    service.validate(draft.id)
    assert service.provider.validations==before

def test_math_errors_block_and_near_duplicates_warn(service,draft):
    q=draft.questionBank.questions[0].model_copy(update={"correctAnswer":"999","acceptedAnswers":["999"]})
    report=local_report(draft.questionBank.model_copy(update={"questions":[q]}),draft.sourceModel)
    assert not report.valid and any(i.code=="schema_or_math" for i in report.issues)
    q1=draft.questionBank.questions[0].model_copy(update={"question":"Berechne: 100000 + 1","correctAnswer":"100001","acceptedAnswers":["100001"]})
    q2=q1.model_copy(update={"id":"different","question":"Berechne: 100000 + 2","correctAnswer":"100002","acceptedAnswers":["100002"]})
    report=local_report(draft.questionBank.model_copy(update={"questions":[q1,q2],"questionCount":2}),draft.sourceModel)
    assert any(i.code=="near_duplicate" for i in report.issues)

def test_incomplete_ai_validation_cannot_be_approved(draft):
    local=local_report(draft.questionBank,draft.sourceModel)
    incomplete=ValidationReport(valid=True,checkedQuestionIds=[],issues=[],summary="Unvollständig")
    with pytest.raises(ValueError,match="alle"): combine_reports(local,incomplete)

def test_blueprint_deterministic_and_rejects_disabled_question(service,draft):
    assert service.default_blueprint(draft)==service.default_blueprint(draft)
    with pytest.raises(ValidationError): Blueprint(id="exam",title="Test",durationMinutes=30,questionIds=["x","x"])
    with pytest.raises(ValidationError): Blueprint(id="exam",title="Test",durationMinutes=30,questionIds=["x"],difficultyDistribution={"1":30,"2":30})
    with pytest.raises(ValueError): service.set_blueprint(draft.id,Blueprint(id="exam",title="Test",durationMinutes=30,questionIds=["unknown"]))

def test_store_rejects_traversal(service):
    with pytest.raises(ValueError): service.store.load("../../outside")

@pytest.fixture
def package():
    return make_package(DEMO,["learn","exam"],[{"id":"test","title":"Test","mode":"exam","durationMinutes":30,"questionIds":[DEMO["questions"][0]["id"]]}],version=2,created_at="2026-10-10T00:00:00.000Z")

def test_rfc8785_hash_handles_float_notation_and_key_order():
    assert canonical_hash({"z":1.0,"a":1e-7})==canonical_hash({"a":0.0000001,"z":1})
    # Published sample is also checked by the TypeScript SHA256 parser/build.
    assert len(canonical_hash({"unicode":"Größe 😀"}))==64

def test_corrupted_hash_metadata_blueprint_and_catalog_rejected(package):
    bad=deepcopy(package);bad["questionBank"]["title"]="Changed"
    with pytest.raises(ValueError): validate_content_package(bad)
    bad=deepcopy(package);bad["contentHash"]="0"*64
    with pytest.raises(ValueError,match="Hash"): validate_content_package(bad)
    bad=deepcopy(package);bad["tests"][0]["questionIds"]=["not-found"];bad["contentHash"]=content_hash(bad)
    with pytest.raises(ValueError,match="unbekannte"): validate_content_package(bad)

def test_rebuild_catalog_validates_all_versions_and_keeps_latest(tmp_path,package):
    first=publish_bank(tmp_path,DEMO,["learn"],[])
    second=publish_bank(tmp_path,DEMO,["learn"],[])
    assert second["version"]==first["version"]+1
    catalog=rebuild_catalog(tmp_path)
    assert len(catalog["packages"])==1 and catalog["packages"][0]["version"]==second["version"]
    catalog["packages"][0]["url"]="../outside.json"
    with pytest.raises(ValueError): validate_catalog(catalog)
    path=Path(first["packagePath"]);path.write_text("broken")
    with pytest.raises(ValueError): rebuild_catalog(tmp_path)

class Responses:
    def __init__(self,outputs): self.outputs=iter(outputs);self.calls=[]
    def parse(self,**kwargs): self.calls.append(kwargs);return SimpleNamespace(output_parsed=next(self.outputs))

def test_real_sdk_adapter_uses_structured_multimodal_inputs_without_storage(service,draft):
    responses=Responses([draft.sourceModel])
    provider=OpenAIProvider(client=SimpleNamespace(responses=responses))
    image=draft.sources[0]
    # Add a PDF for transport test; concrete page references remain asserted separately.
    pdf=inspect_upload("pages.pdf",pdf_bytes())
    pdf_path=service.store.directory/"input.pdf";pdf_path.write_bytes(pdf_bytes())
    provider.extract_source(draft.settings,draft.id,[(image,service.store.source_path(draft.id,image)),(pdf,pdf_path)],draft.sourceModel.sourceReferences)
    call=responses.calls[0]
    assert call["store"] is False and call["text_format"] is SourceModel
    content=call["input"][1]["content"]
    assert any(item.get("image_url","").startswith("data:image/png;base64,") for item in content)
    assert any(item.get("file_data","").startswith("data:application/pdf;base64,") for item in content)

def test_malformed_structured_response_retries_exactly_once():
    responses=Responses([None,None,None])
    provider=OpenAIProvider(client=SimpleNamespace(responses=responses))
    with pytest.raises(ProviderError,match="zwei"): provider._parse(ValidationReport,[],instruction="test")
    assert len(responses.calls)==2

def test_no_key_does_not_make_network_call(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY",raising=False)
    with pytest.raises(ProviderError,match="OPENAI_API_KEY"): OpenAIProvider()._parse(ValidationReport,[],instruction="test")

@pytest.fixture
def client(tmp_path):
    app=create_app(data_dir=tmp_path/"private",content_dir=tmp_path/"content",provider=FakeProvider())
    with TestClient(app,base_url="http://127.0.0.1") as client:
        client.headers["X-CSRF-Token"]=client.get("/api/config").json()["csrfToken"]
        yield client

def test_api_rejects_external_origin_missing_csrf_and_host(client):
    body={"studentId":"max","subject":"maths","grade":"3eme"}
    assert client.post("/api/jobs",json=body,headers={"Origin":"https://evil.example"}).status_code==403
    assert client.post("/api/jobs",json=body,headers={"X-CSRF-Token":""}).status_code==403
    assert client.get("/api/config",headers={"Host":"evil.example"}).status_code==400

def test_api_end_to_end_with_fake_provider_and_real_validation_publication(client):
    body={"studentId":"max","subject":"maths","grade":"3eme","poolSize":6,"questionCount":3}
    response=client.post("/api/jobs",json=body);assert response.status_code==201
    job=response.json();base="/api/jobs/"+job["id"]
    assert client.post(base+"/sources",files=[("files",("page.png",image_bytes(),"image/png"))]).status_code==200
    assert client.post(base+"/extract").json()["status"]=="source_review"
    assert client.post(base+"/confirm-source",json={}).json()["sourceConfirmed"]
    generated=client.post(base+"/generate");assert generated.status_code==200,generated.text
    assert generated.json()["validation"]["valid"]
    assert client.post(base+"/approve",json={"acknowledgeWarnings":True}).status_code==200
    publication=client.post(base+"/publish");assert publication.status_code==200,publication.text
    assert publication.json()["published"]["packageId"].startswith("course-")
    assert len(client.get("/api/jobs").json())==1
    assert client.get(base).json()["published"]==publication.json()["published"]

def test_profile_creation_edit_archive_is_persisted(client):
    profile={"id":"ada","name":"Ada","grade":"CM2","preferredLanguage":"fr","subjects":["maths"]}
    created=client.post("/api/profiles",json=profile);assert created.status_code==201
    profile=created.json();profile["archived"]=True
    assert client.put("/api/profiles/ada",json=profile).status_code==200
    assert any(p["id"]=="ada" and p["archived"] for p in client.get("/api/profiles").json())
    assert client.post("/api/jobs",json={"studentId":"ada","subject":"maths","grade":"CM2"}).status_code==422

def test_api_validation_errors_are_readable_and_contain_no_traceback(client):
    response=client.post("/api/jobs",json={"studentId":"max"})
    assert response.status_code==422 and "detail" in response.json()
    assert "Traceback" not in response.text

@pytest.mark.parametrize('left,right',[('3(x + 2)','3x+6'),('2*x + x','3*x'),('(x + 1)^2','x²+2x+1'),('x/2','.5*x'),('a-a','0*a')])
def test_exact_bounded_polynomial_answer_equivalence(left,right):
    from teacher.math_checks import polynomial
    assert polynomial(left)==polynomial(right)

@pytest.mark.parametrize('text',["__import__('os')",'x.__class__','x**1000','1 2+x','x+y','1/(x-1)','[x for x in range(9)]'])
def test_polynomial_rejects_unsupported_or_unsafe_input(text):
    from teacher.math_checks import polynomial
    with pytest.raises(ValueError): polynomial(text)

def test_incorrect_expression_variant_is_blocking(draft):
    question=draft.questionBank.questions[0].model_copy(update={'questionType':'expression','question':'Vereinfache: 3(x+2)','correctAnswer':'3x+6','acceptedAnswers':['3x+6','3x+2']})
    bank=draft.questionBank.model_copy(update={'questions':[question],'questionCount':1})
    report=local_report(bank,draft.sourceModel)
    assert not report.valid and any(issue.code=='expression_answer' for issue in report.issues)

def test_unreadable_sources_can_report_no_content_without_inventing_skills(service,draft):
    source=draft.sourceModel.model_copy(update={'skills':[],'learningObjectives':[],'exerciseTypes':[],'uncertainties':[Evidence(text='Das Bild ist nicht lesbar.',sourceRefs=[draft.sourceModel.sourceReferences[0].id])]})
    service.edit_source(draft.id,source)
    with pytest.raises(ValueError,match='genügend'): service.confirm_source(draft.id)
    assert not service.store.load(draft.id).sourceConfirmed

def test_local_security_headers_and_truncated_jpeg(client):
    response=client.get('/api/config')
    assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    assert response.headers['Cache-Control']=='no-store'
    with pytest.raises(UploadError): inspect_upload('bad.jpg',image_bytes('JPEG')[:-10])

def test_stale_job_revision_prevents_confirming_a_changed_source(client):
    job=client.post('/api/jobs',json={'studentId':'max','subject':'maths','grade':'3eme'}).json()
    base='/api/jobs/'+job['id']
    initial_revision=job['revision']
    response=client.post(base+'/sources',files=[('files',('page.png',image_bytes(),'image/png'))],headers={'X-Job-Revision':str(initial_revision)})
    assert response.status_code==200
    current=response.json()
    assert current['revision']>initial_revision
    stale=client.post(base+'/extract',headers={'X-Job-Revision':str(initial_revision)})
    assert stale.status_code==409 and 'inzwischen' in stale.json()['detail']
    assert client.get(base).json()['sourceModel'] is None
    valid=client.post(base+'/extract',headers={'X-Job-Revision':str(current['revision'])})
    assert valid.status_code==200 and valid.json()['sourceModel'] is not None

@pytest.mark.parametrize('changed',[
    {'durationMinutes':60}, {'questionCount':6}, {'version':2},
])
def test_generated_bank_cannot_change_authoring_settings(service,draft,changed):
    original=service.provider.generate_question_bank
    service.provider.generate_question_bank=lambda *args:original(*args).model_copy(update=changed)
    with pytest.raises(ValueError,match='Einstellungen'): service.generate(draft.id)


def test_openai_sdk_responses_parse_roundtrip_uses_strict_schema_without_network(draft):
    import httpx
    from openai import OpenAI
    captured=[]
    def handler(request):
        body=json.loads(request.content)
        captured.append(body)
        assert request.url.path=='/v1/responses'
        response={'id':'resp_test','object':'response','created_at':1791630000,'status':'completed','model':'gpt-4.1',
                  'output':[{'id':'msg_test','type':'message','status':'completed','role':'assistant','content':[{'type':'output_text','text':draft.sourceModel.model_dump_json(),'annotations':[]}]}]}
        return httpx.Response(200,json=response)
    client=OpenAI(api_key='test-only-no-network',http_client=httpx.Client(transport=httpx.MockTransport(handler)),max_retries=0)
    provider=OpenAIProvider(client=client)
    result=provider._parse(SourceModel,[{'type':'input_text','text':'Test source only'}],instruction='Test')
    assert result==draft.sourceModel
    assert captured[0]['store'] is False
    assert captured[0]['text']['format']['type']=='json_schema'
    assert captured[0]['text']['format']['strict'] is True
    assert captured[0]['text']['format']['schema']['additionalProperties'] is False
    client.close()


def test_cancelled_variable_is_equal_to_constant():
    from teacher.math_checks import polynomial
    assert polynomial('x-x')==polynomial('0')

def test_studio_static_files_are_served_by_actual_application(client):
    page=client.get('/')
    assert page.status_code==200 and '/studio.js' in page.text
    assert client.get('/studio.js').status_code==200
    assert client.get('/studio.css').status_code==200


def test_large_request_is_rejected_before_multipart_parsing(client):
    response=client.post('/api/jobs',content=b'{}',headers={'Content-Length':'999999999','Content-Type':'application/json'})
    assert response.status_code==413


def test_chunked_request_cannot_bypass_body_limit(tmp_path,monkeypatch):
    monkeypatch.setattr('teacher.config.MAX_TOTAL_BYTES',1024)
    app=create_app(data_dir=tmp_path/'private',content_dir=tmp_path/'content',provider=FakeProvider())
    with TestClient(app,base_url='http://127.0.0.1') as client:
        token=client.get('/api/config').json()['csrfToken']
        response=client.post('/api/jobs',content=(b'x'*65536 for _ in range(20)),headers={'X-CSRF-Token':token,'Content-Type':'application/json'})
        assert response.status_code==413


def test_authoring_models_reject_boolean_point_values():
    question=deepcopy(DEMO['questions'][0]);question['points']=True
    with pytest.raises(ValidationError): Question.model_validate(question)

def test_upload_waiting_for_job_lock_does_not_block_the_api_event_loop(tmp_path,monkeypatch):
    import asyncio
    import threading
    import httpx
    app=create_app(data_dir=tmp_path/'private',content_dir=tmp_path/'content',provider=FakeProvider())
    service=app.state.service
    original=service.add_sources
    entered=threading.Event();released=threading.Event()
    def locked_upload(*args):
        entered.set()
        released.wait(timeout=2)
        return original(*args)
    monkeypatch.setattr(service,'add_sources',locked_upload)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1') as client:
            token=(await client.get('/api/config')).json()['csrfToken']
            client.headers['X-CSRF-Token']=token
            job=(await client.post('/api/jobs',json={'studentId':'max','subject':'maths','grade':'3eme'})).json()
            upload=asyncio.create_task(client.post('/api/jobs/'+job['id']+'/sources',files=[('files',('page.png',image_bytes(),'image/png'))]))
            try:
                assert await asyncio.to_thread(entered.wait,1)
                config=await client.get('/api/config')
                assert config.status_code==200
                assert not upload.done(), 'Blocked upload must not occupy the ASGI event loop'
            finally:
                released.set()
            assert (await upload).status_code==200
    asyncio.run(scenario())

const root = document.querySelector('#studio');
const state = {
  config: null,
  profiles: [],
  jobs: [],
  job: null,
  busy: '',
  error: '',
  message: '',
  sourceDraft: null,
  questionDraft: null,
};
const durations = [10, 20, 30, 40, 45, 60];
const subjects = [
  ['maths', 'Mathematik'],
  ['french', 'Französisch'],
  ['english', 'Englisch'],
  ['svt', 'SVT'],
  ['history_geography', 'Geschichte-Geographie'],
];
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clone = (value) => JSON.parse(JSON.stringify(value));
const selected = (a, b) => (a === b ? ' selected' : '');
const disabled = (condition) => (condition ? ' disabled' : '');
const lines = (value) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
const csv = (value) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const field = (label, name, value, extra = '') =>
  `<label>${esc(label)}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }
  if (options.method && options.method !== 'GET') {
    headers.set('X-CSRF-Token', state.config.csrfToken);
    if (state.job && path.startsWith(`/jobs/${state.job.id}/`))
      headers.set('X-Job-Revision', String(state.job.revision));
  }
  const response = await fetch(`/api${path}`, { ...options, headers });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Der lokale Server hat keine lesbare Antwort geliefert. Bitte neu versuchen.');
  }
  if (!response.ok) {
    const detail = data.detail ?? data.message ?? data.error;
    const error = new Error(
      typeof detail === 'string'
        ? detail
        : 'Die Eingaben konnten nicht verarbeitet werden. Bitte Felder und Dateiformate prüfen.',
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
async function run(label, task) {
  if (state.busy) return;
  state.busy = label;
  state.error = '';
  state.message = '';
  render();
  try {
    await task();
  } catch (error) {
    state.error = error.message || 'Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.';
    if (state.job) {
      try {
        const saved = await api(`/jobs/${state.job.id}`);
        state.job = saved;
        if (error.status === 409)
          state.sourceDraft = saved.sourceModel ? clone(saved.sourceModel) : null;
      } catch {
        /* Preserve the current screen when the server is unreachable. */
      }
    }
  } finally {
    state.busy = '';
    render();
  }
}
async function loadJob(id) {
  state.job = await api(`/jobs/${id}`);
  state.sourceDraft = state.job.sourceModel ? clone(state.job.sourceModel) : null;
}
async function mutation(action, body = {}, method = 'POST') {
  state.job = await api(`/jobs/${state.job.id}${action}`, { method, body });
  state.sourceDraft = state.job.sourceModel ? clone(state.job.sourceModel) : null;
  state.jobs = await api('/jobs');
}
function options(values, current) {
  return values
    .map((v) => `<option value="${esc(v)}"${selected(v, current)}>${esc(v)}</option>`)
    .join('');
}
function profileOptions() {
  return state.profiles
    .filter((p) => !p.archived)
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.grade)}</option>`)
    .join('');
}
function createForm() {
  const profile = state.profiles.find((p) => !p.archived);
  return `<section class="card"><div class="section-top"><h2>Unterricht vorbereiten</h2><button data-action="add-profile">+ Schüler</button></div>
  <form id="settings-form"><div class="grid">
    <label>Schüler<select name="studentId" id="student-select">${profileOptions()}</select></label>
    <label>Fach<select name="subject">${subjects.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}<option value="custom">Eigenes Fach …</option></select></label>
    ${field('Klassenstufe', 'grade', profile?.grade ?? '', 'required')}
    <label>Sprache der Aufgaben<select name="language"><option value="de">Deutsch</option><option value="fr">Français</option><option value="en">English</option></select></label>
    <label>Modus<select name="mode"><option value="both">Lernen und Klassenarbeit</option><option value="learn">Lernen</option><option value="exam">Klassenarbeit</option></select></label>
    <label>Dauer<select name="durationMinutes">${durations.map((n) => `<option value="${n}"${selected(n, 30)}>${n} Minuten</option>`).join('')}</select></label>
    <label>Anspruch<select name="difficultyFactor">${[
      [0.9, '0,9 · Etwas leichter'],
      [1, '1,0 · Unterrichtsniveau'],
      [1.1, '1,1 · Etwas anspruchsvoller'],
      [1.15, '1,15 · Mehr Verknüpfungen'],
      [1.25, '1,25 · Anspruchsvoll'],
      [1.3, '1,3 · Komplexere bekannte Inhalte'],
    ]
      .map(([n, label]) => `<option value="${n}"${selected(n, 1)}>${label}</option>`)
      .join('')}</select></label>
    ${field('Aufgaben pro Runde / Prüfung', 'questionCount', 18, 'type="number" min="1" max="60" required')}
    ${field('Gewünschter Aufgabenpool', 'poolSize', 48, 'type="number" min="1" max="60" required')}
    <div class="full">${field('Kapitel (optional; sonst aus Quellen erkennen)', 'chapter', '')}</div>
  </div><p class="muted">Mehr Anspruch bedeutet komplexere Kombinationen des bekannten Stoffs. Umfang und Lernziele werden durch die hochgeladenen Quellen begrenzt.</p>
  <div class="actions"><button class="primary" type="submit">Vorbereitung anlegen</button></div></form></section>`;
}
const groupLabels = {
  learningObjectives: 'Lernziele',
  definitions: 'Begriffe',
  rules: 'Regeln',
  examples: 'Beispiele',
  exerciseTypes: 'Aufgabentypen',
  difficultyObservations: 'Niveaubeobachtungen',
  commonMistakes: 'Typische Fehler',
  uncertainties: 'Unsicherheiten',
};
function sourceReview(job) {
  const source = state.sourceDraft ?? job.sourceModel;
  if (!source) return '';
  return `<section class="card source-section"><span class="eyebrow">2 · QUELLEN PRÜFEN</span><h2>Das steckt in den Unterlagen</h2>
    <p class="notice">Kontrolliere die Erkennung vor der Aufgabenerstellung. Korrigiere Fehlinterpretationen oder entferne unklare Inhalte. Jeder Eintrag ist auf eine Datei und Seite zurückgeführt.</p>
    <form id="source-form">${field('Erkanntes Kapitel', 'chapter', source.chapter, 'required data-source-chapter')}
    <div class="source-grid">${Object.entries(groupLabels)
      .map(
        ([key, label]) =>
          `<section><h3>${label}</h3>${source[key].length ? source[key].map((item, index) => `<div class="evidence"><label>${label} ${index + 1}<textarea aria-label="${label} ${index + 1}" data-source-group="${key}" data-index="${index}">${esc(item.text)}</textarea></label><div class="source-ref">${esc(item.sourceRefs.join(', '))}</div><button type="button" class="quiet danger" data-action="remove-evidence" data-group="${key}" data-index="${index}">Eintrag entfernen</button></div>`).join('') : '<p class="muted">Keine Einträge erkannt.</p>'}</section>`,
      )
      .join('')}</div>
    <h3>Skills</h3>${source.skills.map((skill, index) => `<div class="grid two evidence">${field('Bezeichnung', `skill-name-${index}`, skill.name, `required data-skill-name="${index}"`)}${field('Beschreibung', `skill-description-${index}`, skill.description, `required data-skill-description="${index}"`)}<small class="full">${esc(skill.id)} · ${esc(skill.sourceRefs.join(', '))}</small></div>`).join('')}
    <details><summary>Dateien und Seiten</summary><ul>${source.sourceReferences.map((ref) => `<li><strong>${esc(ref.id)}</strong>: ${esc(ref.filename)}, Seite ${ref.page}</li>`).join('')}</ul></details>
    <div class="actions"><button type="submit">Korrekturen speichern</button><button class="primary" type="button" data-action="confirm-source"${disabled(job.sourceConfirmed)}>Analyse bestätigen</button></div>
    ${job.sourceConfirmed ? '<p class="status">✓ Quellenmodell bestätigt. Die Aufgaben dürfen nur diese Lernziele verwenden.</p>' : '<p class="muted">Erst Korrekturen speichern, dann Analyse bestätigen.</p>'}
    </form></section>`;
}
function questionReview(job) {
  if (!job.questionBank) return '';
  const bank = job.questionBank,
    report = job.validation;
  const enabled = bank.questions.filter((q) => !job.disabledQuestionIds.includes(q.id));
  const issueIds = new Set(report?.issues.filter((i) => i.questionId).map((i) => i.questionId));
  return `<section class="card"><span class="eyebrow">4 · AUFGABEN PRÜFEN</span><h2>${bank.questions.length} Aufgaben erstellt</h2>
    <p>${enabled.length} aktiv · ${report ? `${enabled.filter((q) => !issueIds.has(q.id)).length} ohne gemeldeten Einzelbefund` : 'Prüfung ausstehend'}</p>
    ${report ? `<div class="${report.valid ? 'notice' : 'error'}">${esc(report.summary)}</div><ul class="issues">${report.issues.map((i) => `<li class="${i.severity}-item"><strong>${i.severity === 'error' ? 'Fehler' : 'Kontrolle'}${i.questionId ? ` · ${esc(i.questionId)}` : ''}:</strong> ${esc(i.message)}</li>`).join('')}</ul>` : '<p class="notice warning">Die Aufgaben müssen nach Änderungen erneut validiert werden.</p>'}
    ${!job.aiValidationHash ? '<p class="notice warning">Die aktuelle Fassung benötigt noch eine erfolgreiche KI-Prüfung, bevor sie freigegeben werden kann.</p>' : ''}<div class="actions"><button data-action="validate">Aufgaben erneut validieren</button></div>
    <ul class="question-list">${bank.questions.map((q, index) => `<li${job.disabledQuestionIds.includes(q.id) ? ' class="disabled"' : ''}><span class="tag">${index + 1} · ${esc(q.id)}</span><span class="tag">Level ${q.difficulty}</span><span class="tag">${q.points} Punkte</span><span class="tag">${esc(q.questionType)}</span><h3>${esc(q.question)}</h3><p>${esc(q.instruction)}</p>${q.choices ? `<ul>${q.choices.map((choice) => `<li><strong>${esc(choice.id)}:</strong> ${esc(choice.text)}</li>`).join('')}</ul>` : ''}<small>Skills: ${esc(q.skillIds.join(', '))} · Quellen: ${esc(q.sourceRefs.join(', '))}</small><details><summary>Antwort, Hinweise und Lösungsweg</summary><p><strong>Antwort:</strong> ${esc(q.correctAnswer)}</p><p>Akzeptiert: ${esc(q.acceptedAnswers.join(' · '))}</p><ol>${q.explanationSteps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol><p><strong>Hinweis:</strong> ${esc(q.hint)}</p><p><strong>Zweiter Hinweis:</strong> ${esc(q.secondHint)}</p><p><strong>Merksatz:</strong> ${esc(q.memoryRule)}</p><p><strong>Typischer Fehler:</strong> ${esc(q.commonMistake)}</p></details><div class="actions"><button data-action="edit-question" data-id="${esc(q.id)}">Bearbeiten</button><button data-action="toggle-question" data-id="${esc(q.id)}">${job.disabledQuestionIds.includes(q.id) ? 'Aktivieren' : 'Deaktivieren'}</button><button data-action="regenerate" data-id="${esc(q.id)}">Neu generieren</button></div></li>`).join('')}</ul>
  </section>`;
}
function blueprint(job) {
  if (!job.questionBank || job.settings.mode === 'learn') return '';
  const bank = job.questionBank,
    plan = job.blueprint;
  const selectedQuestions = new Set(plan?.questionIds ?? []);
  const enabled = bank.questions.filter((q) => !job.disabledQuestionIds.includes(q.id));
  const points = enabled
    .filter((q) => selectedQuestions.has(q.id))
    .reduce((sum, q) => sum + q.points, 0);
  const ordered = [
    ...(plan?.questionIds ?? []).map((id) => enabled.find((q) => q.id === id)).filter(Boolean),
    ...enabled.filter((q) => !selectedQuestions.has(q.id)),
  ];
  return `<section class="card"><span class="eyebrow">5 · KLASSENARBEIT ZUSAMMENSTELLEN</span><h2>Dein fester Prüfungsplan</h2><p>${selectedQuestions.size} Aufgaben · ${points} Punkte · ${plan?.durationMinutes ?? job.settings.durationMinutes} Minuten</p>
    <form id="blueprint-form"><div class="grid two">${field('Titel', 'title', plan?.title ?? bank.title, 'required')}<label>Dauer<select name="durationMinutes">${options(durations, plan?.durationMinutes ?? job.settings.durationMinutes)}</select></label></div>
    <p class="muted">Die gewählten Aufgaben werden in dieser Reihenfolge gespeichert. Während der Prüfung bleibt die Auswahl unverändert.</p>
    <div class="plan-list">${ordered.map((q, index) => `<label class="check"><input type="checkbox" name="questionIds" value="${esc(q.id)}"${selectedQuestions.has(q.id) ? ' checked' : ''}><span>${selectedQuestions.has(q.id) ? `${index + 1}. ` : ''}${esc(q.id)} · ${esc(q.question)} <small>(${q.points} Punkte · Level ${q.difficulty})</small></span></label>`).join('')}</div>
    ${
      plan?.skillDistribution
        ? `<p class="muted">Skill-Verteilung: ${Object.entries(plan.skillDistribution)
            .map(
              ([id, value]) =>
                `${esc(bank.skills.find((s) => s.id === id)?.name ?? id)} ${Math.round(value)} %`,
            )
            .join(' · ')}</p>`
        : ''
    }
    ${
      plan?.difficultyDistribution
        ? `<p class="muted">Difficulty: ${Object.entries(plan.difficultyDistribution)
            .map(([id, value]) => `Level ${esc(id)} ${Math.round(value)} %`)
            .join(' · ')}</p>`
        : ''
    }
    <div class="actions"><button type="submit">Prüfungsplan speichern</button></div></form></section>`;
}
function renderJob(job) {
  const profile = state.profiles.find((p) => p.id === job.settings.studentId);
  return `<section class="card"><div class="section-top"><div><span class="eyebrow">1 · UNTERRICHTSQUELLEN</span><h2>${esc(profile?.name ?? job.settings.studentId)} · ${esc(subjects.find((s) => s[0] === job.settings.subject)?.[1] ?? job.settings.subject)}</h2></div><button data-action="new-job">Neue Vorbereitung</button></div><p>${esc(job.settings.grade)} · ${job.settings.durationMinutes} Minuten · Anspruch ${job.settings.difficultyFactor} · Profil-ID <span class="profile-id">${esc(job.settings.studentId)}</span></p>
  <div class="drop" id="drop-zone"><strong>Unterrichtsfotos oder PDFs hierher ziehen</strong><p>JPG, PNG, WebP, PDF · mehrere Dateien möglich</p><label>Dateien hinzufügen<input id="source-files" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" multiple></label></div>
  <p class="file-note">Maximal 20 MB pro Datei, 45 MB insgesamt, 20 Dateien und 40 Seiten je PDF. Originaldateien bleiben privat auf diesem Mac. Beim bewussten Starten der KI-Analyse werden sie an OpenAI übertragen.</p>
  <ul class="file-list">${job.sources.map((file) => `<li><span><a href="/api/jobs/${esc(job.id)}/sources/${esc(file.id)}" target="_blank" rel="noopener"><strong>${esc(file.filename)}</strong></a><br><small>${file.pages} Seite(n) · ${(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button class="quiet danger" data-action="remove-file" data-id="${esc(file.id)}">Entfernen</button></li>`).join('')}</ul>
  <div class="actions"><button class="primary" data-action="extract"${disabled(!job.sources.length || !state.config.keyConfigured)}>Unterlagen analysieren</button></div></section>
  ${sourceReview(job)}
  ${job.sourceConfirmed ? `<section class="card"><span class="eyebrow">3 · AUFGABEN ERSTELLEN</span><h2>Aus bekanntem Stoff wird Übung.</h2><p>Ziel: ${job.settings.poolSize} Fragen, soweit die Unterlagen ausreichend Stoff liefern. Anschließend folgen Schema-, Rechen- und KI-Prüfung.</p><button class="primary" data-action="generate"${disabled(!state.config.keyConfigured)}>Aufgabenpool ${job.questionBank ? 'neu erstellen' : 'erzeugen'}</button></section>` : ''}
  ${questionReview(job)}${blueprint(job)}
  ${
    job.questionBank
      ? `<section class="card"><span class="eyebrow">6 · FREIGEBEN UND VERÖFFENTLICHEN</span><h2>Bereit für den Lernraum?</h2><p class="notice warning">Statische Pakete sind auf einem öffentlichen Host ohne Anmeldung abrufbar. Veröffentlicht werden Aufgaben, Quellenbezeichnungen und Profil-IDs. Prüfe diese Texte auf persönliche Angaben. Originalfotos und PDFs werden nicht mit veröffentlicht.</p>
    <label class="check"><input id="approve-review" type="checkbox"><span>Ich habe Quellen, Aufgaben und Hinweise geprüft und offene Warnungen bewusst bewertet.</span></label><div class="actions"><button data-action="approve"${disabled(!job.validation?.valid || !job.aiValidationHash)}>Aufgaben freigeben</button><button class="primary" data-action="publish"${disabled(!job.approved)}>Für Schüler veröffentlichen</button></div>
    ${job.approved ? '<p class="status">✓ Freigabe gespeichert.</p>' : ''}
    ${job.published ? `<div class="notice report"><h3>✓ Lokal veröffentlicht</h3><p>${esc(job.published.message)}</p><p>Paketversion ${job.published.version} · ${job.published.questionCount} Aufgaben · ${job.published.blueprintQuestionCount} Prüfungsaufgaben</p><p><code>${esc(job.published.packagePath)}</code></p><p>SHA-256: <code>${esc(job.published.contentHash)}</code></p><p>Die lokale Student-App liest den neuen Katalog. Für das iPad muss der aktualisierte statische Build auf deinen HTTPS-Host übertragen werden. Es erfolgt kein automatischer Git-Push.</p></div>` : ''}</section>`
      : ''
  }`;
}
function render() {
  if (!state.config) return;
  root.innerHTML = `<span class="eyebrow">VOM UNTERRICHT ZUM VERSTEHEN</span><h1>Ein Lernraum, der zum Kind passt.</h1><p class="intro">Unterlagen einlesen, erkannte Lernziele prüfen und passende Übungsaufgaben freigeben. Du behältst die Kontrolle über den Inhalt.</p>
    <p class="muted">KI-Modell: ${esc(state.config.model)} · ${state.config.keyConfigured ? 'API-Schlüssel lokal konfiguriert' : 'Noch kein API-Schlüssel konfiguriert'}</p>
    ${!state.config.keyConfigured ? '<p class="notice warning">Trage OPENAI_API_KEY in die lokale .env-Datei ein und starte das Teacher Studio neu. Der Schlüssel gehört ausschließlich auf diesen Mac.</p>' : ''}
    ${state.busy ? `<p class="notice" role="status"><span class="busy-indicator" aria-hidden="true"></span>${esc(state.busy)} Bitte dieses Fenster geöffnet lassen.</p>` : ''}
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}${state.message ? `<p class="status" role="status">${esc(state.message)}</p>` : ''}
    ${state.jobs.length ? `<details><summary>Gespeicherte Vorbereitungen (${state.jobs.length})</summary><div class="row"><label>Vorbereitung auswählen<select id="job-select"><option value="">Bitte wählen</option>${state.jobs.map((j) => `<option value="${esc(j.id)}"${selected(j.id, state.job?.id)}>${esc(j.settings.studentId)} · ${esc(j.settings.chapter || j.sourceModel?.chapter || j.settings.subject)} · ${new Date(j.updatedAt).toLocaleDateString('de-DE')}</option>`).join('')}</select></label></div></details>` : ''}
    <ol class="steps"><li class="${!state.job?.sourceModel ? 'current' : ''}">1 Quellen</li><li class="${state.job?.sourceModel && !state.job.sourceConfirmed ? 'current' : ''}">2 Analyse</li><li class="${state.job?.sourceConfirmed && !state.job.approved ? 'current' : ''}">3 Aufgaben & Prüfung</li><li class="${state.job?.approved ? 'current' : ''}">4 Veröffentlichung</li></ol>
    ${state.job ? renderJob(state.job) : createForm()}`;
  if (state.busy)
    root.querySelectorAll('button,input,select,textarea').forEach((el) => (el.disabled = true));
  bind();
}
function sourceChanged(event) {
  const el = event.target;
  if (el.hasAttribute('data-source-chapter')) state.sourceDraft.chapter = el.value;
  if (el.dataset.sourceGroup)
    state.sourceDraft[el.dataset.sourceGroup][Number(el.dataset.index)].text = el.value;
  if (el.hasAttribute('data-skill-name'))
    state.sourceDraft.skills[Number(el.dataset.skillName)].name = el.value;
  if (el.hasAttribute('data-skill-description'))
    state.sourceDraft.skills[Number(el.dataset.skillDescription)].description = el.value;
}
async function upload(files) {
  if (!files.length) return;
  const body = new FormData();
  for (const file of files) body.append('files', file);
  await run('Dateien werden geprüft und lokal gespeichert …', async () => {
    state.job = await api(`/jobs/${state.job.id}/sources`, { method: 'POST', body });
    state.sourceDraft = null;
  });
}
function bind() {
  document.querySelector('#settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    for (const key of ['durationMinutes', 'difficultyFactor', 'questionCount', 'poolSize'])
      data[key] = Number(data[key]);
    if (data.subject === 'custom') {
      const id = prompt('Fach-ID (wie im Schülerprofil, z. B. physics):');
      if (!id) return;
      data.subject = id.trim();
    }
    void run('Vorbereitung wird angelegt …', async () => {
      state.job = await api('/jobs', { method: 'POST', body: data });
      state.sourceDraft = null;
      state.jobs = await api('/jobs');
    });
  });
  document.querySelector('#student-select')?.addEventListener('change', (event) => {
    const profile = state.profiles.find((p) => p.id === event.target.value);
    const form = document.querySelector('#settings-form');
    form.elements.grade.value = profile.grade;
    form.elements.language.value = profile.preferredLanguage;
  });
  document.querySelector('#job-select')?.addEventListener('change', (event) => {
    if (event.target.value)
      void run('Vorbereitung wird geladen …', () => loadJob(event.target.value));
  });
  document
    .querySelector('#source-files')
    ?.addEventListener('change', (event) => void upload([...event.target.files]));
  const drop = document.querySelector('#drop-zone');
  drop?.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!state.busy) drop.classList.add('drag');
  });
  drop?.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop?.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drag');
    if (!state.busy) void upload([...event.dataTransfer.files]);
  });
  document.querySelector('#source-form')?.addEventListener('input', sourceChanged);
  document.querySelector('#source-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void run('Korrekturen werden geprüft …', () =>
      mutation('/source', { sourceModel: state.sourceDraft }, 'PUT'),
    );
  });
  document.querySelector('#blueprint-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const job = state.job;
    const selectedIds = data.getAll('questionIds');
    const previousOrder = job.blueprint?.questionIds.filter((id) => selectedIds.includes(id)) ?? [];
    const questionIds = [
      ...previousOrder,
      ...selectedIds.filter((id) => !previousOrder.includes(id)),
    ];
    const plan = {
      id: job.blueprint?.id ?? 'exam-1',
      title: data.get('title'),
      mode: 'exam',
      durationMinutes: Number(data.get('durationMinutes')),
      questionIds,
    };
    void run('Prüfungsplan wird gespeichert …', () =>
      mutation('/blueprint', { blueprint: plan }, 'PUT'),
    );
  });
  root
    .querySelectorAll('[data-action]')
    .forEach((button) =>
      button.addEventListener('click', () => act(button.dataset.action, button.dataset)),
    );
}
function act(action, data) {
  const job = state.job;
  if (action === 'new-job') {
    state.job = null;
    state.sourceDraft = null;
    state.error = '';
    render();
    return;
  }
  if (action === 'add-profile') {
    profileDialog();
    return;
  }
  if (action === 'edit-question') {
    questionDialog(job.questionBank.questions.find((q) => q.id === data.id));
    return;
  }
  if (action === 'remove-evidence') {
    state.sourceDraft[data.group].splice(Number(data.index), 1);
    render();
    return;
  }
  if (
    ['confirm-source', 'generate', 'validate', 'approve', 'publish', 'regenerate'].includes(
      action,
    ) &&
    JSON.stringify(state.sourceDraft) !== JSON.stringify(job.sourceModel)
  ) {
    state.error =
      'Bitte die Quellenkorrekturen zuerst speichern und die Analyse erneut bestätigen.';
    render();
    return;
  }
  if (action === 'approve' && !document.querySelector('#approve-review').checked) {
    state.error = 'Bitte die Prüfung von Aufgaben und Warnungen bewusst bestätigen.';
    render();
    return;
  }
  if (
    ['extract', 'generate'].includes(action) &&
    ((action === 'extract' && job.sourceModel) || (action === 'generate' && job.questionBank)) &&
    !confirm(
      'Dieser Schritt ersetzt die bisherige Analyse bzw. den Aufgabenpool und hebt die Freigabe auf. Fortfahren?',
    )
  )
    return;
  const tasks = {
    'remove-file': [
      'Datei wird entfernt …',
      () => mutation(`/sources/${data.id}`, undefined, 'DELETE'),
    ],
    extract: ['Unterlagen werden von der KI analysiert …', () => mutation('/extract')],
    'confirm-source': ['Quellenmodell wird bestätigt …', () => mutation('/confirm-source')],
    generate: [
      'Aufgaben werden erzeugt und geprüft. Das kann einige Minuten dauern …',
      () => mutation('/generate'),
    ],
    validate: ['Aufgaben werden fachlich und strukturell geprüft …', () => mutation('/validate')],
    regenerate: [
      'Die einzelne Aufgabe wird neu erstellt …',
      () => mutation(`/questions/${data.id}/regenerate`),
    ],
    'toggle-question': [
      'Aufgabenauswahl wird gespeichert …',
      () =>
        mutation(
          `/questions/${data.id}`,
          {
            question: job?.questionBank?.questions.find((q) => q.id === data.id),
            enabled: job?.disabledQuestionIds.includes(data.id),
          },
          'PUT',
        ),
    ],
    approve: [
      'Freigabe wird gespeichert …',
      () => mutation('/approve', { acknowledgeWarnings: true }),
    ],
    publish: ['Paket und Katalog werden geprüft und veröffentlicht …', () => mutation('/publish')],
  };
  if (tasks[action]) void run(...tasks[action]);
}
function showDialog(html, onSubmit) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = html;
  document.body.append(dialog);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit(new FormData(event.target), dialog);
  });
  dialog.showModal();
}
function questionDialog(question) {
  state.questionDraft = clone(question);
  showDialog(
    `<form><h2>Aufgabe bearbeiten</h2><p class="muted">ID: ${esc(question.id)} · Alle Änderungen erfordern eine erneute Validierung und Freigabe.</p>
    <label>Frage<textarea name="question" required>${esc(question.question)}</textarea></label>${field('Arbeitsanweisung', 'instruction', question.instruction, 'required')}
    <div class="grid two"><label>Aufgabentyp<select name="questionType">${options(['numeric', 'decimal', 'short_text', 'expression', 'multiple_choice'], question.questionType)}</select></label><label>Difficulty<select name="difficulty">${options([1, 2, 3, 4], question.difficulty)}</select></label>${field('Punkte', 'points', question.points, 'type="number" min="0.1" max="100" step="0.1" required')}${field('Geschätzte Sekunden', 'estimatedSeconds', question.estimatedSeconds, 'type="number" min="1" max="7200" required')}</div>
    ${field('Richtige Antwort (bei Multiple Choice die Auswahl-ID)', 'correctAnswer', question.correctAnswer, 'required')}
    <label>Akzeptierte Antworten (eine je Zeile)<textarea name="acceptedAnswers" required>${esc(question.acceptedAnswers.join('\n'))}</textarea></label>
    <label>Lösungsschritte (ein Schritt je Zeile)<textarea name="explanationSteps" required>${esc(question.explanationSteps.join('\n'))}</textarea></label>
    ${['hint', 'secondHint', 'memoryRule', 'commonMistake'].map((key, i) => field(['Erster Hinweis', 'Zweiter Hinweis', 'Merksatz', 'Typischer Fehler'][i], key, question[key], 'required')).join('')}
    ${field('Skill-IDs (Komma getrennt)', 'skillIds', question.skillIds.join(', '), 'required')}${field('Quellenreferenzen (Komma getrennt)', 'sourceRefs', question.sourceRefs.join(', '), 'required')}
    <label>Multiple-Choice-Auswahlen (ID | Text, eine je Zeile)<textarea name="choices">${esc(question.choices?.map((c) => `${c.id} | ${c.text}`).join('\n') ?? '')}</textarea></label>
    <div class="actions"><button type="submit" class="primary">Änderungen speichern</button><button type="button" data-close>Abbrechen</button></div></form>`,
    (form, dialog) => {
      const next = { ...question, ...Object.fromEntries(form) };
      for (const key of ['points', 'difficulty', 'estimatedSeconds']) next[key] = Number(next[key]);
      for (const key of ['acceptedAnswers', 'explanationSteps']) next[key] = lines(next[key]);
      for (const key of ['skillIds', 'sourceRefs']) next[key] = csv(next[key]);
      if (next.questionType === 'multiple_choice')
        next.choices = lines(next.choices).map((line) => {
          const i = line.indexOf('|');
          return { id: line.slice(0, i).trim(), text: line.slice(i + 1).trim() };
        });
      else delete next.choices;
      dialog.close();
      void run('Aufgabe wird gespeichert …', () =>
        mutation(
          `/questions/${question.id}`,
          { question: next, enabled: !state.job.disabledQuestionIds.includes(question.id) },
          'PUT',
        ),
      );
    },
  );
}
function profileDialog() {
  showDialog(
    `<form><h2>Schüler im Teacher Studio hinzufügen</h2><p>Verwende dieselbe Profil-ID wie in der Schüler-App. Dort wird sie unter „Schüler verwalten“ angezeigt.</p>${field('Profil-ID', 'id', '', 'required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]*"')}${field('Name', 'name', '', 'required')}${field('Klassenstufe', 'grade', '', 'required')}<label>Sprache<select name="preferredLanguage"><option value="de">Deutsch</option><option value="fr">Français</option><option value="en">English</option></select></label>${field('Aktive Fach-IDs (Komma getrennt)', 'subjects', 'maths, french, english, svt, history_geography', 'required')}<div class="actions"><button type="submit" class="primary">Schüler anlegen</button><button type="button" data-close>Abbrechen</button></div></form>`,
    (form, dialog) => {
      const profile = Object.fromEntries(form);
      profile.subjects = csv(profile.subjects);
      profile.createdAt = new Date().toISOString();
      profile.archived = false;
      dialog.close();
      void run('Profil wird gespeichert …', async () => {
        await api('/profiles', { method: 'POST', body: profile });
        state.profiles = await api('/profiles');
      });
    },
  );
}
async function boot() {
  try {
    state.config = await api('/config');
    [state.profiles, state.jobs] = await Promise.all([api('/profiles'), api('/jobs')]);
    render();
  } catch (error) {
    root.textContent = `Teacher Studio konnte nicht geladen werden: ${error.message}`;
  }
}
void boot();

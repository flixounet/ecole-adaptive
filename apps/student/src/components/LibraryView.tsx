import { useState } from 'react';
import type { QuestionBank, StudentProfile } from '@shared/types';
import type { ContentPackage } from '@shared/content';
import type { Result, Session, SessionMode } from '../domain/session';
import { Arrow, BookArt } from './LearningVisuals';
import { number, subjectLabel } from './format';
export function LibraryView({
  profile,
  profiles,
  banks,
  results,
  savedSession,
  busy,
  onStart,
  onResume,
  onSelect,
  onResult,
  packages = [],
  availableCount = 0,
  onContent,
}: {
  profile: StudentProfile;
  packages?: ContentPackage[];
  availableCount?: number;
  onContent?: () => void;
  profiles: StudentProfile[];
  banks: QuestionBank[];
  results: Result[];
  savedSession: Session | null;
  busy: boolean;
  onStart: (bank: QuestionBank, mode: SessionMode) => void;
  onResume: () => void;
  onSelect: (p: StudentProfile) => void;
  onResult: (r: Result) => void;
}) {
  const subjects = profile.subjects;
  const [subject, setSubject] = useState(subjects[0] ?? 'maths');
  const start = onStart,
    resume = onResume,
    selectProfile = onSelect,
    setResult = onResult;
  return (
    <>
      <section className="greeting">
        <div>
          <span className="eyebrow">SCHÖN, DASS DU DA BIST</span>
          <h1>
            Hallo {profile.name}
            <span className="hello-dot">.</span>
          </h1>
          <p>Was möchtest du heute entdecken?</p>
        </div>
        <span className="date-label">Dein Platz zum Weiterkommen</span>
      </section>
      {availableCount > 0 && onContent && (
        <section className="resume-banner">
          <div>
            <strong>Neue Inhalte verfügbar</strong>
            <p>{availableCount} neue oder aktualisierte Aufgabenpakete warten auf dich.</p>
          </div>
          <button className="button primary" onClick={onContent}>
            Inhalte ansehen
          </button>
        </section>
      )}
      <section className="hero">
        <div className="hero-copy">
          <span className="pill">DEIN NÄCHSTER SCHRITT</span>
          <h2>
            Kleine Schritte.
            <br />
            <em>Große Fortschritte.</em>
          </h2>
          <p>
            Erst verstehen. Dann ausprobieren.
            <br />
            Und mit jeder Aufgabe sicherer werden.
          </p>
          <a className="hero-link" href="#subjects">
            Zu deinen Fächern <Arrow />
          </a>
        </div>
        <BookArt />
      </section>
      {savedSession && (
        <section className="resume-banner">
          <div>
            <strong>
              {savedSession.mode === 'exam'
                ? 'Deine Klassenarbeit läuft noch'
                : 'Deine Lernrunde wartet'}
            </strong>
            <p>
              {savedSession.mode === 'exam'
                ? 'Die Prüfungszeit läuft weiter. Setze hier fort.'
                : 'Deine bisherigen Antworten sind gespeichert.'}
            </p>
          </div>
          <button className="button primary" onClick={resume}>
            Fortsetzen <Arrow />
          </button>
        </section>
      )}
      <section className="library-section" id="subjects">
        <div className="section-heading">
          <h2>Meine Fächer</h2>
          <span>Heute ein Stück weiter</span>
        </div>
        <div className="subject-tabs" role="group" aria-label="Fach auswählen">
          {subjects.map((s, i) => (
            <button
              className={`subject-tab ${subject === s ? 'active' : ''}`}
              key={s}
              aria-pressed={subject === s}
              onClick={() => setSubject(s)}
            >
              <span aria-hidden="true">{['∑', 'Aa', 'é', '❋', '◎'][i]}</span>
              {subjectLabel(s)}
            </button>
          ))}
        </div>
        {banks.filter((b) => b.subject === subject).length ? (
          banks
            .filter((b) => b.subject === subject)
            .map((bank) => {
              const pkg = packages.find((p) => p.id === bank.id);
              const latest = results
                .filter((r) => r.testId === bank.id)
                .sort((a, b) => b.date - a.date)[0];
              return (
                <article className="chapter-card" key={bank.id}>
                  <div className="chapter-art" aria-hidden="true">
                    <span className="math-parenthesis">(</span>
                    <span className="math-square">
                      a<sup>2</sup>
                    </span>
                    <span className="math-plus">+</span>
                    <span className="math-times">×</span>
                    <span className="art-label">
                      {subjectLabel(bank.subject).toUpperCase()}
                      <br />
                      {bank.isDemo ? 'DEMO' : bank.grade}
                    </span>
                  </div>
                  <div className="chapter-content">
                    <div className="chapter-meta">
                      <span className="eyebrow">
                        {bank.isDemo ? 'DEIN DEMO-KAPITEL' : 'DEIN UNTERRICHT'}
                      </span>
                      <span className="demo-tag">
                        {bank.isDemo ? 'Künstliche Übungsdaten' : '✓ Offline verfügbar'}
                      </span>
                    </div>
                    <h3>{bank.title}</h3>
                    <p className="chapter-description">
                      {bank.chapter} · {subjectLabel(bank.subject)}
                    </p>
                    <div className="skills-chips">
                      {bank.skills.map((skill) => (
                        <span key={skill.id}>{skill.name}</span>
                      ))}
                    </div>
                    <div className="chapter-facts">
                      <span>
                        ◷ {pkg?.tests[0]?.durationMinutes ?? bank.durationMinutes} Min.{' '}
                        {pkg && !pkg.modes.includes('exam') ? 'Lernzeit' : 'Klassenarbeit'}
                      </span>
                      <span>▤ {bank.questionCount} Aufgaben je Lernrunde</span>
                      {pkg?.tests[0] && (
                        <span>{pkg.tests[0].questionIds.length} feste Prüfungsaufgaben</span>
                      )}
                      <span>{bank.questions.length} im Pool</span>
                    </div>
                    <div className="chapter-actions">
                      {(!pkg || pkg.modes.includes('learn')) && (
                        <button
                          className="button primary"
                          disabled={busy || Boolean(savedSession)}
                          onClick={() => void start(bank, 'learn')}
                        >
                          Lernen <Arrow />
                        </button>
                      )}
                      {(!pkg || pkg.modes.includes('exam')) && (
                        <button
                          className="button secondary"
                          disabled={busy || Boolean(savedSession)}
                          onClick={() => void start(bank, 'exam')}
                        >
                          Klassenarbeit starten
                        </button>
                      )}
                    </div>
                    {latest && (
                      <button className="latest-result" onClick={() => setResult(latest)}>
                        Letztes Ergebnis: {number(latest.score20)} / 20 ·{' '}
                        {new Date(latest.date).toLocaleDateString('de-DE')} <Arrow />
                      </button>
                    )}
                  </div>
                </article>
              );
            })
        ) : (
          <div className="empty-state">
            <span className="empty-symbol" aria-hidden="true">
              ▤
            </span>
            <h3>Hier ist Platz für neues Wissen.</h3>
            <p>
              Für {profile.name} gibt es in {subjectLabel(subject)} noch kein Aufgabenpaket.
            </p>
            {onContent && (
              <button className="button primary" onClick={onContent}>
                Neue Inhalte ansehen <Arrow />
              </button>
            )}
            {profile.id !== 'lutz' && profiles.some((p) => p.id === 'lutz') && (
              <button
                className="button secondary"
                onClick={() => {
                  const lutz = profiles.find((p) => p.id === 'lutz');
                  if (lutz) void selectProfile(lutz);
                }}
              >
                Demo mit Lutz entdecken <Arrow />
              </button>
            )}
          </div>
        )}
      </section>
      <div className="learning-note">
        <span aria-hidden="true">✧</span>
        <div>
          <strong>Verstehen ist besser als Raten.</strong>
          <p>Im Lernmodus bekommst du Hinweise, einen Lösungsweg und eine Regel zum Merken.</p>
        </div>
      </div>
    </>
  );
}

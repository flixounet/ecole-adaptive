import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import type { QuestionBank } from '@shared/types';
import type { AttemptRecord, StudentSkillState } from '../domain/adaptive/types';
import { getLearningRecommendations } from '../domain/adaptive/recommendations';
import { number, subjectLabel } from './format';

export function MasteryView({
  studentId,
  banks,
  states,
  attempts,
}: {
  studentId: string;
  banks: QuestionBank[];
  states: StudentSkillState[];
  attempts: AttemptRecord[];
}) {
  const subjects = [
    ...new Set([
      ...banks.map((b) => b.subject),
      ...states.filter((s) => s.studentId === studentId).map((s) => s.subject),
    ]),
  ];
  return (
    <div className="progress-page">
      <section className="greeting">
        <div>
          <span className="eyebrow">SCHRITT FÜR SCHRITT</span>
          <h1>Mein Lernstand</h1>
          <p>Hier siehst du, was schon klappt und was du als Nächstes üben kannst.</p>
        </div>
      </section>
      <p className="learning-note">
        Jedes neue Thema beginnt bei 50 %. Erst deine abgeschlossenen Aufgaben verändern diesen
        Startwert. Der Lernstand ist eine Orientierung, keine Schulnote.
      </p>
      {!subjects.length && (
        <div className="empty-state">
          <h2>Hier wächst dein Lernstand.</h2>
          <p>Sobald ein Aufgabenpaket für dich bereitsteht, findest du hier deine Themen.</p>
        </div>
      )}
      {subjects.map((subject) => {
        const skills = [
          ...new Map(
            banks
              .filter((b) => b.subject === subject)
              .flatMap((b) =>
                b.skills.map((s) => ({ ...s, id: canonicalFixtureSkillId(b.id, s.id) })),
              )
              .map((s) => [s.id, s]),
          ).values(),
        ];
        for (const state of states.filter(
          (s) => s.studentId === studentId && s.subject === subject,
        )) {
          if (!skills.some((s) => s.id === state.skillId))
            skills.push({ id: state.skillId, name: state.skillId });
        }
        const recommendations = getLearningRecommendations({
          studentId,
          subject,
          skills,
          skillStates: states,
          recentAttempts: attempts,
        });
        return (
          <section className="mastery-section" key={subject}>
            <div className="section-heading">
              <h2>{subjectLabel(subject)}</h2>
              <span>{skills.length} Themen</span>
            </div>
            <div className="mastery-grid">
              {recommendations.map((item) => {
                const state = states.find(
                  (s) =>
                    s.studentId === studentId &&
                    s.subject === subject &&
                    s.skillId === item.skillId,
                );
                const practiced = Boolean(state?.attempts);
                return (
                  <article className="mastery-card" key={item.skillId}>
                    <div className="mastery-card-heading">
                      <span className={`priority-pill ${item.priority}`}>
                        {practiced ? item.status : 'Noch nicht geübt'}
                      </span>
                      <strong>{number(item.mastery * 100)} %</strong>
                    </div>
                    <h3>{item.name}</h3>
                    <progress
                      max={1}
                      value={item.mastery}
                      aria-label={`${item.name}: ${number(item.mastery * 100)} Prozent`}
                    />
                    <p>
                      {practiced
                        ? item.reason
                        : 'Dein Startwert. Probiere die ersten Aufgaben aus.'}
                    </p>
                    <div className="mastery-meta">
                      <span>{state?.attempts ?? 0} Aufgaben abgeschlossen</span>
                      <span>
                        {state?.lastPracticedAt
                          ? `Zuletzt ${new Date(state.lastPracticedAt).toLocaleDateString('de-DE')}`
                          : 'Startwert 50 %'}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

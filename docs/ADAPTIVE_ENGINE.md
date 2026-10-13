# Adaptive Lernlogik – Phase 2

Die adaptive Logik läuft vollständig lokal in reinen TypeScript-Domainfunktionen. Sie benötigt weder KI noch Server. Sie ist ein transparentes Übungsmodell: Die Prozentzahl beschreibt den gespeicherten Lernstand dieser App, keine wissenschaftlich kalibrierte Wahrscheinlichkeit und keine Schulnote.

Die Implementierung liegt unter `apps/student/src/domain/adaptive/`. Alle fachlichen Parameter stehen zentral in `config.ts`; React zeigt Ergebnisse an und ruft die Speicher-Services auf. Zeit, Zufall und Persistenz sind von der eigentlichen Berechnung getrennt.

## Kompetenzwerte aktualisieren

Jeder neue Skill startet bei **0,50**. Die Identität ist immer die Kombination aus Schüler, Fach und Skill. Ein abgeschlossenes Aufgabenergebnis wird durch `classifyAttempt` eingeordnet; `updateSkillMastery` berechnet einen neuen Zustand, `applyAttemptToSkills` aktualisiert sämtliche zugeordneten Skills genau einmal.

| Ergebnis                                 | Basisänderung |
| ---------------------------------------- | ------------: |
| Beim ersten Versuch richtig              |        +0,060 |
| Nach einem Hinweis richtig               |        +0,030 |
| Nach zwei Hinweisen richtig              |        +0,015 |
| Endgültig falsch                         |        −0,080 |
| Bei Abschluss übersprungen/unbeantwortet |        −0,030 |

Positive Änderungen werden mit dem Schwierigkeitsfaktor multipliziert:

| Difficulty | Faktor |
| ---------- | -----: |
| 1          |   0,80 |
| 2          |   1,00 |
| 3          |   1,20 |
| 4          |   1,35 |

Negative Änderungen erhalten keinen zusätzlichen Schwierigkeitsfaktor. Danach wird auf den Bereich 0 bis 1 begrenzt; kleine Gleitkommaartefakte werden auf zwölf Nachkommastellen normalisiert. Beispielsweise ergibt eine direkt richtige Aufgabe der Stufe 3 aus 0,50 den Wert `0,50 + 0,06 × 1,2 = 0,572`.

Im Lernmodus sind der erste und zweite falsche Eingabeversuch noch kein endgültiger Fehlschlag. Erst eine richtige Antwort oder der dritte falsche Versuch finalisiert die Aufgabe. Dadurch wird eine später mit Hinweis gelöste Aufgabe nicht zuvor mehrfach bestraft. Bei vorzeitiger Abgabe werden noch offene Aufgaben einmal abschließend eingeordnet. Das Vorwärtsblättern allein senkt keinen Kompetenzwert. Klassenarbeitsantworten werden erst bei Abgabe gewertet.

Die Domainfunktion erkennt eine direkt wiederholte Attempt-ID. Zusätzlich verhindert der persistente eindeutige Attempt-Schlüssel doppelte Anwendung durch Doppelklick, erneute Abgabe oder verspätetes Speichern. Zustände und Verlauf werden in derselben Datenbanktransaktion geschrieben; ein React-Re-Render hat keine eigene Bewertungswirkung.

## Aufgaben gewichten

`selectQuestions` erhält Bank, Profil, Kompetenzstände, jüngste Versuche, tatsächliche Aufgabenhistorie, Modus und gewünschte Anzahl. Für fehlende Kompetenzstände gilt der Startwert 0,50.

Das Grundgewicht eines Skills ist:

```text
1 + 2 × (1 − mastery)
```

Dazu kommen pro endgültigem Fehler in den letzten **10 abgeschlossenen Aufgaben desselben Schülers und Fachs** 0,75 Punkte, insgesamt höchstens 2,25 Zusatzpunkte pro Skill. Übersprungene Aufgaben beeinflussen Mastery, zählen aber nicht als Fehler für diesen Bonus. Bei mehreren Skills verwendet eine Frage das mittlere Skillgewicht und die mittlere Mastery; ein zusätzlich zugeordneter Skill vervielfacht das Gewicht somit nicht automatisch.

Anschließend wird die Schwierigkeit gewichtet:

| Mastery                      | Bevorzugte Stufen |
| ---------------------------- | ----------------- |
| unter 0,40                   | 1                 |
| 0,40 bis unter 0,65          | 1–2               |
| 0,65 bis einschließlich 0,85 | 2–3               |
| über 0,85                    | 3–4               |

Eine bevorzugte Stufe erhält Faktor 1,5. Außerhalb des Bereichs gilt `1 / (1 + Abstand zur nächsten bevorzugten Stufe)`. Alle Stufen behalten grundsätzlich positives Gewicht. Ein ausdrücklicher Themenschwerpunkt erhält zusätzlich Faktor 1,5. Tatsächliche Auswahlwahrscheinlichkeiten hängen außerdem von den übrigen verfügbaren Fragen ab.

Die Auswahl erfolgt gewichtet ohne Zurücklegen; dieselbe ID steht daher nicht zweimal in einer Runde. Die fünf zuletzt gezeigten Fragen werden vermieden, solange passende andere Fragen verfügbar sind. Bei sehr kleinen Pools darf diese Fünferregel gelockert werden. Die unmittelbar letzte Frage wird dennoch nicht direkt erneut ausgegeben. Ein Pool mit nur einer gerade gezeigten Aufgabe kann deshalb keine neue Runde liefern.

Ein übergebener `RandomProvider` oder `createSeededRandom(seed)` macht die Auswahl reproduzierbar. Im normalen Betrieb wird `Math.random` verwendet. Die Tests prüfen sowohl konkrete Seed-Ergebnisse als auch eine größere Simulation, in der ein schwacher Skill deutlich häufiger gewählt werden muss.

## Konkretes Beispiel

Lutz beginnt bei `math.parentheses` mit Mastery 0,50. Eine Aufgabe wird endgültig falsch beantwortet:

```text
Mastery:             0,50 − 0,08 = 0,42
Grundgewicht vorher: 1 + 2 × (1 − 0,50) = 2,00
Grundgewicht danach: 1 + 2 × (1 − 0,42) = 2,16
Mit einem Fehler:    2,16 + 0,75 = 2,91
```

Für eine reine Klammeraufgabe der Schwierigkeit 2 bleibt der Schwierigkeitsfaktor 1,5. Ihr Gewicht steigt somit von 3,00 auf 4,365, sofern keine weiteren Schwerpunkte oder Ausschlüsse wirken. Das ist eine Erhöhung des Gewichts um 45,5 %, keine feste prozentuale Auswahlchance.

## Fehler mit Abstand erneut aufgreifen

`scheduleErrorRecurrence` verändert nur noch nicht besuchte oder bearbeitete Teile der laufenden Lernrunde. Geöffnete Fragen, eingegebene Antworten und abgeschlossene Aufgaben werden geschützt.

Nach einem endgültigen Fehler sollen möglichst zwei andere Aufgaben dazwischenliegen. Eine Transferaufgabe zum gleichen Skill wird bevorzugt vier bis sieben Positionen nach der Fehleraufgabe eingeplant, frühestens nach zwei dazwischenliegenden Fragen. Eine andere Aufgaben-ID ist Pflicht für eine neu eingeplante Transferfrage. Bereits geplante verwandte Aufgaben können in den passenden späteren Abschnitt verschoben werden.

Diese Regeln hängen vom verbleibenden Pool und den freien Positionen ab. Sind nur gleichartige Aufgaben übrig, die Runde schon fast beendet oder alle Alternativen bereits bearbeitet, bleibt der sichere bestehende Plan erhalten. Die nächste neue Runde berücksichtigt den gesunkenen Kompetenzwert und den Fehlerbonus weiterhin. Das Verfahren ist eine einfache Übungsplanung, kein wissenschaftlich validiertes Spaced-Repetition-Modell.

## Fehlertraining

`createErrorTraining` ermittelt aus der gespeicherten Korrektur die betroffenen Skills und ihre Fehlerhäufigkeit. Es arbeitet mit der aktuellen Bank, während die ursprüngliche Korrektur an ihrer alten Paketkopie gebunden bleibt. Die bekannten alten Demo-Skillnamen werden nur für diese Demo auf die neuen Namen abgebildet.

Standard sind acht Aufgaben. Schwache Skills und häufige Fehler erhöhen das Gewicht. Pro Skill zählt die größere Zahl aus Fehlern der zugrunde liegenden Arbeit und dem aktuellen Zehnerfenster; so werden dieselben Fehler nicht doppelt gezählt. Der Bonus bleibt auf 2,25 begrenzt. Eine ähnliche Schwierigkeit wie bei den zugehörigen Fehleraufgaben wird zusätzlich mit `1 / (1 + Abstand zur mittleren Fehleraufgaben-Schwierigkeit)` bevorzugt. Das ist eine weiche Gewichtung, kein harter Ausschluss. Neue Varianten zu den betroffenen Skills haben Vorrang. Sobald passende andere Fragen existieren, bleiben die ursprünglichen Fehleraufgaben ausgeschlossen; eine kurze Runde wird nicht mit identischen Fehleraufgaben aufgefüllt. Hat die Bank überhaupt keine neue passende Variante, kann eine alte Aufgabe erst außerhalb der letzten fünf tatsächlich gezeigten Aufgaben wieder zum Einsatz kommen. Ist dieser Abstand nicht belegt oder die Historie unbekannt, bleibt das Training leer und die Oberfläche meldet fehlende passende Aufgaben.

Nach erfolgreicher Lösung kann `scheduleTrainingProgression` eine spätere, unberührte Position durch eine neue Frage zum gleichen Skill ersetzen, deren Schwierigkeit um eine Stufe höher liegt, maximal Stufe 4. Auch nach einer Aufgabe mit mehreren Skills muss die neue Frage weiterhin mindestens einen ursprünglichen Fehlerschwerpunkt abdecken. So wechselt das Training nicht schrittweise in unbeteiligte Themen. Ohne passende Alternative bleibt der Plan unverändert. Das Ergebnis zeigt die vor und nach dem Training gespeicherten Kompetenzwerte.

## Lernstand und Empfehlungen

| Mastery                      | Anzeige     |
| ---------------------------- | ----------- |
| unter 0,50                   | noch üben   |
| 0,50 bis unter 0,75          | auf dem Weg |
| 0,75 bis einschließlich 0,90 | sicher      |
| über 0,90                    | sehr sicher |

Die Empfehlungen werden regelbasiert erzeugt: unter 0,50 hohe, von 0,50 bis einschließlich 0,70 mittlere und darüber niedrige Priorität. Ein jüngerer endgültiger Fehler hebt die Priorität um eine Stufe an. Der Hinweis nennt die tatsächliche Anzahl der berücksichtigten Aufgaben; neue Skills werden ausdrücklich als noch nicht geübt gekennzeichnet.

Historische Ergebnisempfehlungen verwenden ausschließlich die damalige Paketkopie, Antworten und gespeicherten Abschlusswerte. Spätere Lernfortschritte ändern deshalb die frühere Auswertung nicht. Fehlt bei einem Phase-1-Ergebnis die damalige Mastery, wird sie nicht aus heutigen Werten ergänzt.

Der persistierte `recentErrorCount` im Skillzustand beschreibt die letzten zehn Abschlüsse dieses einzelnen Skills. Für Auswahl und Empfehlungen wird dagegen das aktuelle Fenster der letzten zehn Aufgaben des gesamten Fachs aus den AttemptRecords berechnet. Diese beiden Zählungen haben unterschiedliche Bezugsgruppen.

## Manuell prüfen

1. Lutz auswählen, Mathematik öffnen und eine Lernrunde starten.
2. Bei einer Aufgabe dreimal eine falsche Antwort prüfen. Die ersten beiden Versuche zeigen Hinweise; erst der dritte schließt die Aufgabe falsch ab.
3. Die Runde abschließen und „Mein Lernstand“ öffnen. Die betroffenen Skills sind gegenüber dem Startwert gesunken. Bei mehreren Skills betrifft dies jeden zugeordneten Skill.
4. Eine neue Runde starten. Über mehrere Runden werden schwache Bereiche häufiger angeboten; eine einzelne Zufallsauswahl muss nicht immer denselben Schwerpunkt treffen.
5. Eine Klassenarbeit mit einigen falschen Antworten abgeben. Punkte, Bewertung auf 20, Skill-Auswertung und Fehler ansehen.
6. „Meine Fehler trainieren“ öffnen. Die Aufgaben-IDs sollen sich bei vorhandenem Variantenpool von den Fehleraufgaben unterscheiden.
7. Das Fehlertraining abschließen und die Vorher-/Nachher-Werte vergleichen.
8. „Meine Ergebnisse“ öffnen, die vergangene Arbeit erneut ansehen und den Browser neu laden. Verlauf und Lernstände bleiben erhalten.
9. Zu Max oder Ben wechseln. Die Lernstände und Ergebnisse von Lutz dürfen dort nicht erscheinen.

Phase 3 verwendet diese Regeln unverändert für adaptive Lernrunden und Fehlertraining. Neu veröffentlichte Klassenarbeiten starten den festen gespeicherten Blueprint; während der Prüfung findet keine adaptive Umplanung statt. Fehlertraining bleibt auch nach einem ausschließlich als Klassenarbeit freigegebenen Paket möglich. PWA und Offline-Inhaltsinstallation sind separat beschrieben.

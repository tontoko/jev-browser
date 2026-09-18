import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBriefComponentScenario,
  buildBriefSourceScenario,
  buildCompanionInitialScenario,
  buildCompanionResultScenario,
  buildImportColumnScenario,
  buildImportRowScenario,
  executeQuestions,
  scoreAnswers,
} from '../experiments/polku-product.mjs';

class FakeClient {
  constructor(answerMap, delayMs = 0) {
    this.answerMap = answerMap;
    this.delayMs = delayMs;
    this.calls = [];
    this.active = 0;
    this.maxActive = 0;
  }

  async systemOne({ state, questions }) {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls.push({ state, questions: Object.keys(questions) });
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    const answers = {};
    for (const id of Object.keys(questions)) {
      const choice = this.answerMap[id];
      assert.ok(choice, `missing fake answer for ${id}`);
      answers[id] = {
        type: 'choice',
        choice,
        confidence: 0.9,
        probabilities: { [choice]: 0.9 },
      };
    }
    this.active -= 1;
    return {
      model: 'fake-model',
      usage: { input_tokens: Object.keys(questions).length * 10, output_tokens: 0 },
      answers,
    };
  }
}

test('all Polku scenarios keep evaluation oracle out of model payloads', () => {
  const scenarios = [
    buildBriefComponentScenario(),
    buildBriefSourceScenario(),
    buildImportColumnScenario(),
    buildImportRowScenario({
      name: 'c1',
      date: 'c2',
      time: 'c3',
      duration: 'c4',
      course: 'c5',
    }),
    buildCompanionInitialScenario(),
    buildCompanionResultScenario({
      intent: 'search',
      learner: 'learner-hana',
      period: 'last-3-months',
      purpose: 'goal-candidate',
    }),
  ];

  for (const scenario of scenarios) {
    const serialized = JSON.stringify({ state: scenario.state, questions: scenario.questions });
    assert.equal(serialized.includes('"oracle"'), false);
    assert.equal(serialized.includes('"expected"'), false);
    assert.ok(Object.keys(scenario.oracle).length > 0);
  }
});

test('batched mode sends all independent questions in one request and aggregates usage', async () => {
  const scenario = buildBriefSourceScenario();
  const client = new FakeClient(scenario.oracle);
  const result = await executeQuestions(client, scenario, { mode: 'batched' });

  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].questions.sort(), Object.keys(scenario.questions).sort());
  assert.equal(result.calls, 1);
  assert.equal(result.usage.input_tokens, Object.keys(scenario.questions).length * 10);
  assert.equal(scoreAnswers(scenario, result.answers).correct, Object.keys(scenario.oracle).length);
});

test('sequential mode makes one request per question and never overlaps them', async () => {
  const scenario = buildBriefSourceScenario();
  const client = new FakeClient(scenario.oracle, 2);
  const result = await executeQuestions(client, scenario, { mode: 'sequential' });

  assert.equal(client.calls.length, Object.keys(scenario.questions).length);
  assert.equal(client.maxActive, 1);
  assert.equal(result.calls, Object.keys(scenario.questions).length);
});

test('parallel mode overlaps individual requests but respects concurrency', async () => {
  const scenario = buildBriefSourceScenario();
  const client = new FakeClient(scenario.oracle, 5);
  const result = await executeQuestions(client, scenario, { mode: 'parallel', concurrency: 4 });

  assert.equal(client.calls.length, Object.keys(scenario.questions).length);
  assert.ok(client.maxActive > 1);
  assert.ok(client.maxActive <= 4);
  assert.equal(result.calls, Object.keys(scenario.questions).length);
});

test('component-first and source-first Brief experiments judge the same source facts', () => {
  const byComponent = buildBriefComponentScenario();
  const bySource = buildBriefSourceScenario();

  assert.equal(byComponent.fixtureId, bySource.fixtureId);
  assert.equal(byComponent.sourceFacts.length, 5);
  assert.deepEqual(byComponent.sourceFacts, bySource.sourceFacts);
  assert.notDeepEqual(Object.keys(byComponent.questions), Object.keys(bySource.questions));
});

test('import row questions use the interpreted columns and stable source row ids', () => {
  const scenario = buildImportRowScenario({
    name: 'c1',
    date: 'c2',
    time: 'c3',
    duration: 'c4',
    course: 'c5',
  });

  assert.ok(scenario.state.rows.every(row => /^r\d+$/.test(row.id)));
  assert.ok(scenario.state.rows.some(row => row.cells.date === '10/09'));
  assert.ok(Object.keys(scenario.questions).some(id => id.startsWith('row:r1:')));
  assert.ok(Object.keys(scenario.questions).some(id => id.startsWith('row:r4:')));
});

test('Companion second stage depends on first-stage answers and real result ids', () => {
  const first = buildCompanionInitialScenario();
  const second = buildCompanionResultScenario(first.oracle);

  assert.equal(second.state.interpretation.learner, 'learner-hana');
  assert.equal(second.state.interpretation.period, 'last-3-months');
  assert.deepEqual(second.state.results.map(item => item.id), ['report-r1', 'report-r2', 'report-r3']);
  assert.equal(second.oracle.result, 'report-r2');
  assert.equal(second.oracle.next_action, 'draft-goal');
});

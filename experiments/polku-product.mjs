import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const noul = (instructions, yes, no) => ({ type: 'noul', instructions, criteria: { true: yes, false: no } });

const briefFacts = [
  { id: 's1', text: '親子が参加する小さな発表会にしたい。' },
  { id: 's2', text: '出演は12人くらい。' },
  { id: 's3', text: '保護者も見学する。' },
  { id: 's4', text: '会場はまだ決めていない。' },
  { id: 's5', text: '案内には「駐車場は北側です」と入れてほしい。' },
];
const factCriteria = Object.fromEntries([
  ...briefFacts.map(({ id, text }) => [id, text]),
  ['none', '該当する記述はない'],
]);

export function buildBriefComponentScenario() {
  return {
    name: 'brief-component-first',
    fixtureId: 'brief-family-small-recital-ja-1',
    sourceFacts: structuredClone(briefFacts),
    state: {
      request: 'この内容からLiving Briefの初稿を作る。書かれていない事実を補わない。',
      sourceFacts: structuredClone(briefFacts),
      components: ['description', 'people', 'audience', 'venue', 'notice'],
    },
    questions: {
      'component:description:source': choice('会の目的・説明に対応する原情報', factCriteria),
      'component:people:source': choice('出演人数に対応する原情報', factCriteria),
      'component:people:state': choice('出演人数の状態', {
        exact: '確定人数',
        approximate: '概数',
        unknown: '未定',
        none: '情報なし',
      }),
      'component:audience:source': choice('見学者・来場者に対応する原情報', factCriteria),
      'component:venue:source': choice('会場に対応する原情報', factCriteria),
      'component:venue:state': choice('会場の状態', {
        confirmed: '確定',
        undecided: '未定',
        none: '情報なし',
      }),
      'component:notice:source': choice('案内の注意事項に対応する原情報', factCriteria),
    },
    oracle: {
      'component:description:source': 's1',
      'component:people:source': 's2',
      'component:people:state': 'approximate',
      'component:audience:source': 's3',
      'component:venue:source': 's4',
      'component:venue:state': 'undecided',
      'component:notice:source': 's5',
    },
  };
}

export function buildBriefSourceScenario() {
  const target = {
    description: '会の目的・説明',
    people: '出演者・参加者',
    audience: '見学者・来場者',
    venue: '会場',
    notice: '案内・注意事項',
    none: '現在の部品へ対応させない',
  };
  const questions = Object.fromEntries(
    briefFacts.map(({ id, text }) => [
      `source:${id}:target`,
      choice(`原情報「${text}」を最も自然に置く先`, target),
    ]),
  );
  questions['source:s2:state'] = choice('「出演は12人くらい」の状態', {
    exact: '確定値',
    approximate: '概数',
    undecided: '未定',
  });
  questions['source:s4:state'] = choice('「会場はまだ決めていない」の状態', {
    confirmed: '確定',
    undecided: '未定',
    absent: '情報なし',
  });
  return {
    name: 'brief-source-first',
    fixtureId: 'brief-family-small-recital-ja-1',
    sourceFacts: structuredClone(briefFacts),
    state: {
      request: '各原情報をLiving Briefの既存部品へ対応させる。原文にない情報を補わない。',
      sourceFacts: structuredClone(briefFacts),
      components: ['description', 'people', 'audience', 'venue', 'notice'],
    },
    questions,
    oracle: {
      'source:s1:target': 'description',
      'source:s2:target': 'people',
      'source:s3:target': 'audience',
      'source:s4:target': 'venue',
      'source:s5:target': 'notice',
      'source:s2:state': 'approximate',
      'source:s4:state': 'undecided',
    },
  };
}


const multiBriefFacts = [
  { id: 'm1', text: '親子が参加する小さな発表会にしたい。' },
  { id: 'm2', text: '出演は12人くらい。' },
  { id: 'm3', text: '保護者も見学する。' },
  { id: 'm4', text: '会場は中央ホール。駐車場は北側です。' },
];

export function buildBriefMultiLabelScenario() {
  const components = {
    description: '会の目的・説明',
    people: '出演者・参加者',
    audience: '見学者・来場者',
    venue: '会場',
    notice: '案内・注意事項',
  };
  const questions = {};
  const oracle = {};
  const expected = {
    m1: new Set(['description']),
    m2: new Set(['people']),
    m3: new Set(['audience']),
    m4: new Set(['venue', 'notice']),
  };
  for (const fact of multiBriefFacts) {
    for (const [component, label] of Object.entries(components)) {
      const id = `source:${fact.id}:${component}`;
      questions[id] = noul(
        `原情報「${fact.text}」は「${label}」の内容として使うべきか。複数の部品に関係してよい。`,
        `この原情報は「${label}」に実質的に関係する`,
        `この原情報は「${label}」には関係しない`,
      );
      oracle[id] = expected[fact.id].has(component);
    }
  }
  questions['source:m2:state'] = choice('「出演は12人くらい」の状態', {
    exact: '確定値',
    approximate: '概数',
    undecided: '未定',
  });
  questions['source:m4:venue_state'] = choice('中央ホールという会場の状態', {
    confirmed: '確定',
    undecided: '未定',
  });
  oracle['source:m2:state'] = 'approximate';
  oracle['source:m4:venue_state'] = 'confirmed';
  return {
    name: 'brief-source-multilabel',
    fixtureId: 'brief-family-shared-source-ja-1',
    sourceFacts: structuredClone(multiBriefFacts),
    state: {
      request: '一つの原情報が複数のLiving Brief部品に関係しうる。原文にない情報を補わない。',
      sourceFacts: structuredClone(multiBriefFacts),
      components: Object.entries(components).map(([id, label]) => ({ id, label })),
    },
    questions,
    oracle,
  };
}

const importHeaders = [
  { id: 'c1', text: '氏名' },
  { id: 'c2', text: '日付' },
  { id: 'c3', text: '開始' },
  { id: 'c4', text: '分' },
  { id: 'c5', text: '内容' },
];
const importRows = [
  { id: 'r1', raw: { c1: '架空 花', c2: '10/09', c3: '17:00', c4: '45', c5: 'Viola da gamba' }, note: '既存のBさん' },
  { id: 'r2', raw: { c1: '架空 花', c2: '11/09', c3: '18:00', c4: '45', c5: 'Viola da gamba' }, note: '同名だが新規の別人' },
  { id: 'r3', raw: { c1: '架空 空', c2: '', c3: '', c4: '', c5: 'Viola da gamba' }, note: '生徒だけ登録' },
  { id: 'r4', raw: { c1: '架空 海', c2: '10/09', c3: '19:00', c4: '30', c5: 'Bass viol' }, note: '日付形式は要確認' },
];

export function buildImportColumnScenario() {
  const criteria = {
    name: '生徒名・氏名',
    date: 'レッスンの日付',
    time: '開始時刻',
    duration: '所要時間・分数',
    course: 'レッスン内容・Course',
    ignore: '今回使わない',
    clarify: '意味を確認する',
  };
  return {
    name: 'import-columns',
    fixtureId: 'import-small-roster-ja-1',
    state: {
      instruction: 'この表から生徒と一回の予定を取り込む。日付順はまだ未確認。',
      headers: structuredClone(importHeaders),
      sampleRows: structuredClone(importRows.slice(0, 2)),
    },
    questions: Object.fromEntries(
      importHeaders.map(column => [`column:${column.id}`, choice(`列「${column.text}」の意味`, criteria)]),
    ),
    oracle: {
      'column:c1': 'name',
      'column:c2': 'date',
      'column:c3': 'time',
      'column:c4': 'duration',
      'column:c5': 'course',
    },
  };
}

function projectImportRows(columnRoles) {
  const roles = ['name', 'date', 'time', 'duration', 'course'];
  return importRows.map(row => ({
    id: row.id,
    cells: Object.fromEntries(roles.map(role => [role, row.raw[columnRoles[role]] ?? ''])),
    note: row.note,
  }));
}

export function buildImportRowScenario(columnRoles) {
  const questions = {};
  const person = {
    'learner-b': '認可済み既存候補Bを使う',
    'learner-a': '認可済み既存候補Aを使う',
    new: '新しい別人',
    clarify: '確認が必要',
    exclude: '今回は除外',
  };
  for (const row of importRows) {
    questions[`row:${row.id}:identity`] = choice(
      `元行${row.id}の人物対応。表示名だけで同一人物と決めない。`,
      person,
    );
    questions[`row:${row.id}:schedule`] = choice(
      `元行${row.id}の予定。日時がなければ架空の予定を作らない。`,
      {
        create: '一回の予定を作る',
        learner_only: '生徒だけ扱う',
        clarify_date: '日付解釈を確認する',
        exclude: '今回は除外',
      },
    );
  }
  return {
    name: 'import-rows',
    fixtureId: 'import-small-roster-ja-1',
    state: {
      instruction: '列対応済みの必要セルだけで複数行を判断する。10/09は日/月か月/日か未確認。',
      columnRoles: structuredClone(columnRoles),
      rows: projectImportRows(columnRoles),
      learnerCandidates: [
        { id: 'learner-a', name: '架空 花', note: '既存A' },
        { id: 'learner-b', name: '架空 花', note: '既存B' },
      ],
    },
    questions,
    oracle: {
      'row:r1:identity': 'learner-b',
      'row:r1:schedule': 'clarify_date',
      'row:r2:identity': 'new',
      'row:r2:schedule': 'clarify_date',
      'row:r3:identity': 'new',
      'row:r3:schedule': 'learner_only',
      'row:r4:identity': 'new',
      'row:r4:schedule': 'clarify_date',
    },
  };
}

export function buildCompanionInitialScenario() {
  return {
    name: 'companion-initial',
    fixtureId: 'companion-search-goal-ja-1',
    state: {
      utterance: '花さんの直近3か月のリズムについて書いた記録を探して、次の目標に使えそうなものを見せて。',
      today: '2026-09-18',
      locale: 'ja',
      roster: [
        { id: 'learner-hana', name: '架空 花' },
        { id: 'learner-umi', name: '架空 海' },
      ],
    },
    questions: {
      intent: choice('依頼の主な操作', {
        search: '既存記録を検索',
        add_goal: '目標を直接追加',
        clarify: '確認が必要',
      }),
      learner: choice('対象生徒', {
        'learner-hana': '架空 花',
        'learner-umi': '架空 海',
        clarify: '確認が必要',
      }),
      period: choice('検索期間', {
        'last-3-months': '受理日から直近3か月',
        'last-month': '直近1か月',
        all: '指定なし',
      }),
      purpose: choice('検索結果の目的', {
        'goal-candidate': '次の目標候補を探す',
        view: '表示だけ',
        clarify: '確認が必要',
      }),
    },
    oracle: {
      intent: 'search',
      learner: 'learner-hana',
      period: 'last-3-months',
      purpose: 'goal-candidate',
    },
  };
}

const companionResults = [
  { id: 'report-r1', date: '2026-07-03', excerpt: '音程は安定。リズムは概ね一定。' },
  { id: 'report-r2', date: '2026-08-21', excerpt: '合奏になるとテンポが走る。一定の拍を保つ練習を続ける。' },
  { id: 'report-r3', date: '2026-09-11', excerpt: '弓の持ち方を確認。リズムの記述はない。' },
];

export function buildCompanionResultScenario(interpretation) {
  const eligible =
    interpretation?.intent === 'search' &&
    interpretation?.learner === 'learner-hana' &&
    interpretation?.period === 'last-3-months' &&
    interpretation?.purpose === 'goal-candidate';
  const results = eligible
    ? companionResults
    : [{ id: 'report-u1', date: '2026-09-10', excerpt: '別の生徒の記録。今回の対象ではない。' }];
  const resultCriteria = Object.fromEntries(results.map(item => [item.id, item.excerpt]));
  resultCriteria.none = '該当する記録はない';
  const actionCriteria = eligible
    ? {
        'draft-goal': '選んだ原文を使って目標案を作り、まだ保存しない',
        view: '表示だけ',
        clarify: '確認する',
      }
    : {
        view: '表示だけ',
        clarify: '確認する',
      };
  return {
    name: 'companion-results',
    fixtureId: 'companion-search-goal-ja-1',
    state: {
      instruction: '表示した検索結果から関連する記録と次の操作を選ぶ。本文を創作しない。',
      interpretation: structuredClone(interpretation),
      results: structuredClone(results),
    },
    questions: {
      result: choice('目標候補の根拠として最も直接関係する記録', resultCriteria),
      next_action: choice('次の操作', actionCriteria),
    },
    oracle: { result: 'report-r2', next_action: 'draft-goal' },
  };
}

export function buildSupportScenario() {
  return {
    name: 'support-route',
    fixtureId: 'support-help-vs-work-ja-1',
    state: {
      utterance: '来週のレッスンの日程を変えたい。どこからできる？',
      availableActions: [
        { id: 'lesson-move', description: '一回のレッスン日時を変更する通常操作' },
        { id: 'import-table', description: '表から生徒・予定をAI取り込みする有料業務操作' },
        { id: 'support-intake', description: '未解決の困り事をサポート受付へ進める' },
      ],
    },
    questions: {
      route: choice('この質問に最も直接対応する案内先', {
        'lesson-move': '通常の日程変更を案内',
        'import-table': '表取り込みを開始',
        'support-intake': 'サポート受付へ進む',
        clarify: '確認が必要',
      }),
      needs_paid_work: choice('この案内自体が有料業務AIを必要とするか', {
        no: '通常案内だけで足りる',
        yes: '有料業務AIの受理が必要',
      }),
    },
    oracle: { route: 'lesson-move', needs_paid_work: 'no' },
  };
}

const mergeUsage = (a, b) => ({
  input_tokens: a.input_tokens + (b?.input_tokens ?? 0),
  output_tokens: a.output_tokens + (b?.output_tokens ?? 0),
});

async function runLimited(entries, concurrency, task) {
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= entries.length) return;
      await task(entries[index], index);
    }
  }
  const count = Math.max(1, Math.min(concurrency, entries.length));
  await Promise.all(Array.from({ length: count }, () => worker()));
}

export async function executeQuestions(client, scenario, { mode = 'batched', concurrency = 4 } = {}) {
  const entries = Object.entries(scenario.questions);
  if (!entries.length) throw new Error('scenario must contain questions');
  const started = performance.now();
  let calls = 0;
  let usage = { input_tokens: 0, output_tokens: 0 };
  const models = new Set();
  const answers = {};

  const call = async questionEntries => {
    calls += 1;
    const result = await client.systemOne({
      state: scenario.state,
      questions: Object.fromEntries(questionEntries),
    });
    usage = mergeUsage(usage, result.usage);
    if (result.model) models.add(result.model);
    Object.assign(answers, result.answers ?? {});
  };

  if (mode === 'batched') await call(entries);
  else if (mode === 'sequential') {
    for (const entry of entries) await call([entry]);
  } else if (mode === 'parallel') {
    await runLimited(entries, concurrency, entry => call([entry]));
  } else throw new Error(`unknown mode: ${mode}`);

  return { answers, calls, models: [...models], usage, wallMs: performance.now() - started };
}

const answerValue = answer => {
  if (typeof answer === 'string' || typeof answer === 'boolean' || typeof answer === 'number') return answer;
  if (answer?.type === 'choice' || typeof answer?.choice === 'string') return answer.choice;
  if (answer?.type === 'noul' || typeof answer?.noul === 'number') return answer.noul >= 0.5;
  if (answer?.type === 'score' || typeof answer?.score === 'number') return answer.score;
  return null;
};

export function scoreAnswers(scenario, answers) {
  let correct = 0;
  const details = {};
  for (const [id, expected] of Object.entries(scenario.oracle)) {
    const actual = answerValue(answers[id]);
    const ok = actual === expected;
    if (ok) correct += 1;
    details[id] = { expected, actual, ok };
  }
  return { correct, total: Object.keys(scenario.oracle).length, details };
}

export const answerChoices = answers => Object.fromEntries(
  Object.entries(answers).map(([id, answer]) => [id, typeof answer === 'string' ? answer : answer?.choice]),
);

const columnRoles = answers => {
  const choices = answerChoices(answers);
  return Object.fromEntries(
    importHeaders
      .map(({ id }) => [choices[`column:${id}`], id])
      .filter(([role]) => role && !['ignore', 'clarify'].includes(role)),
  );
};

const perturb = (scenario, repeat) => repeat % 2 === 0 ? scenario : ({
  ...scenario,
  questions: Object.fromEntries(
    Object.entries(scenario.questions).map(([id, q]) => [
      id,
      { ...q, criteria: Object.fromEntries(Object.entries(q.criteria).reverse()) },
    ]),
  ),
});

const answerSummary = answers => Object.fromEntries(
  Object.entries(answers).map(([id, a]) => [id, {
    type: a?.type ?? null,
    choice: a?.choice ?? null,
    noul: a?.noul ?? null,
    score: a?.score ?? null,
    confidence: a?.confidence ?? null,
    probabilities: a?.probabilities ?? null,
  }]),
);

const emit = (repeat, mode, scenario, result) => console.log(JSON.stringify({
  repeat,
  mode,
  scenario: scenario.name,
  calls: result.calls,
  wallMs: Math.round(result.wallMs),
  usage: result.usage,
  models: result.models,
  score: scoreAnswers(scenario, result.answers),
  answers: answerSummary(result.answers),
}));

async function runLiveExperiment() {
  const apiKey = process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error('Set JEV_API_KEY (or TYPESAFE_API_KEY).');
  const { TypeSafeClient } = await import('@typesafe-ai/sdk');
  const client = new TypeSafeClient({
    apiKey,
    defaultModel: process.env.JEV_MODEL ?? 'jev-latest',
    retry: { maxRetries: 0 },
    logLevel: 'off',
  });
  const repeats = Number.parseInt(process.env.JEV_EXPERIMENT_REPEATS ?? '3', 10);
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const mode of ['sequential', 'parallel', 'batched']) {
      for (const builder of [buildBriefComponentScenario, buildBriefSourceScenario, buildBriefMultiLabelScenario, buildSupportScenario]) {
        const scenario = perturb(builder(), repeat);
        emit(repeat, mode, scenario, await executeQuestions(client, scenario, { mode, concurrency: 4 }));
      }

      const columns = perturb(buildImportColumnScenario(), repeat);
      const colResult = await executeQuestions(client, columns, { mode, concurrency: 4 });
      emit(repeat, mode, columns, colResult);
      const rows = perturb(buildImportRowScenario(columnRoles(colResult.answers)), repeat);
      emit(repeat, mode, rows, await executeQuestions(client, rows, { mode, concurrency: 4 }));

      const initial = perturb(buildCompanionInitialScenario(), repeat);
      const initialResult = await executeQuestions(client, initial, { mode, concurrency: 4 });
      emit(repeat, mode, initial, initialResult);
      const results = perturb(buildCompanionResultScenario(answerChoices(initialResult.answers)), repeat);
      emit(repeat, mode, results, await executeQuestions(client, results, { mode, concurrency: 4 }));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveExperiment().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
